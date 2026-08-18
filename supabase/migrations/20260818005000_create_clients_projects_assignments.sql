-- ============================================================
-- OBI OPERATIONS PORTAL
-- PHASE 4: CLIENTS & ASSIGNMENTS DATABASE FOUNDATION
-- ============================================================

-- ============================================================
-- 1. ENUM TYPES
-- ============================================================

create type public.portal_client_status as enum (
  'active',
  'inactive',
  'cancelled'
);

create type public.portal_project_status as enum (
  'active',
  'inactive',
  'cancelled'
);

create type public.portal_assignment_status as enum (
  'active',
  'inactive'
);

-- ============================================================
-- 2. CLIENTS
-- ============================================================

create table public.clients (
  id uuid primary key default gen_random_uuid(),

  client_code text not null,
  client_name text not null,

  status public.portal_client_status not null
    default 'active'::public.portal_client_status,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint clients_client_code_not_blank
    check (length(btrim(client_code)) > 0),

  constraint clients_client_name_not_blank
    check (length(btrim(client_name)) > 0)
);

create unique index clients_client_code_lower_unique
  on public.clients (lower(client_code));

create index clients_status_idx
  on public.clients (status);

create index clients_name_idx
  on public.clients (client_name);

-- ============================================================
-- 3. PROJECTS
-- ============================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),

  client_id uuid not null
    references public.clients(id)
    on delete restrict,

  external_project_id text not null,
  project_name text not null,
  task_id_prefix text,

  status public.portal_project_status not null
    default 'active'::public.portal_project_status,

  include_in_dashboard boolean not null default true,
  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint projects_external_project_id_not_blank
    check (length(btrim(external_project_id)) > 0),

  constraint projects_project_name_not_blank
    check (length(btrim(project_name)) > 0),

  constraint projects_task_id_prefix_not_blank
    check (
      task_id_prefix is null
      or length(btrim(task_id_prefix)) > 0
    )
);

create unique index projects_external_project_id_lower_unique
  on public.projects (lower(external_project_id));

create unique index projects_task_id_prefix_lower_unique
  on public.projects (lower(task_id_prefix))
  where task_id_prefix is not null;

create index projects_client_idx
  on public.projects (client_id);

create index projects_status_idx
  on public.projects (status);

create index projects_client_status_idx
  on public.projects (client_id, status);

-- ============================================================
-- 4. PROJECT ASSIGNMENTS
--
-- Each row represents one assignment period. When an assignment
-- ends, the row becomes inactive. Reassignment creates a new row
-- so historical assignment periods remain intact.
-- ============================================================

create table public.project_assignments (
  id uuid primary key default gen_random_uuid(),

  project_id uuid not null
    references public.projects(id)
    on delete restrict,

  agent_user_id uuid not null
    references public.profiles(id)
    on delete restrict,

  status public.portal_assignment_status not null
    default 'active'::public.portal_assignment_status,

  assigned_by uuid
    references public.profiles(id)
    on delete set null,

  assigned_at timestamptz not null default now(),

  unassigned_by uuid
    references public.profiles(id)
    on delete set null,

  unassigned_at timestamptz,

  notes text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint project_assignments_status_dates_check
    check (
      (
        status = 'active'::public.portal_assignment_status
        and unassigned_at is null
      )
      or
      (
        status = 'inactive'::public.portal_assignment_status
        and unassigned_at is not null
      )
    )
);

create unique index project_assignments_one_active_pair_idx
  on public.project_assignments (project_id, agent_user_id)
  where status = 'active'::public.portal_assignment_status;

create index project_assignments_project_idx
  on public.project_assignments (project_id);

create index project_assignments_agent_idx
  on public.project_assignments (agent_user_id);

create index project_assignments_agent_status_idx
  on public.project_assignments (agent_user_id, status);

create index project_assignments_project_status_idx
  on public.project_assignments (project_id, status);

-- ============================================================
-- 5. UPDATED_AT TRIGGERS
-- ============================================================

