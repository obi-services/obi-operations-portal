-- OBI Operations Portal
-- Core authentication and profile foundation

-- =========================================================
-- ENUM TYPES
-- =========================================================

create type public.app_role as enum (
  'admin',
  'supervisor',
  'agent'
);

create type public.account_status as enum (
  'invited',
  'active',
  'inactive',
  'suspended'
);


-- =========================================================
-- PROFILES TABLE
-- =========================================================

create table public.profiles (
  id uuid primary key
    references auth.users(id)
    on delete cascade,

  email text not null,
  full_name text not null default '',

  role public.app_role not null default 'agent',
  status public.account_status not null default 'invited',

  invited_by uuid
    references auth.users(id)
    on delete set null,

  accepted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_email_not_blank
    check (btrim(email) <> '')
);


-- =========================================================
-- INDEXES
-- =========================================================

create unique index profiles_email_lower_unique
  on public.profiles (lower(email));

create index profiles_role_status_idx
  on public.profiles (role, status);

create index profiles_invited_by_idx
  on public.profiles (invited_by);


-- =========================================================
-- UPDATED_AT TRIGGER
-- =========================================================

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

create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();


-- =========================================================
-- CREATE PROFILE AFTER AUTH USER IS CREATED
-- =========================================================

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_name text;
begin
  generated_name := coalesce(
    nullif(
      btrim(new.raw_user_meta_data ->> 'full_name'),
      ''
    ),
    split_part(
      coalesce(new.email, ''),
      '@',
      1
    )
  );

  insert into public.profiles (
    id,
    email,
    full_name,
    role,
    status
  )
  values (
    new.id,
    lower(new.email),
    generated_name,
    'agent'::public.app_role,
    case
      when new.email_confirmed_at is null then
        'invited'::public.account_status
      else
        'active'::public.account_status
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_auth_user();


-- =========================================================
-- UPDATE PROFILE AFTER INVITATION ACCEPTANCE
-- =========================================================

create or replace function public.handle_auth_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles
    set email = lower(new.email)
    where id = new.id;
  end if;

  if old.email_confirmed_at is null
     and new.email_confirmed_at is not null then

    update public.profiles
    set
      status = case
        when status = 'invited'::public.account_status then
          'active'::public.account_status
        else
          status
      end,

      accepted_at = coalesce(
        accepted_at,
        now()
      )

    where id = new.id;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_updated
after update of email, email_confirmed_at
on auth.users
for each row
execute function public.handle_auth_user_updated();


-- =========================================================
-- ROLE HELPER FUNCTIONS
-- =========================================================

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles as profile
  where profile.id = auth.uid();
$$;


create or replace function public.is_privileged_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    public.current_user_role() in (
      'admin'::public.app_role,
      'supervisor'::public.app_role
    ),
    false
  );
$$;


-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

alter table public.profiles
enable row level security;


-- Users may read their own profile.
-- Admins and supervisors may read every profile.

create policy profiles_select_own_or_privileged
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or public.is_privileged_user()
);


-- =========================================================
-- TABLE PERMISSIONS
-- =========================================================

revoke all
on table public.profiles
from anon;

revoke insert, update, delete
on table public.profiles
from authenticated;

grant select
on table public.profiles
to authenticated;


-- =========================================================
-- FUNCTION PERMISSIONS
-- =========================================================

revoke all
on function public.handle_new_auth_user()
from public;

revoke all
on function public.handle_auth_user_updated()
from public;

revoke all
on function public.set_updated_at()
from public;

revoke all
on function public.current_user_role()
from public;

revoke all
on function public.is_privileged_user()
from public;

grant execute
on function public.current_user_role()
to authenticated;

grant execute
on function public.is_privileged_user()
to authenticated;


-- =========================================================
-- DOCUMENTATION
-- =========================================================

comment on table public.profiles is
  'Portal user profiles linked one-to-one with Supabase Auth users.';

comment on column public.profiles.role is
  'Application role: admin, supervisor, or agent.';

comment on column public.profiles.status is
  'Portal account lifecycle status: invited, active, inactive, or suspended.';