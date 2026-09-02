-- ============================================================
-- OBI OPERATIONS PORTAL
-- PHASE 4.5A.1: PROJECT ASSIGNMENT LIFECYCLE HARDENING
-- ============================================================

-- ============================================================
-- 1. ASSIGNMENT END REASONS
--
-- Assignment history is preserved. Instead of deleting an
-- assignment, the assignment period is closed and given a reason.
-- ============================================================

create type public.portal_assignment_end_reason as enum (
  'manual',
  'reassigned',
  'project_cancelled',
  'client_cancelled',
  'agent_role_changed'
);

alter table public.project_assignments
add column unassignment_reason public.portal_assignment_end_reason;

-- Active assignments must never have an ending reason.
--
-- Historical inactive assignments created before this migration
-- are allowed to have a null reason.
alter table public.project_assignments
add constraint project_assignments_unassignment_reason_check
check (
  status = 'inactive'::public.portal_assignment_status
  or unassignment_reason is null
);

comment on column public.project_assignments.unassignment_reason is
  'Explains why an assignment period ended. Historical inactive assignments created before this column may be null.';


-- ============================================================
-- 2. CLOSE ACTIVE ASSIGNMENTS WHEN A PROJECT IS CANCELLED
--
-- Inactive projects temporarily block access but preserve their
-- active assignment periods.
--
-- Cancelled projects permanently close active assignment periods.
-- Reactivating the project does not reactivate old assignments.
-- ============================================================

create or replace function public.close_active_assignments_on_project_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
    and new.status = 'cancelled'::public.portal_project_status then

    update public.project_assignments
    set
      status = 'inactive'::public.portal_assignment_status,
      unassigned_at = coalesce(unassigned_at, now()),
      unassignment_reason =
        'project_cancelled'::public.portal_assignment_end_reason
    where project_id = new.id
      and status = 'active'::public.portal_assignment_status;

  end if;

  return new;
end;
$$;

revoke all
on function public.close_active_assignments_on_project_cancellation()
from public;

create trigger projects_close_assignments_on_cancellation
after update of status
on public.projects
for each row
execute function public.close_active_assignments_on_project_cancellation();


-- ============================================================
-- 3. DOCUMENTATION
-- ============================================================

comment on function public.close_active_assignments_on_project_cancellation() is
  'Closes all active Agent assignment periods when a project becomes cancelled. Reactivating the project does not restore those assignment periods.';