create trigger clients_set_updated_at
before update on public.clients
for each row
execute function public.set_updated_at();

create trigger projects_set_updated_at
before update on public.projects
for each row
execute function public.set_updated_at();

create trigger project_assignments_set_updated_at
before update on public.project_assignments
for each row
execute function public.set_updated_at();

-- ============================================================
-- 6. ASSIGNMENT VALIDATION
--
-- Active assignments may only point to an active Agent profile
-- and an active project. Assignment identity is immutable after
-- creation. An inactive historical assignment cannot be reactivated;
-- a future reassignment must create a new row.
-- ============================================================

create or replace function public.validate_project_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_role public.app_role;
  target_status public.account_status;
  target_project_status public.portal_project_status;
  target_client_status public.portal_client_status;
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id
      or new.agent_user_id is distinct from old.agent_user_id
      or new.assigned_at is distinct from old.assigned_at then
      raise exception 'Project assignment identity cannot be changed after creation.';
    end if;

    if old.status = 'inactive'::public.portal_assignment_status
      and new.status = 'active'::public.portal_assignment_status then
      raise exception 'Inactive assignment history cannot be reactivated. Create a new assignment instead.';
    end if;
  end if;

  if new.status = 'active'::public.portal_assignment_status then
    select profile.role, profile.status
      into target_role, target_status
    from public.profiles as profile
    where profile.id = new.agent_user_id;

    if not found then
      raise exception 'Assigned portal profile does not exist.';
    end if;

    if target_role <> 'agent'::public.app_role then
      raise exception 'Only Agent profiles may receive project assignments.';
    end if;

    if target_status <> 'active'::public.account_status then
      raise exception 'Only active Agent profiles may receive active project assignments.';
    end if;

    select project.status, client.status
      into target_project_status, target_client_status
    from public.projects as project
    join public.clients as client
      on client.id = project.client_id
    where project.id = new.project_id;

    if not found then
      raise exception 'Assigned project does not exist.';
    end if;

    if target_project_status <> 'active'::public.portal_project_status then
      raise exception 'Only active projects may receive active Agent assignments.';
    end if;

    if target_client_status <> 'active'::public.portal_client_status then
      raise exception 'Only projects belonging to active clients may receive active Agent assignments.';
    end if;

    new.unassigned_at := null;
    new.unassigned_by := null;
  elsif new.status = 'inactive'::public.portal_assignment_status then
    new.unassigned_at := coalesce(new.unassigned_at, now());
  end if;

  return new;
end;
$$;

revoke all
on function public.validate_project_assignment()
from public;

create trigger project_assignments_validate
before insert or update
on public.project_assignments
for each row
execute function public.validate_project_assignment();

-- ============================================================
-- 7. ACCESS HELPER FUNCTIONS
--
-- These helpers are SECURITY DEFINER because they are intended for
-- RLS policies and must inspect assignment/profile data without
-- recursively depending on those same policies.
-- ============================================================

create or replace function public.is_active_agent_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'agent'::public.app_role
      and status = 'active'::public.account_status
  );
$$;

revoke all
on function public.is_active_agent_user()
from public;

grant execute
on function public.is_active_agent_user()
to authenticated, service_role;

create or replace function public.is_active_agent_assigned_to_project(
  target_project_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.project_assignments as assignment
    join public.projects as project
      on project.id = assignment.project_id
    join public.clients as client
      on client.id = project.client_id
    join public.profiles as profile
      on profile.id = assignment.agent_user_id
    where assignment.project_id = target_project_id
      and assignment.agent_user_id = (select auth.uid())
      and assignment.status = 'active'::public.portal_assignment_status
      and project.status = 'active'::public.portal_project_status
      and client.status = 'active'::public.portal_client_status
      and profile.role = 'agent'::public.app_role
      and profile.status = 'active'::public.account_status
  );
$$;

revoke all
on function public.is_active_agent_assigned_to_project(uuid)
from public;

