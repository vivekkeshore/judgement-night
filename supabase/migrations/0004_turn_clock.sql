-- Phase 4: turn clock, auto-play and presence.
--
-- Run in the Supabase SQL editor after 0003_trick_play.sql.
--
-- How the clock is enforced without pg_cron: rooms.deadline is set every time the
-- turn changes, and any connected client that sees it pass calls nudge(). The
-- server re-checks the deadline under a row lock before acting, so a client
-- cannot rush anyone, several clients nudging at once is harmless, and the
-- authority stays server-side. The cost is that nothing fires if every player has
-- closed their browser — in which case nobody is waiting anyway.
--
-- To do this, place_bid and play_card are refactored into thin auth wrappers over
-- _apply_bid/_apply_play, which act on behalf of a given seat. auto_move then
-- reuses exactly the same code paths as a human move rather than duplicating the
-- turn-advance, trick-resolution and scoring logic.

alter table public.rooms add column if not exists turn_seconds int not null default 45;

-- ------------------------------------------------------------- internals ----
/* Hand the turn to a seat and start their clock. */
create or replace function public._set_turn(p_room uuid, p_seat int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update rooms
     set turn_seat = p_seat,
         deadline  = now() + make_interval(secs => turn_seconds),
         version   = version + 1
   where id = p_room;
end $$;

/* One bid, on behalf of a seat. Validation identical to the human path. */
create or replace function public._apply_bid(p_room uuid, p_seat int, p_bid int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_n int; v_cards int; v_last int; v_sum int; v_placed int;
begin
  select * into v_room from rooms where id = p_room for update;
  if v_room.phase <> 'bidding' then raise exception 'not bidding right now'; end if;
  if p_seat <> v_room.turn_seat then raise exception 'not your turn'; end if;

  select count(*) into v_n from seats where room_id = p_room;
  select cards into v_cards from rounds where room_id = p_room and round = v_room.round;
  if p_bid is null or p_bid < 0 or p_bid > v_cards then
    raise exception 'bid between 0 and %', v_cards;
  end if;

  v_last := (v_room.round % v_n + v_n - 1) % v_n;
  if p_seat = v_last then
    select coalesce(sum(bid), 0), count(*) into v_sum, v_placed
      from bids where room_id = p_room and round = v_room.round;
    if v_placed = v_n - 1 and v_sum + p_bid = v_cards then
      raise exception 'not % — the bids may not add up to %', p_bid, v_cards;
    end if;
  end if;

  insert into bids (room_id, round, seat, bid) values (p_room, v_room.round, p_seat, p_bid)
    on conflict (room_id, round, seat) do update set bid = excluded.bid;

  select count(*) into v_placed from bids where room_id = p_room and round = v_room.round;
  if v_placed = v_n then
    update rooms set phase = 'playing', lead_seat = v_room.round % v_n, trick_no = 0
      where id = p_room;
    perform _set_turn(p_room, v_room.round % v_n);
  else
    perform _set_turn(p_room, (p_seat + 1) % v_n);
  end if;
end $$;

/* One card, on behalf of a seat. Validation identical to the human path. */
create or replace function public._apply_play(p_room uuid, p_seat int, p_card char(2))
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_n int; v_cards int; v_trump char; v_led char;
        v_played int; v_winner int; v_next int;
begin
  select * into v_room from rooms where id = p_room for update;
  if v_room.phase <> 'playing' then raise exception 'not playing right now'; end if;
  if p_seat <> v_room.turn_seat then raise exception 'not your turn'; end if;

  select count(*) into v_n from seats where room_id = p_room;
  select cards, trump into v_cards, v_trump from rounds where room_id = p_room and round = v_room.round;

  if not exists (select 1 from hands
                 where room_id = p_room and round = v_room.round
                   and seat = p_seat and card = p_card and not played) then
    raise exception 'you do not hold %', p_card;
  end if;

  select substr(card, 2, 1) into v_led from plays
    where room_id = p_room and round = v_room.round and trick_no = v_room.trick_no
    order by played_at limit 1;
  if v_led is not null and substr(p_card, 2, 1) <> v_led
     and exists (select 1 from hands
                 where room_id = p_room and round = v_room.round and seat = p_seat
                   and not played and substr(card, 2, 1) = v_led) then
    raise exception 'you must follow %', v_led;
  end if;

  insert into plays (room_id, round, trick_no, seat, card)
    values (p_room, v_room.round, v_room.trick_no, p_seat, p_card);
  update hands set played = true
    where room_id = p_room and round = v_room.round and seat = p_seat and card = p_card;

  select count(*) into v_played from plays
    where room_id = p_room and round = v_room.round and trick_no = v_room.trick_no;

  if v_played < v_n then
    perform _set_turn(p_room, (p_seat + 1) % v_n);
    return;
  end if;

  v_winner := trick_winner(p_room, v_room.round, v_room.trick_no, v_trump);
  insert into tricks (room_id, round, trick_no, lead_seat, winner_seat)
    values (p_room, v_room.round, v_room.trick_no, coalesce(v_room.lead_seat, p_seat), v_winner)
    on conflict (room_id, round, trick_no) do update set winner_seat = excluded.winner_seat;

  if v_room.trick_no + 1 < v_cards then
    update rooms set trick_no = v_room.trick_no + 1, lead_seat = v_winner where id = p_room;
    perform _set_turn(p_room, v_winner);
    return;
  end if;

  perform score_round(p_room, v_room.round);
  v_next := v_room.round + 1;

  if exists (select 1 from rounds where room_id = p_room and round = v_next) then
    perform deal_round(p_room, v_next);
    update rooms set round = v_next, phase = 'bidding', lead_seat = null, trick_no = 0
      where id = p_room;
    perform _set_turn(p_room, v_next % v_n);
  else
    update rooms set status = 'finished', phase = 'game_over',
                     turn_seat = null, lead_seat = null, deadline = null,
                     version = version + 1
      where id = p_room;
    insert into events (room_id, kind, payload) values (p_room, 'game_over', '{}'::jsonb);
  end if;
end $$;

-- --------------------------------------------------------- auth wrappers ----
create or replace function public.place_bid(p_code text, p_bid int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_seat int;
begin
  select id into v_id from rooms where code = upper(trim(p_code));
  if v_id is null then raise exception 'no room with that code'; end if;
  select seat into v_seat from seats where room_id = v_id and player_id = auth.uid();
  if v_seat is null then raise exception 'you are not at this table'; end if;
  perform _apply_bid(v_id, v_seat, p_bid);
end $$;

create or replace function public.play_card(p_code text, p_card char(2))
returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_seat int;
begin
  select id into v_id from rooms where code = upper(trim(p_code));
  if v_id is null then raise exception 'no room with that code'; end if;
  select seat into v_seat from seats where room_id = v_id and player_id = auth.uid();
  if v_seat is null then raise exception 'you are not at this table'; end if;
  perform _apply_play(v_id, v_seat, p_card);
end $$;

-- ------------------------------------------------------------- auto-play ----
/* The least committal legal move: bid nothing, or play the lowest card you are
   allowed to. Deliberately never clever — it should keep the table moving
   without playing the absent player's hand well for them. */
create or replace function public.auto_move(p_room uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_n int; v_cards int; v_last int; v_sum int; v_placed int;
        v_bid int; v_led char; v_card char(2);
begin
  select * into v_room from rooms where id = p_room for update;
  if v_room.turn_seat is null then return; end if;
  select count(*) into v_n from seats where room_id = p_room;

  if v_room.phase = 'bidding' then
    select cards into v_cards from rounds where room_id = p_room and round = v_room.round;
    v_bid := 0;
    v_last := (v_room.round % v_n + v_n - 1) % v_n;
    if v_room.turn_seat = v_last then
      select coalesce(sum(bid), 0), count(*) into v_sum, v_placed
        from bids where room_id = p_room and round = v_room.round;
      -- zero would make the bids add up exactly, so bid one instead
      if v_placed = v_n - 1 and v_sum = v_cards then v_bid := 1; end if;
    end if;
    perform _apply_bid(p_room, v_room.turn_seat, least(v_bid, v_cards));

  elsif v_room.phase = 'playing' then
    select substr(card, 2, 1) into v_led from plays
      where room_id = p_room and round = v_room.round and trick_no = v_room.trick_no
      order by played_at limit 1;

    select card into v_card from hands
     where room_id = p_room and round = v_room.round and seat = v_room.turn_seat and not played
       and (v_led is null or substr(card, 2, 1) = v_led)
     order by rank_value(card) limit 1;

    if v_card is null then      -- cannot follow: lowest of anything
      select card into v_card from hands
       where room_id = p_room and round = v_room.round and seat = v_room.turn_seat and not played
       order by rank_value(card) limit 1;
    end if;
    if v_card is null then return; end if;

    perform _apply_play(p_room, v_room.turn_seat, v_card);
  end if;

  insert into events (room_id, kind, payload)
    values (p_room, 'auto_move', jsonb_build_object('seat', v_room.turn_seat, 'round', v_room.round));
end $$;

/* Called by any client that notices the clock has run out. The deadline is
   re-checked here under the row lock, so this cannot be used to hurry anyone. */
create or replace function public.nudge(p_code text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_room rooms;
begin
  select * into v_room from rooms where code = upper(trim(p_code)) for update;
  if not found then return false; end if;
  if v_room.status <> 'playing' or v_room.deadline is null then return false; end if;
  if v_room.deadline > now() then return false; end if;   -- not actually expired
  perform auto_move(v_room.id);
  return true;
end $$;

-- -------------------------------------------------------------- presence ----
/* Clients call this every few seconds. It also ages out anyone who has gone
   quiet, so the table can show who is actually there. */
create or replace function public.heartbeat(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  select id into v_id from rooms where code = upper(trim(p_code));
  if v_id is null then return; end if;

  update seats set connected = true, last_seen = now()
    where room_id = v_id and player_id = auth.uid();

  update seats set connected = false
    where room_id = v_id and connected and last_seen < now() - interval '40 seconds';
end $$;

revoke all on function public._set_turn(uuid, int)          from public;
revoke all on function public._apply_bid(uuid, int, int)    from public;
revoke all on function public._apply_play(uuid, int, char)  from public;
revoke all on function public.auto_move(uuid)               from public;
grant execute on function public.nudge(text)     to authenticated;
grant execute on function public.heartbeat(text) to authenticated;
-- the internals stay ungranted: a client can only ever move on its own behalf.

-- start_game must also start the first clock
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

  v_m := least(v_room.max_cards, floor(52.0 / v_n)::int);
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
grant execute on function public.start_game(text) to authenticated;
