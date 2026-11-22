-- Block cross-organization notification mutations through the privileged
-- single-notification read receipt RPC. Its old WHERE clause accepted a
-- broadcast notification (volunteer_id IS NULL) without membership proof.
-- Keep the existing authenticated EXECUTE grant; the RPC still enforces
-- staff-vs-volunteer visibility for members of the owning organization.
create or replace function public.mark_notification_read(p_notification_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_id uuid;
begin
    update public.notifications n
    set read_at = coalesce(n.read_at, now())
    where n.id = p_notification_id
      and private.is_member(n.organization_id)
      and (private.is_staff(n.organization_id)
           or (n.audience in ('volunteer', 'all')
               and (n.volunteer_id is null
                    or n.volunteer_id = private.own_volunteer_id(n.organization_id))))
    returning n.id into v_id;

    if v_id is null then
        return jsonb_build_object('status', 'not_found');
    end if;

    return jsonb_build_object('status', 'ok', 'id', v_id);
end;
$$;
