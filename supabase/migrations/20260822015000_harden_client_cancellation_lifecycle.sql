
create or replace function public.close_client_operations_on_cancellation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status
    and new.status = 'cancelled'::public.portal_client_status then

    -- --------------------------------------------------------
    -- 1. Close all active Agent assignments belonging to
    --    Projects under this Client.
    --
    -- Do this before cancelling Projects so assignment history
    -- records the more specific client_cancelled reason.
    -- --------------------------------------------------------

    update public.project_assignments as assignment
    set
      status = 'inactive'::public.portal_assignment_status,
      unassigned_at = coalesce(assignment.unassigned_at, now()),
      unassignment_reason =
        'client_cancelled'::public.portal_assignment_end_reason
    from public.projects as project
    where assignment.project_id = project.id
      and project.client_id = new.id
      and assignment.status =
        'active'::public.portal_assignment_status;


    -- --------------------------------------------------------
    -- 2. Cancel every Project belonging to the Client.
    --
    -- The existing Project cancellation trigger will also run,
    -- but assignments have already been closed above, so their
    -- client_cancelled reason is preserved.
    -- --------------------------------------------------------

    update public.projects
    set status = 'cancelled'::public.portal_project_status
    where client_id = new.id
      and status <> 'cancelled'::public.portal_project_status;

  end if;

  return new;
end;
$$;


revoke all
on function public.close_client_operations_on_cancellation()
from public;


create trigger clients_close_operations_on_cancellation
after update of status
on public.clients
for each row
execute function public.close_client_operations_on_cancellation();


comment on function public.close_client_operations_on_cancellation() is
  'Closes active Agent assignments and cancels child Projects when a Client becomes cancelled. Reactivation does not restore Projects or assignments.';