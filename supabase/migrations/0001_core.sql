-- Leela core schema: families joined by a secret code, children, events, timers, imports.
-- Every table is protected by Row Level Security; a person only ever sees their own family.

create schema if not exists private;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  avatar_path text,
  prefs jsonb not null default '{}'::jsonb check (jsonb_typeof(prefs) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null default '' check (char_length(name) <= 60),
  code text not null unique,
  owner_id uuid references auth.users (id) on delete set null,
  timezone text not null default 'UTC',
  night_start time not null default '19:00',
  night_end time not null default '07:00',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.family_members (
  family_id uuid not null references public.families (id) on delete cascade,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (family_id, user_id)
);

create table public.join_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  attempted_at timestamptz not null default now(),
  succeeded boolean not null default false
);

create table public.children (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  birth_date date,
  due_date date,
  sex text check (sex in ('female', 'male')),
  avatar_path text,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.imports (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  file_name text check (char_length(file_name) <= 200),
  reader text not null default 'text' check (reader in ('columns', 'text', 'ai', 'assistant')),
  status text not null default 'saved' check (status in ('saved', 'undone')),
  counts jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  undone_at timestamptz
);

create table public.events (
  id uuid primary key,  -- generated on the phone so retries never duplicate
  family_id uuid not null references public.families (id) on delete cascade,
  child_id uuid references public.children (id) on delete cascade,
  type text not null check (type in (
    'sleep', 'nursing', 'bottle', 'pump', 'solids', 'diaper', 'potty', 'growth',
    'temperature', 'medicine', 'symptom', 'activity', 'milestone', 'note', 'contraction'
  )),
  started_at timestamptz not null,
  ended_at timestamptz,
  timer_state text check (timer_state in ('running', 'paused')),
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  photo_paths text[] not null default '{}',
  notes text check (char_length(notes) <= 4000),
  source text not null default 'app' check (source in ('app', 'import')),
  import_id uuid references public.imports (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint events_end_after_start check (ended_at is null or ended_at >= started_at),
  constraint events_child_required check (child_id is not null or type in ('pump', 'contraction')),
  constraint events_running_has_no_end check (timer_state is null or ended_at is null)
);

create table public.timer_segments (
  id uuid primary key,
  event_id uuid not null references public.events (id) on delete cascade,
  family_id uuid not null references public.families (id) on delete cascade,
  side text check (side in ('left', 'right')),
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  constraint segments_end_after_start check (ended_at is null or ended_at >= started_at)
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index events_family_started_idx on public.events (family_id, started_at desc);
create index events_child_started_idx on public.events (child_id, started_at desc);
create index events_family_updated_idx on public.events (family_id, updated_at);
create index events_import_idx on public.events (import_id) where import_id is not null;
create index events_created_by_idx on public.events (created_by);
create index events_updated_by_idx on public.events (updated_by);
-- At most one running timer per child per type, and per person for pumping/contractions.
create unique index events_one_timer_per_child on public.events (child_id, type)
  where timer_state is not null and deleted_at is null and child_id is not null;
create unique index events_one_timer_per_person on public.events (created_by, type)
  where timer_state is not null and deleted_at is null and child_id is null;

create index segments_event_idx on public.timer_segments (event_id);
create index segments_family_idx on public.timer_segments (family_id);
create unique index segments_one_open_per_event on public.timer_segments (event_id) where ended_at is null;

create index children_family_idx on public.children (family_id);
create index families_owner_idx on public.families (owner_id);
create index join_attempts_user_idx on public.join_attempts (user_id, attempted_at desc);
create index imports_family_idx on public.imports (family_id);
create index imports_created_by_idx on public.imports (created_by);

-- ---------------------------------------------------------------------------
-- Membership helpers (private schema is not exposed through the API)
-- ---------------------------------------------------------------------------
create or replace function private.my_family_id() returns uuid
language sql stable security definer set search_path = '' as $$
  select m.family_id from public.family_members m where m.user_id = (select auth.uid())
$$;

-- The owner, or the longest-standing member if the owner's account is gone.
create or replace function private.family_owner(p_family_id uuid) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select f.owner_id from public.families f
      where f.id = p_family_id
        and exists (select 1 from public.family_members m where m.family_id = f.id and m.user_id = f.owner_id)),
    (select m.user_id from public.family_members m where m.family_id = p_family_id order by m.joined_at limit 1)
  )
$$;

create or replace function private.new_family_code() returns text
language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- no 0/O or 1/I
  v_bytes bytea;
  v_chars text;
  v_code text;
begin
  loop
    v_bytes := extensions.gen_random_bytes(8);
    v_chars := '';
    for i in 0..7 loop
      v_chars := v_chars || substr(alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    end loop;
    v_code := 'LEELA-' || substr(v_chars, 1, 4) || '-' || substr(v_chars, 5, 4);
    exit when not exists (select 1 from public.families f where f.code = v_code);
  end loop;
  return v_code;
end $$;

revoke all on all functions in schema private from public;
grant execute on function private.my_family_id() to authenticated;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger families_updated_at before update on public.families
  for each row execute function private.set_updated_at();
create trigger children_updated_at before update on public.children
  for each row execute function private.set_updated_at();

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'name', ''), 40))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

