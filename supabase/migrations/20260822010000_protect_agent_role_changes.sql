-- ============================================================
-- OBI OPERATIONS PORTAL
-- PHASE 4.5A.2: PROTECT AGENT ROLE CHANGES
-- ============================================================

-- An Agent with active Project assignments cannot be changed
-- to Supervisor or Admin.
--
-- Operations must first close the Agent's active assignments.
-- This prevents historical assignments from becoming effective
-- again if the user later returns to the Agent role.

create or replace function public.prevent_agent_role_change_with_active_assignments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'agent'::public.app_role
    and new.role <> 'agent'::public.app_role
    and exists (
      select 1
      from public.project_assignments as assignment
      where assignment.agent_user_id = old.id
        and assignment.status =
          'active'::public.portal_assignment_status
    ) then

    raise exception using
      errcode = 'P0001',
      message =
        'Active project assignments must be removed before changing an Agent to another role.';

  end if;

  return new;
end;
$$;

revoke all
on function public.prevent_agent_role_change_with_active_assignments()
from public;

create trigger profiles_prevent_agent_role_change_with_active_assignments
before update of role
on public.profiles
for each row
when (old.role is distinct from new.role)
execute function public.prevent_agent_role_change_with_active_assignments();

comment on function public.prevent_agent_role_change_with_active_assignments() is
  'Prevents an Agent with active Project assignments from being changed to Supervisor or Admin.';