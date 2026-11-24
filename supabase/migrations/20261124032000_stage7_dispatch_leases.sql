-- Recover crashed dispatcher claims and fence stale completions.
alter table public.notification_deliveries add column claimed_at timestamptz;
update public.notification_deliveries set claimed_at = now() where status = 'sending';

create or replace function public.dispatch_reminders(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_generated integer;
    v_jobs jsonb;
begin
    perform private.require_service();

    if not pg_try_advisory_xact_lock(hashtext('civicflow.reminders')) then
        return jsonb_build_object('status', 'busy');
    end if;

    -- Recover an interrupted worker without reclaiming an active lease.
    update public.notification_deliveries
    set status = case when attempts >= 3 then 'failed' else 'scheduled' end,
        scheduled_at = now(),
        failed_at = case when attempts >= 3 then now() else failed_at end,
        last_error = 'dispatch_lease_expired'
    where status = 'sending' and claimed_at <= now() - interval '15 minutes';

    -- A revoked member or orphaned notification is not a valid recipient.
    update public.notification_deliveries d
    set status = 'skipped', last_error = 'recipient_no_longer_eligible'
    where d.status = 'scheduled'
      and (d.notification_id is null or not exists (
          select 1 from public.organization_memberships m
          where m.organization_id = d.organization_id and m.user_id = d.user_id
            and m.status = 'active'
      ));

    v_generated := private.generate_reminders(now());

    with due as (
        select d.id
        from public.notification_deliveries d
        where d.status = 'scheduled'
          and d.scheduled_at <= now()
          and d.notification_id is not null
          and exists (select 1 from public.organization_memberships m
              where m.organization_id = d.organization_id and m.user_id = d.user_id
                and m.status = 'active')
        order by d.scheduled_at
        limit least(greatest(coalesce(p_limit, 50), 0), 200)
        for update skip locked
    ),
    claimed as (
        update public.notification_deliveries d
        set status = 'sending', attempts = d.attempts + 1, claimed_at = now()
        from due
        where d.id = due.id
        returning d.id, d.notification_id, d.organization_id, d.user_id,
                  d.channel, d.attempts
    )
    select coalesce(jsonb_agg(jsonb_build_object(
        'deliveryId', c.id,
        'channel', c.channel,
        'attempts', c.attempts,
        'title', n.title,
        'body', n.body,
        'href', n.href,
        'priority', n.priority,
        'email', coalesce(p.email, ''),
        'phone', coalesce(v.phone, ''),
        'push', coalesce((
            select jsonb_agg(jsonb_build_object(
                'endpoint', ps.endpoint,
                'p256dh', ps.p256dh,
                'auth', ps.auth))
            from public.push_subscriptions ps
            where ps.organization_id = c.organization_id
              and ps.user_id = c.user_id
              and ps.revoked_at is null
        ), '[]'::jsonb)
    )), '[]'::jsonb)
    into v_jobs
    from claimed c
    join public.notifications n on n.id = c.notification_id
    left join public.profiles p on p.id = c.user_id
    left join public.organization_memberships m
        on m.organization_id = c.organization_id and m.user_id = c.user_id
    left join public.volunteers v on v.id = m.volunteer_id;

    return jsonb_build_object(
        'status', 'ok',
        'generated', v_generated,
        'claimed', jsonb_array_length(v_jobs),
        'jobs', v_jobs
    );
end;
$$;

create or replace function public.complete_delivery_attempt(
    p_id uuid, p_attempt integer, p_status text,
    p_error text default null, p_provider text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
    perform private.require_service();
    perform 1 from public.notification_deliveries
    where id = p_id and attempts = p_attempt and status = 'sending'
    for update;
    if not found then
        return jsonb_build_object('status', 'stale_attempt');
    end if;
    return public.complete_delivery(p_id, p_status, p_error, p_provider);
end;
$$;

revoke all on function public.complete_delivery_attempt(uuid, integer, text, text, text)
    from public, anon, authenticated;
grant execute on function public.complete_delivery_attempt(uuid, integer, text, text, text)
    to service_role;
