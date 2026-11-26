-- Stage 7: fail closed for absent memberships and bind devices to their owner.
-- Preserve the RPC signatures and the existing no-direct-write model.
-- A physical installation can legitimately serve multiple tenants/accounts.
alter table sync.devices drop constraint devices_pkey;
alter table sync.devices add primary key (id, organization_id, user_id);
create or replace function private.is_staff(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce(private.member_role(p_organization_id) in ('owner', 'coordinator'), false)
$$;

create or replace function public.register_device(
    p_organization_id uuid,
    p_replica_id uuid,
    p_label text default '',
    p_platform text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_cursor bigint;
    v_revision bigint;
begin
    if not private.is_member(p_organization_id) then
        return jsonb_build_object('status', 'forbidden', 'code', 'not_a_member');
    end if;

    insert into sync.devices (id, organization_id, user_id, label, platform, last_seen_at)
    values (p_replica_id, p_organization_id, auth.uid(),
            coalesce(p_label, ''), coalesce(p_platform, ''), now())
    on conflict (id, organization_id, user_id) do update
        set label = excluded.label,
            platform = excluded.platform,
            last_seen_at = now()
        where sync.devices.user_id = excluded.user_id
          and sync.devices.organization_id = excluded.organization_id;

    select cursor into v_cursor from sync.devices
    where id = p_replica_id and organization_id = p_organization_id and user_id = auth.uid();

    select revision into v_revision
    from public.organization_revisions
    where organization_id = p_organization_id;

    return jsonb_build_object(
        'status', 'ok',
        'cursor', coalesce(v_cursor, 0),
        'revision', coalesce(v_revision, 0),
        'serverTime', now()
    );
end;
$$;

create or replace function public.report_device_state(
    p_organization_id uuid,
    p_replica_id uuid,
    p_cursor bigint,
    p_pending integer default 0,
    p_oldest_pending_at timestamptz default null,
    p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not private.is_member(p_organization_id) then
        return jsonb_build_object('status', 'forbidden', 'code', 'not_a_member');
    end if;

    insert into sync.devices (id, organization_id, user_id, cursor, last_seen_at, platform,
        pending_operations, oldest_pending_at, last_error, last_successful_sync_at)
    values (p_replica_id, p_organization_id, auth.uid(), greatest(coalesce(p_cursor, 0), 0),
            now(), '', greatest(coalesce(p_pending, 0), 0), p_oldest_pending_at, p_error,
            case when p_error is null then now() else null end)
    on conflict (id, organization_id, user_id) do update
        set cursor = greatest(coalesce(p_cursor, 0), 0),
            pending_operations = greatest(coalesce(p_pending, 0), 0),
            oldest_pending_at = p_oldest_pending_at,
            last_error = p_error,
            last_seen_at = now(),
            last_successful_sync_at = case when p_error is null then now()
                                           else sync.devices.last_successful_sync_at end,
            organization_id = excluded.organization_id
        where sync.devices.user_id = excluded.user_id
          and sync.devices.organization_id = excluded.organization_id;

    return jsonb_build_object('status', 'ok');
end;
$$;

create or replace function public.register_push_subscription(
    p_organization_id uuid,
    p_endpoint text,
    p_p256dh text,
    p_auth text,
    p_label text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    if not private.is_member(p_organization_id) then
        return jsonb_build_object('status', 'forbidden', 'code', 'not_a_member');
    end if;

    if coalesce(btrim(p_endpoint), '') = '' then
        return jsonb_build_object('status', 'validation_error', 'code', 'endpoint_required');
    end if;

    -- An active subscription cannot be transferred to another account.
    -- Explicit revocation allows a shared browser to be enrolled again.
    insert into public.push_subscriptions
        (organization_id, user_id, endpoint, p256dh, auth, device_label)
    values
        (p_organization_id, auth.uid(), p_endpoint, p_p256dh, p_auth, coalesce(p_label, ''))
    on conflict (endpoint) do update
        set user_id = excluded.user_id,
            organization_id = excluded.organization_id,
            p256dh = excluded.p256dh,
            auth = excluded.auth,
            device_label = excluded.device_label,
            revoked_at = null
        where (public.push_subscriptions.user_id = excluded.user_id
            and public.push_subscriptions.organization_id = excluded.organization_id)
            or public.push_subscriptions.revoked_at is not null
    returning id into v_id;

    if v_id is null then
        return jsonb_build_object('status', 'forbidden', 'code', 'subscription_owner_mismatch');
    end if;

    return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;

create or replace function public.health_snapshot(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_devices jsonb;
    v_backup jsonb;
    v_job jsonb;
    v_revision bigint;
    v_counts jsonb;
begin
    if not private.is_staff(p_organization_id) then
        return jsonb_build_object('status', 'forbidden', 'code', 'not_a_member');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'replicaId', d.id,
        'label', d.label,
        'platform', d.platform,
        'lastSeenAt', d.last_seen_at,
        'lastSuccessfulSyncAt', d.last_successful_sync_at,
        'pendingOperations', d.pending_operations,
        'oldestPendingAt', d.oldest_pending_at,
        'lastError', d.last_error
    ) order by d.last_seen_at desc), '[]'::jsonb)
    into v_devices
    from sync.devices d
    where d.organization_id = p_organization_id;

    select jsonb_build_object(
        'startedAt', b.started_at,
        'finishedAt', b.finished_at,
        'status', b.status,
        'verifiedAt', b.verified_at,
        'ageHours', round(extract(epoch from (now() - b.finished_at)) / 3600)
    )
    into v_backup
    from public.backup_runs b
    where b.status = 'succeeded'
    order by b.finished_at desc
    limit 1;

    select jsonb_build_object(
        'job', j.job,
        'startedAt', j.started_at,
        'status', j.status,
        'detail', null
    )
    into v_job
    from public.server_job_runs j
    where j.job = 'reminders'
    order by j.started_at desc
    limit 1;

    select revision into v_revision
    from public.organization_revisions
    where organization_id = p_organization_id;

    select jsonb_build_object(
        'volunteers', (select count(*) from public.volunteers where organization_id = p_organization_id),
        'opportunities', (select count(*) from public.opportunities where organization_id = p_organization_id),
        'shifts', (select count(*) from public.shifts where organization_id = p_organization_id),
        'registrations', (select count(*) from public.registrations
                          where organization_id = p_organization_id
                            and status in ('registered', 'confirmed')),
        'openHourEntries', (select count(*) from public.hour_entries
                            where organization_id = p_organization_id and status = 'pending'),
        'devices', (select count(*) from sync.devices where organization_id = p_organization_id),
        'pushSubscriptions', (select count(*) from public.push_subscriptions
                              where organization_id = p_organization_id and revoked_at is null)
    ) into v_counts;

    return jsonb_build_object(
        'status', 'ok',
        'revision', coalesce(v_revision, 0),
        'devices', v_devices,
        'lastBackup', v_backup,
        'lastJob', v_job,
        'counts', v_counts,
        'serverTime', now()
    );
end;
$$;

-- The preference read already has a caller-scoped SELECT policy.
alter function public.my_notification_preferences(uuid) security invoker;

-- Raw backup paths and server diagnostics are operator-only. The health RPC
-- returns a deliberately limited status projection instead.
revoke select on public.backup_runs, public.server_job_runs from authenticated;

-- Explicit denial documents the intentionally closed internal tables.
create policy devices_no_direct_access on sync.devices
    for all to authenticated using (false) with check (false);
create policy processed_operations_no_direct_access on sync.processed_operations
    for all to authenticated using (false) with check (false);

-- A replay cannot retrieve a different actor's result or turn a refusal into success.
create or replace function public.apply_command(
    p_operation_id uuid,
    p_organization_id uuid,
    p_replica_id uuid,
    p_command text,
    p_base_revision bigint,
    p_entity_versions jsonb,
    p_payload jsonb,
    p_client_created_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_actor uuid := auth.uid();
    v_role text;
    v_status text;
    v_epoch integer;
    v_claimed_epoch integer;
    v_result jsonb;
    v_existing jsonb;
    v_code text;
    v_detail text;
    v_hint text;
    v_revision bigint;
    v_cursor bigint;
begin
    if v_actor is null then
        return jsonb_build_object(
            'status', 'forbidden',
            'code', 'unauthenticated',
            'message', 'Sign in to change this organization.'
        );
    end if;

    -- Lock the organization revision first, then read and lock membership so
    -- a role change cannot race the command authorization decision.
    perform 1 from public.organization_revisions
    where organization_id = p_organization_id for update;

    -- The membership is read regardless of status: a device whose access was
    -- revoked has to be told that its queued work is stale, not simply that the
    -- organization is missing. The two answers lead to different recovery.
    select m.role, m.status, m.membership_epoch into v_role, v_status, v_epoch
    from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = v_actor
    for share;

    if v_role is null then
        return jsonb_build_object(
            'status', 'forbidden',
            'code', 'not_a_member',
            'message', 'You are not a member of this organization.'
        );
    end if;

    v_claimed_epoch := nullif(p_payload ->> 'membershipEpoch', '')::integer;

    if v_status <> 'active' then
        if v_claimed_epoch is not null then
            return jsonb_build_object(
                'status', 'stale_authority',
                'code', 'stale_authority',
                'message', 'Your access was changed while this device was offline.',
                'membershipEpoch', v_epoch,
                'operationId', p_operation_id
            );
        end if;

        return jsonb_build_object(
            'status', 'forbidden',
            'code', 'membership_inactive',
            'message', 'Your access to this organization is not active.'
        );
    end if;

    -- A device that queued work while it had access cannot keep that access by
    -- replaying it later. This check runs before the ledger so a refused
    -- command is never recorded as if it were a duplicate.
    if v_claimed_epoch is not null and v_claimed_epoch <> v_epoch then
        return jsonb_build_object(
            'status', 'stale_authority',
            'code', 'stale_authority',
            'message', 'Your access changed while this device was offline. Sign in again.',
            'membershipEpoch', v_epoch,
            'operationId', p_operation_id
        );
    end if;

    insert into sync.processed_operations
        (operation_id, organization_id, actor_id, replica_id, command_type,
         result_status, result_payload)
    values
        (p_operation_id, p_organization_id, v_actor, p_replica_id, p_command,
         'pending', null)
    on conflict (operation_id) do nothing;

    if not found then
        select result_payload into v_existing
        from sync.processed_operations
        where operation_id = p_operation_id
          and organization_id = p_organization_id and actor_id = v_actor;

        if not found then
            return jsonb_build_object('status', 'forbidden', 'code', 'operation_owner_mismatch');
        end if;
        if v_existing is null then
            return jsonb_build_object(
                'status', 'retryable_error',
                'code', 'operation_in_flight',
                'message', 'That operation is still being processed.'
            );
        end if;

        if v_existing ->> 'status' = 'applied' then
            return v_existing || jsonb_build_object('status', 'already_applied');
        end if;
        return v_existing;
    end if;

    perform set_config('civicflow.operation_id', p_operation_id::text, true);
    if p_replica_id is not null then
        perform set_config('civicflow.replica_id', p_replica_id::text, true);
    end if;

    begin
        v_result := sync.dispatch(
            p_organization_id, v_actor, v_role, p_command,
            coalesce(p_payload, '{}'::jsonb),
            coalesce(p_entity_versions, '{}'::jsonb),
            p_base_revision
        );
    exception when others then
        get stacked diagnostics
            v_code = message_text,
            v_detail = pg_exception_detail,
            v_hint = pg_exception_hint;

        v_result := jsonb_build_object(
            'status', sync.error_status(v_code),
            'code', v_code,
            'message', coalesce(nullif(v_detail, ''), v_code)
        );

        if v_hint is not null and left(btrim(v_hint), 1) = '{' then
            v_result := v_result || jsonb_build_object('authoritative', v_hint::jsonb);
        end if;
    end;

    select revision into v_revision
    from public.organization_revisions
    where organization_id = p_organization_id;

    select coalesce(max(sequence), 0) into v_cursor from sync.sync_changes;

    v_result := v_result || jsonb_build_object(
        'operationId', p_operation_id,
        'command', p_command,
        'serverRevision', coalesce(v_revision, 0),
        'cursor', coalesce(v_cursor, 0),
        'serverTime', now()
    );

    update sync.processed_operations
    set result_status = v_result ->> 'status',
        result_payload = v_result
    where operation_id = p_operation_id;

    -- A retryable failure is not a recorded outcome. Leaving the ledger row
    -- would turn the next attempt into "already applied" and hide the work.
    if v_result ->> 'status' = 'retryable_error' then
        delete from sync.processed_operations where operation_id = p_operation_id;
    end if;

    if p_replica_id is not null then
        insert into sync.devices (id, organization_id, user_id, platform, last_seen_at)
        values (p_replica_id, p_organization_id, v_actor, '', now())
        on conflict (id, organization_id, user_id) do update
            set last_seen_at = now();
    end if;

    return v_result;
end;
$$;

-- The delivery health read is already covered by staff-scoped table RLS.
alter function public.delivery_health(uuid) security invoker;