grant execute
on function public.is_active_agent_assigned_to_project(uuid)
to authenticated, service_role;

create or replace function public.is_active_agent_assigned_to_client(
  target_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.projects as project
    join public.clients as client
      on client.id = project.client_id
    join public.project_assignments as assignment
      on assignment.project_id = project.id
    join public.profiles as profile
      on profile.id = assignment.agent_user_id
    where project.client_id = target_client_id
      and client.status = 'active'::public.portal_client_status
      and project.status = 'active'::public.portal_project_status
      and assignment.agent_user_id = (select auth.uid())
      and assignment.status = 'active'::public.portal_assignment_status
      and profile.role = 'agent'::public.app_role
      and profile.status = 'active'::public.account_status
  );
$$;

revoke all
on function public.is_active_agent_assigned_to_client(uuid)
from public;

grant execute
on function public.is_active_agent_assigned_to_client(uuid)
to authenticated, service_role;

-- ============================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================

alter table public.clients
  enable row level security;

alter table public.projects
  enable row level security;

alter table public.project_assignments
  enable row level security;

-- Remove broad default privileges. Client/project/assignment changes
-- are performed by trusted server-side application code only.

revoke all
on table public.clients
from anon, authenticated;

revoke all
on table public.projects
from anon, authenticated;

revoke all
on table public.project_assignments
from anon, authenticated;

grant select
on table public.clients
  to authenticated;

grant select
on table public.projects
  to authenticated;

grant select
on table public.project_assignments
  to authenticated;

grant all
on table public.clients
  to service_role;

grant all
on table public.projects
  to service_role;

grant all
on table public.project_assignments
  to service_role;

-- Active Admins/Supervisors may read every client.
-- Active Agents may read only clients containing an active project
-- assignment that belongs to them.

create policy clients_select_authorized
on public.clients
for select
to authenticated
using (
  (select public.is_active_privileged_user())
  or
  (select public.is_active_agent_assigned_to_client(id))
);

-- Active Admins/Supervisors may read every project.
-- Active Agents may read only projects assigned to them.

create policy projects_select_authorized
on public.projects
for select
to authenticated
using (
  (select public.is_active_privileged_user())
  or
  (select public.is_active_agent_assigned_to_project(id))
);

-- Active Admins/Supervisors may inspect all assignment records.
-- Active Agents may read only their own active assignments.

create policy project_assignments_select_authorized
on public.project_assignments
for select
to authenticated
using (
  (select public.is_active_privileged_user())
  or
  (
    agent_user_id = (select auth.uid())
    and status = 'active'::public.portal_assignment_status
    and (select public.is_active_agent_user())
    and (select public.is_active_agent_assigned_to_project(project_id))
  )
);

-- ============================================================
-- 9. DOCUMENTATION
-- ============================================================

comment on table public.clients is
  'Core OBI client records. Credit-plan configuration is stored separately in Phase 5.';

comment on column public.clients.client_code is
  'Stable client-facing/internal identifier such as CL-001 from the legacy tracker.';

comment on table public.projects is
  'Projects belonging to OBI clients. external_project_id maps to the Project ID used by operational source systems.';

comment on column public.projects.task_id_prefix is
  'Optional task identifier prefix used to associate operational task records with the project.';

comment on column public.projects.include_in_dashboard is
  'Controls whether the project should appear in operational dashboard views when otherwise eligible.';

comment on table public.project_assignments is
  'Historical Agent-to-project assignment periods. Inactive rows are retained; reassignment creates a new row.';

comment on function public.is_active_agent_user() is
  'Returns true only when the current authenticated portal profile is an active Agent.';

comment on function public.is_active_agent_assigned_to_project(uuid) is
  'Returns true when the current authenticated user is an active Agent with an active assignment to the specified active project.';

comment on function public.is_active_agent_assigned_to_client(uuid) is
  'Returns true when the current authenticated user is an active Agent assigned to at least one active project belonging to the specified client.';
