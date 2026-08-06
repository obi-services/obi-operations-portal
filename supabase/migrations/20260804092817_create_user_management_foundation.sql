-- ============================================================
-- OBI OPERATIONS PORTAL
-- PHASE 3: USER MANAGEMENT FOUNDATION
-- ============================================================

-- ============================================================
-- 1. INVITATION STATUS TYPE
-- ============================================================

do $$
begin
  create type public.portal_invitation_status as enum (
    'pending',
    'accepted',
    'expired',
    'revoked',
    'failed'
  );
exception
  when duplicate_object then null;
end
$$;

-- ============================================================
-- 2. USER MANAGEMENT ACTION TYPE
-- ============================================================

do $$
begin
  create type public.user_management_action as enum (
    'user_invited',
    'invitation_resent',
    'invitation_revoked',
    'invitation_accepted',
    'invitation_failed',
    'role_changed',
    'status_changed'
  );
exception
  when duplicate_object then null;
end
$$;

-- ============================================================
-- 3. ACTIVE PRIVILEGED USER CHECK
--
-- Admin and Supervisor accounts are privileged only while their
-- portal profile is active.
-- ============================================================

create or replace function public.is_active_privileged_user()
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
      and role in (
        'admin'::public.app_role,
        'supervisor'::public.app_role
      )
      and status = 'active'::public.account_status
  );
$$;

revoke all
on function public.is_active_privileged_user()
from public;

grant execute
on function public.is_active_privileged_user()
to authenticated, service_role;

-- ============================================================
-- 4. UPDATED-AT TRIGGER FUNCTION
-- ============================================================

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all
on function public.set_updated_at()
from public;

-- ============================================================
-- 5. USER INVITATIONS
--
-- Stores the current and historical state of portal invitations.
-- Supabase Auth remains the source of truth for authentication.
-- ============================================================

create table if not exists public.user_invitations (
  id uuid primary key default gen_random_uuid(),

  email text not null,
  full_name text not null,

  role public.app_role not null
    default 'agent'::public.app_role,

  status public.portal_invitation_status not null
    default 'pending'::public.portal_invitation_status,

  invited_user_id uuid
    references auth.users(id)
    on delete set null,

  invited_by uuid
    references public.profiles(id)
    on delete set null,

  sent_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  send_count integer not null default 1,

  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,

  failure_message text,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint user_invitations_email_not_blank
    check (length(trim(email)) > 3),

  constraint user_invitations_full_name_not_blank
    check (length(trim(full_name)) > 0),

  constraint user_invitations_send_count_positive
    check (send_count > 0)
);

-- Only one pending invitation may exist for an email address.

create unique index if not exists
  user_invitations_one_pending_email_idx
on public.user_invitations (
  lower(email)
)
where status = 'pending'::public.portal_invitation_status;

create index if not exists
  user_invitations_status_idx
on public.user_invitations(status);

create index if not exists
  user_invitations_invited_user_idx
on public.user_invitations(invited_user_id);

create index if not exists
  user_invitations_invited_by_idx
on public.user_invitations(invited_by);

create index if not exists
  user_invitations_created_at_idx
on public.user_invitations(created_at desc);

drop trigger if exists
  user_invitations_set_updated_at
on public.user_invitations;

create trigger user_invitations_set_updated_at
before update
on public.user_invitations
for each row
execute function public.set_updated_at();

-- ============================================================
-- 6. USER MANAGEMENT EVENTS
--
-- Immutable audit records for invitations, role changes, and
-- account-status changes.
-- ============================================================

create table if not exists public.user_management_events (
  id uuid primary key default gen_random_uuid(),

  actor_user_id uuid
    references public.profiles(id)
    on delete set null,

  target_user_id uuid
    references public.profiles(id)
    on delete set null,

  invitation_id uuid
    references public.user_invitations(id)
    on delete set null,

  target_email text not null,

  action public.user_management_action not null,

  details jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  constraint user_management_events_target_email_not_blank
    check (length(trim(target_email)) > 3)
);

create index if not exists
  user_management_events_actor_idx
on public.user_management_events(actor_user_id);

create index if not exists
  user_management_events_target_idx
on public.user_management_events(target_user_id);

create index if not exists
  user_management_events_invitation_idx
on public.user_management_events(invitation_id);

create index if not exists
  user_management_events_action_idx
on public.user_management_events(action);

create index if not exists
  user_management_events_created_at_idx
on public.user_management_events(created_at desc);

-- ============================================================
-- 7. AUTOMATIC INVITATION ACCEPTANCE TRACKING
--
-- When an invited profile changes to active, its pending
-- invitation is marked accepted automatically.
-- ============================================================

create or replace function public.mark_pending_invitation_accepted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepted_invitation_id uuid;
begin
  if new.status = 'active'::public.account_status
     and old.status is distinct from new.status then

    update public.user_invitations
    set
      status = 'accepted'::public.portal_invitation_status,
      invited_user_id = new.id,
      accepted_at = coalesce(new.accepted_at, now()),
      updated_at = now()
    where lower(email) = lower(new.email)
      and status = 'pending'::public.portal_invitation_status
    returning id into accepted_invitation_id;

    if accepted_invitation_id is not null then
      insert into public.user_management_events (
        actor_user_id,
        target_user_id,
        invitation_id,
        target_email,
        action,
        details
      )
      values (
        new.id,
        new.id,
        accepted_invitation_id,
        new.email,
        'invitation_accepted'::public.user_management_action,
        jsonb_build_object(
          'role', new.role,
          'accepted_at', coalesce(new.accepted_at, now())
        )
      );
    end if;
  end if;

  return new;
end;
$$;

revoke all
on function public.mark_pending_invitation_accepted()
from public;

drop trigger if exists
  profiles_mark_invitation_accepted
on public.profiles;

create trigger profiles_mark_invitation_accepted
after update of status
on public.profiles
for each row
execute function public.mark_pending_invitation_accepted();

-- ============================================================
-- 8. ROW LEVEL SECURITY
-- ============================================================

alter table public.user_invitations
enable row level security;

alter table public.user_management_events
enable row level security;

-- Remove broad default permissions.

revoke all
on table public.user_invitations
from anon, authenticated;

revoke all
on table public.user_management_events
from anon, authenticated;

-- Authenticated Admins and Supervisors may read management data.

grant select
on table public.user_invitations
to authenticated;

grant select
on table public.user_management_events
to authenticated;

-- Server-only administrative clients may perform all operations.

grant all
on table public.user_invitations
to service_role;

grant all
on table public.user_management_events
to service_role;

drop policy if exists
  user_invitations_select_privileged
on public.user_invitations;

create policy user_invitations_select_privileged
on public.user_invitations
for select
to authenticated
using (
  (select public.is_active_privileged_user())
);

drop policy if exists
  user_management_events_select_privileged
on public.user_management_events;

create policy user_management_events_select_privileged
on public.user_management_events
for select
to authenticated
using (
  (select public.is_active_privileged_user())
);

-- ============================================================
-- 9. TABLE DOCUMENTATION
-- ============================================================

comment on table public.user_invitations is
  'Tracks portal user invitations and their lifecycle.';

comment on table public.user_management_events is
  'Immutable audit history for portal user management actions.';