create or replace function private.events_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce((select auth.uid()), new.created_by);
    new.created_at := now();
  else
    new.id := old.id;
    new.family_id := old.family_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source := old.source;
    new.import_id := old.import_id;
  end if;
  new.updated_by := coalesce((select auth.uid()), new.updated_by);
  new.updated_at := clock_timestamp();

  if new.child_id is not null and not exists (
    select 1 from public.children c where c.id = new.child_id and c.family_id = new.family_id
  ) then
    raise exception 'That baby is not in this family' using errcode = '23514';
  end if;

  if exists (
    select 1 from jsonb_each(new.data) e
    where e.key in ('amount_ml', 'left_ml', 'right_ml', 'total_ml', 'weight_kg', 'length_cm',
                    'head_cm', 'temp_c', 'left_s', 'right_s')
      and (jsonb_typeof(e.value) <> 'number' or (e.value #>> '{}')::numeric < 0)
  ) then
    raise exception 'Amounts must be zero or more' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger events_before_write before insert or update on public.events
  for each row execute function private.events_before_write();

create or replace function private.segments_before_write() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.event_id := old.event_id;
  end if;
  select e.family_id into new.family_id from public.events e where e.id = new.event_id;
  if new.family_id is null then
    raise exception 'Timer not found' using errcode = '23503';
  end if;
  return new;
end $$;

create trigger segments_before_write before insert or update on public.timer_segments
  for each row execute function private.segments_before_write();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.families enable row level security;
alter table public.family_members enable row level security;
alter table public.join_attempts enable row level security;
alter table public.children enable row level security;
alter table public.imports enable row level security;
alter table public.events enable row level security;
alter table public.timer_segments enable row level security;

-- No anonymous access to anything.
revoke all on public.profiles, public.families, public.family_members, public.join_attempts,
  public.children, public.imports, public.events, public.timer_segments from anon;

-- profiles: see yourself and your family; edit only yourself.
create policy profiles_select on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or id in (select m.user_id from public.family_members m where m.family_id = (select private.my_family_id()))
  );
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
revoke delete on public.profiles from authenticated;

-- families: members read; members may rename and change time settings; code and owner change only via functions.
create policy families_select on public.families for select to authenticated
  using (id = (select private.my_family_id()));
create policy families_update on public.families for update to authenticated
  using (id = (select private.my_family_id())) with check (id = (select private.my_family_id()));
revoke insert, update, delete on public.families from authenticated;
grant update (name, timezone, night_start, night_end) on public.families to authenticated;

-- family_members: members see each other; each person updates only their own last_seen_at.
create policy members_select on public.family_members for select to authenticated
  using (family_id = (select private.my_family_id()));
create policy members_update_self on public.family_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke insert, update, delete on public.family_members from authenticated;
grant update (last_seen_at) on public.family_members to authenticated;

-- join_attempts: only the join function touches it.
revoke all on public.join_attempts from authenticated;

-- children
create policy children_select on public.children for select to authenticated
  using (family_id = (select private.my_family_id()));
create policy children_insert on public.children for insert to authenticated
  with check (family_id = (select private.my_family_id()));
create policy children_update on public.children for update to authenticated
  using (family_id = (select private.my_family_id())) with check (family_id = (select private.my_family_id()));
revoke delete on public.children from authenticated;

-- imports
create policy imports_select on public.imports for select to authenticated
  using (family_id = (select private.my_family_id()));
create policy imports_insert on public.imports for insert to authenticated
  with check (family_id = (select private.my_family_id()) and created_by = (select auth.uid()));
create policy imports_update on public.imports for update to authenticated
  using (family_id = (select private.my_family_id())) with check (family_id = (select private.my_family_id()));
revoke delete on public.imports from authenticated;

-- events: everyone in the family can add and edit; deleting is a soft delete (deleted_at).
create policy events_select on public.events for select to authenticated
  using (family_id = (select private.my_family_id()));
create policy events_insert on public.events for insert to authenticated
  with check (family_id = (select private.my_family_id()));
create policy events_update on public.events for update to authenticated
  using (family_id = (select private.my_family_id())) with check (family_id = (select private.my_family_id()));
revoke delete on public.events from authenticated;

-- timer segments
create policy segments_select on public.timer_segments for select to authenticated
  using (family_id = (select private.my_family_id()));
create policy segments_insert on public.timer_segments for insert to authenticated
  with check (family_id = (select private.my_family_id()));
create policy segments_update on public.timer_segments for update to authenticated
  using (family_id = (select private.my_family_id())) with check (family_id = (select private.my_family_id()));
revoke delete on public.timer_segments from authenticated;

-- ---------------------------------------------------------------------------
-- Family functions (run with owner rights, but always check who is calling)
-- ---------------------------------------------------------------------------
create or replace function public.create_family(p_family_name text, p_display_name text, p_timezone text default 'UTC')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_tz text := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  v_family public.families;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if exists (select 1 from public.family_members m where m.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'already_in_family');
  end if;
  if not exists (select 1 from pg_catalog.pg_timezone_names t where t.name = v_tz) then
    v_tz := 'UTC';
  end if;

  insert into public.families (name, code, owner_id, timezone)
  values (left(coalesce(nullif(trim(p_family_name), ''), 'Our family'), 60), private.new_family_code(), v_uid, v_tz)
  returning * into v_family;

  insert into public.family_members (family_id, user_id) values (v_family.id, v_uid);

  insert into public.profiles (id, display_name)
  values (v_uid, left(trim(coalesce(p_display_name, '')), 40))
  on conflict (id) do update set display_name = excluded.display_name
  where excluded.display_name <> '';

  return jsonb_build_object('ok', true, 'family_id', v_family.id, 'code', v_family.code);
end $$;

create or replace function public.join_family(p_code text, p_display_name text default '', p_confirm boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_raw text;
  v_code text;
  v_family public.families;
  v_failed int;
  v_count int;
begin
  if v_uid is null then
    raise exception 'Sign in first' using errcode = '28000';
  end if;
  if exists (select 1 from public.family_members m where m.user_id = v_uid) then
    return jsonb_build_object('ok', false, 'error', 'already_in_family');
  end if;

  select count(*) into v_failed from public.join_attempts a
   where a.user_id = v_uid and not a.succeeded and a.attempted_at > now() - interval '1 hour';
  if v_failed >= 5 then
    return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
  end if;

  v_raw := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if left(v_raw, 5) = 'LEELA' then
    v_raw := substr(v_raw, 6);
  end if;
  if length(v_raw) = 8 then
    v_code := 'LEELA-' || substr(v_raw, 1, 4) || '-' || substr(v_raw, 5, 4);
    select * into v_family from public.families f where f.code = v_code for update;
  end if;

  if v_family.id is null then
    insert into public.join_attempts (user_id, succeeded) values (v_uid, false);
    return jsonb_build_object('ok', false, 'error', 'invalid_code', 'attempts_left', greatest(0, 4 - v_failed));
  end if;

  select count(*) into v_count from public.family_members m where m.family_id = v_family.id;
  if v_count >= 6 then
    return jsonb_build_object('ok', false, 'error', 'family_full');
  end if;

  if not p_confirm then
    return jsonb_build_object(
      'ok', true,
      'preview', jsonb_build_object(
        'family_name', v_family.name,
        'members', (
          select coalesce(jsonb_agg(coalesce(nullif(p.display_name, ''), 'A family member') order by m.joined_at), '[]'::jsonb)
          from public.family_members m left join public.profiles p on p.id = m.user_id
          where m.family_id = v_family.id
        ),
        'children', (
          select coalesce(jsonb_agg(c.name order by c.created_at), '[]'::jsonb)
          from public.children c where c.family_id = v_family.id and c.deleted_at is null
        )
      )
    );
  end if;

  insert into public.family_members (family_id, user_id) values (v_family.id, v_uid);
  insert into public.join_attempts (user_id, succeeded) values (v_uid, true);
  insert into public.profiles (id, display_name)
  values (v_uid, left(trim(coalesce(p_display_name, '')), 40))
  on conflict (id) do update set display_name = excluded.display_name
  where excluded.display_name <> '';

  return jsonb_build_object('ok', true, 'family_id', v_family.id);
end $$;

create or replace function public.reset_family_code()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_fid uuid := private.my_family_id();
  v_code text;
begin
  if v_fid is null or private.family_owner(v_fid) is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  v_code := private.new_family_code();
  update public.families set code = v_code where id = v_fid;
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

create or replace function public.remove_member(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_fid uuid := private.my_family_id();
begin
  if v_fid is null or private.family_owner(v_fid) is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if p_user_id = v_uid then
    return jsonb_build_object('ok', false, 'error', 'cannot_remove_self');
  end if;
  delete from public.family_members where family_id = v_fid and user_id = p_user_id;
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.transfer_ownership(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_fid uuid := private.my_family_id();
begin
  if v_fid is null or private.family_owner(v_fid) is distinct from v_uid then
    return jsonb_build_object('ok', false, 'error', 'not_owner');
  end if;
  if not exists (select 1 from public.family_members m where m.family_id = v_fid and m.user_id = p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'not_a_member');
  end if;
  update public.families set owner_id = p_user_id where id = v_fid;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.leave_family(p_confirm text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_fid uuid := private.my_family_id();
  v_count int;
begin
  if v_fid is null then
    return jsonb_build_object('ok', false, 'error', 'not_in_family');
  end if;
  select count(*) into v_count from public.family_members m where m.family_id = v_fid;
  if v_count = 1 then
    if p_confirm is distinct from 'DELETE' then
      return jsonb_build_object('ok', false, 'error', 'confirm_required');
    end if;
    delete from public.families where id = v_fid;
    return jsonb_build_object('ok', true, 'deleted_family', true);
  end if;
  if private.family_owner(v_fid) = v_uid then
    update public.families
       set owner_id = (select m.user_id from public.family_members m
                        where m.family_id = v_fid and m.user_id <> v_uid order by m.joined_at limit 1)
     where id = v_fid;
  end if;
  delete from public.family_members where family_id = v_fid and user_id = v_uid;
  return jsonb_build_object('ok', true, 'deleted_family', false);
end $$;

-- ---------------------------------------------------------------------------
-- Timer and import functions (run as the caller, so Row Level Security applies)
-- ---------------------------------------------------------------------------
-- Switch nursing side (p_side 'left'/'right') or pause (p_side null). Safe to replay.
create or replace function public.nursing_set(p_event_id uuid, p_side text, p_at timestamptz, p_segment_id uuid default null)
returns void language plpgsql set search_path = '' as $$
declare
  v_event public.events;
begin
  if p_side is not null and p_side not in ('left', 'right') then
    raise exception 'Side must be left or right' using errcode = '22023';
  end if;
  select * into v_event from public.events e
   where e.id = p_event_id and e.deleted_at is null for update;
  if not found or v_event.ended_at is not null then
    return;
  end if;
  if p_segment_id is not null and exists (select 1 from public.timer_segments s where s.id = p_segment_id) then
    return;
  end if;
  update public.timer_segments set ended_at = greatest(p_at, started_at)
   where event_id = p_event_id and ended_at is null;
  if p_side is null then
    update public.events set timer_state = 'paused' where id = p_event_id;
  else
    insert into public.timer_segments (id, event_id, family_id, side, started_at)
    values (coalesce(p_segment_id, gen_random_uuid()), p_event_id, v_event.family_id, p_side, p_at);
    update public.events
       set timer_state = 'running', data = data || jsonb_build_object('last_side', p_side)
     where id = p_event_id;
  end if;
end $$;

-- Stop any running timer. For nursing, stores left/right seconds. Safe to replay.
create or replace function public.timer_stop(p_event_id uuid, p_at timestamptz)
returns void language plpgsql set search_path = '' as $$
declare
  v_event public.events;
  v_left int;
  v_right int;
  v_end timestamptz;
begin
  select * into v_event from public.events e
   where e.id = p_event_id and e.deleted_at is null for update;
  if not found or v_event.ended_at is not null then
    return;
  end if;
  v_end := greatest(p_at, v_event.started_at);
  update public.timer_segments set ended_at = greatest(v_end, started_at)
   where event_id = p_event_id and ended_at is null;
  if v_event.type = 'nursing' then
    select coalesce(sum(extract(epoch from (s.ended_at - s.started_at))) filter (where s.side = 'left'), 0)::int,
           coalesce(sum(extract(epoch from (s.ended_at - s.started_at))) filter (where s.side = 'right'), 0)::int
      into v_left, v_right
      from public.timer_segments s where s.event_id = p_event_id;
    update public.events
       set ended_at = v_end, timer_state = null,
           data = data || jsonb_build_object('left_s', v_left, 'right_s', v_right)
     where id = p_event_id;
  else
    update public.events set ended_at = v_end, timer_state = null where id = p_event_id;
  end if;
end $$;

create or replace function public.undo_import(p_import_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_n int;
begin
  update public.events set deleted_at = now()
   where import_id = p_import_id and deleted_at is null;
  get diagnostics v_n = row_count;
  update public.imports set status = 'undone', undone_at = now() where id = p_import_id;
  return jsonb_build_object('ok', true, 'removed', v_n);
end $$;

revoke execute on function public.create_family(text, text, text), public.join_family(text, text, boolean),
  public.reset_family_code(), public.remove_member(uuid), public.transfer_ownership(uuid),
  public.leave_family(text), public.nursing_set(uuid, text, timestamptz, uuid),
  public.timer_stop(uuid, timestamptz), public.undo_import(uuid) from public, anon;
grant execute on function public.create_family(text, text, text), public.join_family(text, text, boolean),
  public.reset_family_code(), public.remove_member(uuid), public.transfer_ownership(uuid),
  public.leave_family(text), public.nursing_set(uuid, text, timestamptz, uuid),
  public.timer_stop(uuid, timestamptz), public.undo_import(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Photo and import file storage: one private folder per family
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('family', 'family', false, 15728640)
on conflict (id) do nothing;

create policy family_files_select on storage.objects for select to authenticated
  using (bucket_id = 'family' and (storage.foldername(name))[1] = (select private.my_family_id())::text);
create policy family_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'family' and (storage.foldername(name))[1] = (select private.my_family_id())::text);
create policy family_files_update on storage.objects for update to authenticated
  using (bucket_id = 'family' and (storage.foldername(name))[1] = (select private.my_family_id())::text)
  with check (bucket_id = 'family' and (storage.foldername(name))[1] = (select private.my_family_id())::text);
create policy family_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'family' and (storage.foldername(name))[1] = (select private.my_family_id())::text);

-- ---------------------------------------------------------------------------
-- Live sync
-- ---------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.events, public.timer_segments, public.children, public.families,
  public.family_members, public.profiles;

-- ---------------------------------------------------------------------------
-- Sign-up throttle (used only by the sign-up Edge Function with the service key)
-- ---------------------------------------------------------------------------
create table public.signup_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  attempted_at timestamptz not null default now()
);
create index signup_attempts_ip_idx on public.signup_attempts (ip, attempted_at desc);
alter table public.signup_attempts enable row level security;
revoke all on public.signup_attempts from anon, authenticated;
