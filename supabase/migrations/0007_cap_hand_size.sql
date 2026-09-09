-- Phase 5d: cap the opening hand at ten cards.
--
-- Run in the Supabase SQL editor after 0006_table_size.sql.
--
-- Letting the deck alone decide makes small tables punishing: three players is
-- floor(52/3) = 17 cards each, and since the schedule runs down to one and back
-- up that is 34 rounds. Manual mode has always capped its default at ten for
-- this reason. Ten each still uses at most 80 cards' worth of deals across the
-- table, which one deck covers for every table size from three up.
--
-- Appended as its own migration rather than editing 0006, so a database that has
-- already had 0006 applied only needs this one.

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
    values (v_code, v_n, least(10, floor(52.0 / v_n)::int), v_uid)
    returning id into v_id;
  insert into seats (room_id, seat, player_id, name)
    values (v_id, 0, v_uid, trim(p_name));
  return v_code;
end $$;

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

  -- as many as the deck allows, but never more than ten
  v_m := least(10, floor(52.0 / v_n)::int);
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

grant execute on function public.create_room(text, int) to authenticated;
grant execute on function public.start_game(text)       to authenticated;
