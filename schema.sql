-- ============================================================
-- ARK ADMIN — Supabase Schema
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run
-- ============================================================

-- PROFILES (extends auth.users with role)
create table if not exists profiles (
  id   uuid references auth.users on delete cascade primary key,
  role text not null default 'staff' check (role in ('owner', 'staff')),
  name text
);
alter table profiles enable row level security;
create policy "Authenticated read profiles"  on profiles for select using (auth.role() = 'authenticated');
create policy "Users update own profile"     on profiles for update using (auth.uid() = id);

-- UNITS (accommodations)
create table if not exists units (
  id           text primary key,
  name         text not null,
  color        text default '#888888',
  nightly_rate numeric default 0,
  weekend_rate numeric default 0,
  cleaning_fee numeric default 0,
  active       boolean default true,
  sort_order   int default 0
);
alter table units enable row level security;
create policy "Authenticated access units" on units for all using (auth.role() = 'authenticated');

insert into units (id, name, color, sort_order) values
  ('gharbi', 'Gharbi',    '#4A7A8A', 1),
  ('bahari', 'Bahari',    '#6A8A4A', 2),
  ('annex',  'The Annex', '#8A6A4A', 3),
  ('gibli',  'Gibli',     '#6A4A8A', 4),
  ('tent',   'Bell Tent', '#8A4A6A', 5)
on conflict (id) do nothing;

-- EXTRAS TEMPLATES
create table if not exists extras (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  default_price numeric default 0,
  created_at    timestamptz default now()
);
alter table extras enable row level security;
create policy "Authenticated access extras" on extras for all using (auth.role() = 'authenticated');

-- BOOKINGS
create table if not exists bookings (
  id               uuid primary key default gen_random_uuid(),
  guest_name       text,
  phone            text,
  accommodations   text[] not null default '{}',
  check_in         timestamptz,
  check_out        timestamptz,
  group_size       int default 1,
  extras           jsonb default '[]',
  base_amount      numeric default 0,
  discount_amount  numeric default 0,
  final_amount     numeric default 0,
  payment_status   text default 'unpaid',
  status           text default 'confirmed',
  source           text,
  tags             text[] default '{}',
  override_conflict boolean default false,
  notes            text,
  created_at       timestamptz default now()
);
alter table bookings enable row level security;
create policy "Authenticated read bookings"   on bookings for select using (auth.role() = 'authenticated');
create policy "Authenticated insert bookings" on bookings for insert with check (auth.role() = 'authenticated');
create policy "Authenticated update bookings" on bookings for update using (auth.role() = 'authenticated');
create policy "Owner delete bookings"         on bookings for delete using (
  exists (select 1 from profiles where id = auth.uid() and role = 'owner'));

-- CLEANING TASKS
create table if not exists cleaning_tasks (
  id               uuid primary key default gen_random_uuid(),
  date             date not null,
  unit_id          text references units(id),
  booking_id       uuid references bookings(id) on delete set null,
  guest_name       text,
  status           text default 'pending',
  notes            text,
  is_auto_generated boolean default false,
  created_at       timestamptz default now()
);
alter table cleaning_tasks enable row level security;
create policy "Authenticated access cleaning" on cleaning_tasks for all using (auth.role() = 'authenticated');

-- TASKS / COMPLAINTS
create table if not exists tasks (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  category   text,
  unit_id    text references units(id),
  date       date,
  notes      text,
  status     text default 'Open',
  priority   text default 'Medium',
  created_at timestamptz default now()
);
alter table tasks enable row level security;
create policy "Authenticated access tasks" on tasks for all using (auth.role() = 'authenticated');

-- EXPENSES
create table if not exists expenses (
  id            uuid primary key default gen_random_uuid(),
  date          date not null,
  amount        numeric not null,
  category      text,
  accommodation text,
  description   text,
  paid_by       text,
  notes         text,
  created_at    timestamptz default now()
);
alter table expenses enable row level security;
create policy "Authenticated read expenses"   on expenses for select using (auth.role() = 'authenticated');
create policy "Authenticated insert expenses" on expenses for insert with check (auth.role() = 'authenticated');
create policy "Authenticated update expenses" on expenses for update using (auth.role() = 'authenticated');
create policy "Owner delete expenses"         on expenses for delete using (
  exists (select 1 from profiles where id = auth.uid() and role = 'owner'));

-- AUTO-CREATE PROFILE ON SIGNUP
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'staff'),
    coalesce(new.raw_user_meta_data->>'name', new.email)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
