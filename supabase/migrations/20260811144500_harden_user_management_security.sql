-- ============================================================
-- OBI OPERATIONS PORTAL
-- PHASE 3, STEP 2B.2: USER MANAGEMENT SECURITY HARDENING
-- ============================================================
--
-- This migration intentionally leaves the two previously-applied
-- migrations untouched.
--
-- Goals:
--   1. Ensure privileged profile reads require an ACTIVE account.
--   2. Keep self-profile reads available so blocked users can be
--      identified by application authorization logic.
--   3. Provide a reusable active-portal-user helper for future RLS.
--   4. Make user-management audit events append-only for the
--      application service role.
-- ============================================================

-- ============================================================
-- 1. ACTIVE PORTAL USER CHECK
-- ============================================================

create or replace function public.is_active_portal_user()
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
      and status = 'active'::public.account_status
  );
$$;

revoke all
on function public.is_active_portal_user()
from public;

grant execute
on function public.is_active_portal_user()
to authenticated;

comment on function public.is_active_portal_user() is
  'Returns true only when the authenticated user has an active portal profile.';

-- ============================================================
-- 2. HARDEN LEGACY PRIVILEGED HELPER
--
-- The original helper checked role only. Keep the function name for
-- compatibility, but require the account to be active as well.
-- ============================================================

create or replace function public.is_privileged_user()
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
on function public.is_privileged_user()
from public;

grant execute
on function public.is_privileged_user()
to authenticated;

comment on function public.is_privileged_user() is
  'Returns true only for active Admin or Supervisor portal profiles.';

-- ============================================================
-- 3. HARDEN PROFILES SELECT POLICY
--
-- Every authenticated user may still read their own profile. This is
-- required so application authorization can detect invited, inactive,
-- or suspended status and show the correct blocked-account response.
--
-- Reading other profiles requires an active Admin/Supervisor account.
-- ============================================================

drop policy if exists
  profiles_select_own_or_privileged
on public.profiles;

create policy profiles_select_own_or_privileged
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or (select public.is_active_privileged_user())
);

-- ============================================================
-- 4. MAKE MANAGEMENT AUDIT EVENTS APPEND-ONLY FOR APP OPERATIONS
--
-- Existing application code only inserts audit events. Prevent normal
-- service-role application operations from changing or deleting audit
-- history after it has been written.
-- ============================================================

revoke update, delete, truncate
on table public.user_management_events
from service_role;

grant select, insert
on table public.user_management_events
to service_role;

comment on table public.user_management_events is
  'Append-only audit history for portal user-management actions.';
