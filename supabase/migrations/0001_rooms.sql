-- Phase 1: rooms and seats.
--
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query).
-- It is idempotent enough to re-run during development.
--
-- Design notes:
--  * Clients get NO direct write access. Every mutation goes through a
--    SECURITY DEFINER function below, which validates and then writes as the
--    function owner, bypassing RLS.
--  * join_room takes `for update` on the room row so two people joining at the
--    same instant cannot be handed the same seat number.
--  * Seat colour is deliberately NOT stored: it is derived from (name, seat) by
--    shared/rules.js on the client, so that rule lives in exactly one place.

-- ---------------------------------------------------------------- tables ----
create table if not exists public.rooms (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  status     text not null default 'lobby',   -- lobby | playing | finished
  phase      text not null default 'lobby',   -- lobby | bidding | playing | round_end | game_over
  round      int  not null default 0,
  turn_seat  int,
  lead_seat  int,
  trick_no   int  not null default 0,
  max_cards  int  not null default 5,
  host_id    uuid not null,
  version    bigint not null default 0,       -- bumped on every mutation; clients detect staleness
  deadline   timestamptz,                     -- turn clock, used from Phase 4
  created_at timestamptz not null default now()
);

create table if not exists public.seats (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  seat       int  not null,
  player_id  uuid not null,
  name       text not null,
  connected  boolean not null default true,
  last_seen  timestamptz not null default now(),
  primary key (room_id, seat),
  unique (room_id, player_id)                 -- one seat per person per room
);

create index if not exists seats_player_idx on public.seats(player_id);
create index if not exists rooms_code_idx    on public.rooms(code);

-- ------------------------------------------------------------------ rls ----
alter table public.rooms enable row level security;
alter table public.seats enable row level security;

-- Rooms and seat names are not secret; the room code is what gates entry.
-- Hands (Phase 2) are the table that actually needs hiding.
drop policy if exists rooms_read on public.rooms;
drop policy if exists seats_read on public.seats;
create policy rooms_read on public.rooms for select to authenticated using (true);
create policy seats_read on public.seats for select to authenticated using (true);
-- Deliberately no insert/update/delete policies: direct writes are impossible.

-- ------------------------------------------------------------ functions ----
-- Unambiguous alphabet: no O/0, no I/1.
create or replace function public.gen_room_code() returns text
language plpgsql as $$
declare alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; c text; i int;
begin
  loop
    c := '';
    for i in 1..4 loop
      c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.rooms where code = c);
  end loop;
  return c;
end $$;

create or replace function public.create_room(p_name text, p_max_cards int default 5)
returns text
language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;

  v_code := gen_room_code();
  insert into rooms (code, max_cards, host_id)
    values (v_code, greatest(1, least(coalesce(p_max_cards, 5), 17)), v_uid)
    returning id into v_id;
  insert into seats (room_id, seat, player_id, name)
    values (v_id, 0, v_uid, trim(p_name));
  return v_code;
end $$;

create or replace function public.join_room(p_code text, p_name text)
returns int
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_seat int; v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;

  -- lock the room so concurrent joins serialise and cannot collide on a seat
  select * into v_room from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'no room with that code'; end if;

  -- already seated here? this is a rejoin: refresh the name and mark present
  select seat into v_seat from seats where room_id = v_room.id and player_id = v_uid;
  if found then
    update seats set name = trim(p_name), connected = true, last_seen = now()
      where room_id = v_room.id and player_id = v_uid;
    update rooms set version = version + 1 where id = v_room.id;
    return v_seat;
  end if;

  if v_room.status <> 'lobby' then raise exception 'that game has already started'; end if;

  select coalesce(max(seat) + 1, 0) into v_seat from seats where room_id = v_room.id;
  if v_seat > 7 then raise exception 'that table is full'; end if;

  insert into seats (room_id, seat, player_id, name)
    values (v_room.id, v_seat, v_uid, trim(p_name));
  update rooms set version = version + 1 where id = v_room.id;
  return v_seat;
end $$;

create or replace function public.leave_room(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_uid uuid := auth.uid();
begin
  select * into v_room from rooms where code = upper(trim(p_code)) for update;
  if not found then return; end if;

  if v_room.status = 'lobby' then
    delete from seats where room_id = v_room.id and player_id = v_uid;
    -- last one out closes the room
    if not exists (select 1 from seats where room_id = v_room.id) then
      delete from rooms where id = v_room.id;
      return;
    end if;
    -- hand the room to whoever is left
    if v_room.host_id = v_uid then
      update rooms set host_id = (select player_id from seats where room_id = v_room.id order by seat limit 1)
        where id = v_room.id;
    end if;
  else
    -- mid-game: keep the seat, just mark them away so they can rejoin
    update seats set connected = false, last_seen = now()
      where room_id = v_room.id and player_id = v_uid;
  end if;
  update rooms set version = version + 1 where id = v_room.id;
end $$;

revoke all on function public.create_room(text, int) from public;
revoke all on function public.join_room(text, text)  from public;
revoke all on function public.leave_room(text)       from public;
grant execute on function public.create_room(text, int) to authenticated;
grant execute on function public.join_room(text, text)  to authenticated;
grant execute on function public.leave_room(text)       to authenticated;

-- ------------------------------------------------------------- realtime ----
alter table public.seats replica identity full;   -- so deletes carry the old row
do $$ begin
  alter publication supabase_realtime add table public.rooms;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.seats;
exception when duplicate_object then null; end $$;
