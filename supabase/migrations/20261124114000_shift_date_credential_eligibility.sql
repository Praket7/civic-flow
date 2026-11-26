-- Align hosted eligibility with native matching: evaluate credentials and age on the
-- shift's local calendar date, and require staff verification of credentials.
create or replace function sync.assert_eligible(
    p_organization_id uuid,
    p_shift_id uuid,
    p_volunteer_id uuid,
    p_role text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    r record;
    v_age integer;
    v_shift_date date;
begin
    if p_role is null or btrim(p_role) = '' then
        return;
    end if;

    select (s.starts_at at time zone o.timezone)::date into v_shift_date
    from public.shifts s
    join public.organizations o on o.id = s.organization_id
    where s.id = p_shift_id and s.organization_id = p_organization_id;

    if v_shift_date is null then
        perform sync.fail('unknown_shift', 'That shift does not belong to this organization.');
    end if;

    if not exists (
        select 1 from public.shift_roles
        where organization_id = p_organization_id and shift_id = p_shift_id and name = p_role
    ) then
        perform sync.fail('unknown_role', 'That shift does not have the requested role.');
    end if;

    for r in
        select * from public.role_requirements
        where organization_id = p_organization_id and shift_id = p_shift_id and role_name = p_role
    loop
        if r.skill is not null and not exists (
            select 1 from public.volunteer_skills
            where organization_id = p_organization_id and volunteer_id = p_volunteer_id and skill = r.skill
        ) then
            perform sync.fail('skill_missing', format('This role needs the %s skill.', r.skill));
        end if;

        if r.credential_type_id is not null and not exists (
            select 1 from public.volunteer_credentials c
            where c.organization_id = p_organization_id and c.volunteer_id = p_volunteer_id
              and c.credential_type_id = r.credential_type_id
              and c.verified_at is not null
              and c.valid_from <= v_shift_date
              and c.valid_through >= v_shift_date
        ) then
            perform sync.fail('credential_missing', 'This role needs a current credential.');
        end if;

        if r.minimum_age is not null then
            select case when birthdate is null then null
                        else date_part('year', age(v_shift_date, birthdate))::integer end
            into v_age
            from public.volunteers
            where organization_id = p_organization_id and id = p_volunteer_id;

            if v_age is null or v_age < r.minimum_age then
                perform sync.fail('age_requirement',
                    format('This role is limited to volunteers aged %s or older.', r.minimum_age));
            end if;
        end if;
    end loop;
end;
$$;
