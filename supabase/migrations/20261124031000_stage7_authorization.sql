-- Stage 7: fail closed for absent memberships and bind devices to their owner.
-- Preserve the RPC signatures and the existing no-direct-write model.
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
    on conflict (id) do update
        set label = excluded.label,
            platform = excluded.platform,
            last_seen_at = now()
        where sync.devices.user_id = excluded.user_id
          and sync.devices.organization_id = excluded.organization_id;

    if not found then
        return jsonb_build_object('status', 'forbidden', 'code', 'replica_owner_mismatch');
    end if;

    select cursor into v_cursor from sync.devices where id = p_replica_id;

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

    insert into sync.devices (id, organization_id, user_id, cursor, last_seen_at, platform)
    values (p_replica_id, p_organization_id, auth.uid(), greatest(coalesce(p_cursor, 0), 0),
            now(), '')
    on conflict (id) do update
        set cursor = greatest(coalesce(p_cursor, 0), 0),
            pending_operations = coalesce(p_pending, 0),
            oldest_pending_at = p_oldest_pending_at,
            last_error = p_error,
            last_seen_at = now(),
            last_successful_sync_at = case when p_error is null then now()
                                           else sync.devices.last_successful_sync_at end,
            organization_id = excluded.organization_id
        where sync.devices.user_id = excluded.user_id
          and sync.devices.organization_id = excluded.organization_id;

    if not found then
        return jsonb_build_object('status', 'forbidden', 'code', 'replica_owner_mismatch');
    end if;

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
