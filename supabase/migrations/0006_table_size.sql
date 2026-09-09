-- Phase 5c: the table size decides the hand size.
--
-- Run in the Supabase SQL editor after 0005_restart.sql.
--
-- The organiser used to pick "cards in the first round", which was a second
-- choice on top of one the deck had already made: with one deck, the most you
-- can deal everybody is floor(52 / players). So the room now records how many
-- players are expected, and the card count and round count follow from it.
--
-- create_room has to be dropped rather than replaced: Postgres identifies a
-- function by its argument types, and CREATE OR REPLACE cannot rename a
-- parameter, so p_max_cards -> p_players needs the old one out of the way first.

alter table public.rooms add column if not exists expected_players int not null default 4;

drop function if exists public.create_room(text, int);

create or replace function public.create_room(p_name text, p_players int default 4)
returns text
language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid; v_uid uuid := auth.uid(); v_n int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;

  v_n := greatest(3, least(coalesce(p_players, 4), 8));
  v_code := gen_room_code();
  insert into rooms (code, expected_players, max_cards, host_id)
    values (v_code, v_n, floor(52.0 / v_n)::int, v_uid)
    returning id into v_id;
  insert into seats (room_id, seat, player_id, name)
    values (v_id, 0, v_uid, trim(p_name));
  return v_code;
end $$;

/* Joining is capped at the size the organiser set, rather than at eight. */
create or replace function public.join_room(p_code text, p_name text)
returns int
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_seat int; v_uid uuid := auth.uid(); v_taken int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;

  select * into v_room from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'no room with that code'; end if;

  select seat into v_seat from seats where room_id = v_room.id and player_id = v_uid;
  if found then                                  -- already seated: this is a rejoin
    update seats set name = trim(p_name), connected = true, last_seen = now()
      where room_id = v_room.id and player_id = v_uid;
    update rooms set version = version + 1 where id = v_room.id;
    return v_seat;
  end if;

  if v_room.status <> 'lobby' then raise exception 'that game has already started'; end if;

  select count(*) into v_taken from seats where room_id = v_room.id;
  if v_taken >= v_room.expected_players then
    raise exception 'that table is full — % of % seats taken', v_taken, v_room.expected_players;
  end if;

  select coalesce(max(seat) + 1, 0) into v_seat from seats where room_id = v_room.id;
  insert into seats (room_id, seat, player_id, name)
    values (v_room.id, v_seat, v_uid, trim(p_name));
  update rooms set version = version + 1 where id = v_room.id;
  return v_seat;
end $$;

/* Deal as many as the deck allows for whoever actually turned up. Using the
   seated count rather than the expected one keeps the deal legal when somebody
   never arrives and the host starts short. */
create or replace function public.start_game(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_uid uuid := auth.uid(); v_n int; v_m int; r int; i int;
begin
  select * into v_room from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'no room with that code'; end if;
  if v_room.host_id <> v_uid then raise exception 'only the host can deal'; end if;
  if v_room.status <> 'lobby' then raise exception 'this game has already started'; end if;

  select count(*) into v_n from seats where room_id = v_room.id;
  if v_n < 3 then raise exception 'need at least 3 players'; end if;
  if v_n > 8 then raise exception 'too many players'; end if;

  v_m := floor(52.0 / v_n)::int;          -- the deck decides the hand size
  if v_m < 1 then raise exception 'not enough cards to deal'; end if;

  delete from rounds where room_id = v_room.id;
  i := 0;
  for r in reverse v_m..1 loop
    insert into rounds (room_id, round, cards, trump)
      values (v_room.id, i, r, substr('HSDC', (i % 4) + 1, 1));
    i := i + 1;
  end loop;
  for r in 1..v_m loop
    insert into rounds (room_id, round, cards, trump)
      values (v_room.id, i, r, substr('HSDC', (i % 4) + 1, 1));
    i := i + 1;
  end loop;

  perform deal_round(v_room.id, 0);
  update rooms set status = 'playing', phase = 'bidding', round = 0,
                   lead_seat = null, trick_no = 0, max_cards = v_m
    where id = v_room.id;
  perform _set_turn(v_room.id, 0);
end $$;

revoke all on function public.create_room(text, int) from public;
grant execute on function public.create_room(text, int) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.start_game(text)      to authenticated;
