-- Phase 6b: Declare throws first, then picks up.
--
-- Run in the Supabase SQL editor after 0008_declare.sql.
--
-- 0008 modelled a turn as draw-then-throw. The way this table actually plays it,
-- a turn is **throw, then pick up** — which is not just the two halves in the
-- other order, because it changes what you are allowed to pick up. You throw
-- your cards on top of the pile, so the group you may take from is the one
-- underneath yours: whatever the previous player threw. Picking from the top
-- would mean picking up your own throw.
--
--   round starts   seq 0 is the card turned up when the round was dealt
--   your turn      phase 'throw' — declare here, or throw a card / set / run
--                  phase 'pick'  — take the stock's top card, or any single
--                                  card from the group below your own throw
--   then           the next seat, back to 'throw'
--
-- Phases are renamed from draw/discard to throw/pick so the name says what
-- happens rather than needing this comment to disambiguate the order.
--
-- Everything else from 0008 stands: the tables, the RLS, the scoring, and the
-- auto_move dispatch fix. Only the five functions that touch turn order are
-- redefined here, plus the stock refill, which now has to preserve one more
-- group than it used to.

-- Any table already mid-hand under the old phase names starts its next turn at
-- the top. Someone who had drawn but not thrown keeps the extra card and simply
-- throws from a bigger hand, which is legal.
update public.rooms set phase = 'throw', version = version + 1
  where game = 'declare' and phase in ('draw', 'discard');

-- ------------------------------------------------------------- internals ----
/* Stock exhausted: shuffle the buried part of the pile back into it. Keeps the
   top TWO groups now, not one — the top is the current player's own throw and
   the one beneath it is what they are entitled to pick from, so recycling it
   mid-turn would take away the choice the rules give them. */
create or replace function public._declare_refill_stock(p_room uuid, p_round int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_top int;
begin
  if exists (select 1 from declare_stock where room_id = p_room and round = p_round) then return; end if;

  select max(seq) into v_top from declare_discards where room_id = p_room and round = p_round;
  if v_top is null then return; end if;

  with cleared as (
    delete from declare_discards
     where room_id = p_room and round = p_round and seq < v_top - 1
    returning cards
  )
  insert into declare_stock (room_id, round, pos, card)
  select p_room, p_round, row_number() over (order by random()), c
    from cleared, unnest(cleared.cards) as c;
end $$;

/* Throw a card, a set or a run — the FIRST half of a turn.
   Ends on the same seat in 'pick', unless there is nothing left to pick up, in
   which case the turn passes rather than stranding the player on a phase they
   cannot leave. */
create or replace function public._declare_discard(p_room uuid, p_seat int, p_cards text[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_n int; v_held int; v_want int; v_have int; v_seq int;
begin
  select * into v_room from rooms where id = p_room for update;
  if v_room.game <> 'declare' then raise exception 'that table is playing judgement'; end if;
  if v_room.phase <> 'throw' then raise exception 'you have already thrown — pick a card up'; end if;
  if p_seat <> v_room.turn_seat then raise exception 'not your turn'; end if;

  v_want := coalesce(array_length(p_cards, 1), 0);
  if v_want = 0 then raise exception 'pick at least one card'; end if;
  if (select count(distinct c) from unnest(p_cards) c) <> v_want then
    raise exception 'that card is only in your hand once';
  end if;

  select count(*) into v_held from declare_hands
    where room_id = p_room and round = v_room.round and seat = p_seat;
  select count(*) into v_have from declare_hands
    where room_id = p_room and round = v_room.round and seat = p_seat and card::text = any(p_cards);
  if v_have <> v_want then raise exception 'you do not hold all of those'; end if;
  if v_want >= v_held then raise exception 'you have to keep at least one card'; end if;
  if not _declare_legal_group(p_cards) then
    raise exception 'that is not a single card, a set, or a run of three or more in one suit';
  end if;

  delete from declare_hands
    where room_id = p_room and round = v_room.round and seat = p_seat and card::text = any(p_cards);

  select coalesce(max(seq), -1) + 1 into v_seq from declare_discards
    where room_id = p_room and round = v_room.round;
  insert into declare_discards (room_id, round, seq, seat, cards)
    values (p_room, v_room.round, v_seq, p_seat, p_cards);

  select count(*) into v_n from seats where room_id = p_room;

  -- top the stock up before deciding, or a pile that only needs recycling would
  -- look like a dead end and silently cost this player their pick
  if not exists (select 1 from declare_stock where room_id = p_room and round = v_room.round) then
    perform _declare_refill_stock(p_room, v_room.round);
  end if;

  if exists (select 1 from declare_stock where room_id = p_room and round = v_room.round)
     or exists (select 1 from declare_discards
                 where room_id = p_room and round = v_room.round and seq = v_seq - 1
                   and coalesce(array_length(cards, 1), 0) > 0) then
    update rooms set phase = 'pick' where id = p_room;
    perform _declare_sync(p_room, v_room.round);
    perform _set_turn(p_room, p_seat);              -- same player, second half of the turn
  else
    update rooms set phase = 'throw' where id = p_room;
    perform _declare_sync(p_room, v_room.round);
    perform _set_turn(p_room, (p_seat + 1) % v_n);  -- nothing to pick up; move on
  end if;
end $$;

/* Pick one card up — the SECOND half of a turn.
   From the stock, or from the group BELOW the top of the pile. The top is this
   player's own throw, so "below the top" is precisely what the player before
   them put down. */
create or replace function public._declare_draw(p_room uuid, p_seat int, p_from text, p_card char(2))
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_n int; v_card char(2); v_top int; v_take int; v_cards text[];
begin
  select * into v_room from rooms where id = p_room for update;
  if v_room.game <> 'declare' then raise exception 'that table is playing judgement'; end if;
  if v_room.phase <> 'pick' then raise exception 'throw first, then pick a card up'; end if;
  if p_seat <> v_room.turn_seat then raise exception 'not your turn'; end if;

  if p_from = 'discard' then
    select max(seq) into v_top from declare_discards
      where room_id = p_room and round = v_room.round;
    v_take := v_top - 1;                       -- never your own throw
    select cards into v_cards from declare_discards
      where room_id = p_room and round = v_room.round and seq = v_take;
    if v_cards is null or coalesce(array_length(v_cards, 1), 0) = 0 then
      raise exception 'there is nothing on the pile to pick up';
    end if;
    v_card := coalesce(p_card, v_cards[1]);
    -- the casts are deliberate: `cards` is text[] and v_card is char(2), and
    -- leaving Postgres to reconcile bpchar with text is a needless risk
    if not (v_card::text = any(v_cards)) then raise exception '% is not on the pile', v_card; end if;
    update declare_discards set cards = array_remove(cards, v_card::text)
      where room_id = p_room and round = v_room.round and seq = v_take;
  else
    perform _declare_refill_stock(p_room, v_room.round);
    select card into v_card from declare_stock
      where room_id = p_room and round = v_room.round order by pos limit 1;
    if v_card is null then raise exception 'there is nothing left to draw'; end if;
    delete from declare_stock
      where room_id = p_room and round = v_room.round and card = v_card;
  end if;

  insert into declare_hands (room_id, round, card, seat)
    values (p_room, v_room.round, v_card, p_seat);

  select count(*) into v_n from seats where room_id = p_room;
  update rooms set phase = 'throw' where id = p_room;
  perform _declare_sync(p_room, v_room.round);
  perform _set_turn(p_room, (p_seat + 1) % v_n);
end $$;

/* Declare, on behalf of a seat. Still the very start of a turn — before you
   throw, which is now the first thing that happens rather than the second. */
create or replace function public._declare_declare(p_room uuid, p_seat int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_count int; v_n int; v_next int;
begin
  select * into v_room from rooms where id = p_room for update;
  if v_room.game <> 'declare' then raise exception 'that table is playing judgement'; end if;
  if v_room.phase <> 'throw' then raise exception 'you can only declare at the start of your turn'; end if;
  if p_seat <> v_room.turn_seat then raise exception 'not your turn'; end if;

  select coalesce(sum(declare_value(card)), 0) into v_count
    from declare_hands where room_id = p_room and round = v_room.round and seat = p_seat;
  if v_count > 10 then
    raise exception 'your hand comes to % — declare at 10 or less', v_count;
  end if;

  perform declare_score_round(p_room, v_room.round, p_seat);

  select count(*) into v_n from seats where room_id = p_room;
  v_next := v_room.round + 1;

  if exists (select 1 from rounds where room_id = p_room and round = v_next) then
    perform _declare_deal(p_room, v_next);
    update rooms set round = v_next, phase = 'throw', lead_seat = null, trick_no = 0
      where id = p_room;
    perform _declare_sync(p_room, v_next);
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
/* Identical to 0008 apart from the opening phase. */
create or replace function public.declare_start(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_uid uuid := auth.uid(); v_n int; r int;
begin
  select * into v_room from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'no room with that code'; end if;
  if v_room.game <> 'declare' then raise exception 'that table is playing judgement'; end if;
  if v_room.host_id <> v_uid then raise exception 'only the host can deal'; end if;
  if v_room.status <> 'lobby' then raise exception 'this game has already started'; end if;

  select count(*) into v_n from seats where room_id = v_room.id;
  if v_n < 3 then raise exception 'need at least 3 players'; end if;
  if v_n > 8 then raise exception 'too many players'; end if;

  delete from rounds where room_id = v_room.id;
  for r in 0 .. greatest(1, least(v_room.total_rounds, 20)) - 1 loop
    insert into rounds (room_id, round, cards, trump) values (v_room.id, r, 5, null);
  end loop;

  perform _declare_deal(v_room.id, 0);
  update rooms set status = 'playing', phase = 'throw', round = 0,
                   lead_seat = null, trick_no = 0, max_cards = 5
    where id = v_room.id;
  perform _declare_sync(v_room.id, 0);
  perform _set_turn(v_room.id, 0);
end $$;

-- ------------------------------------------------------------- auto-play ----
/* Same dispatch and the same rule as 0008 — every path that cannot move must
   clear the deadline, or nudge() reports success on an expired clock and every
   browser re-nudges once a second forever. Only the two Declare branches move:
   'throw' comes first now, and 'pick' second. */
create or replace function public.auto_move(p_room uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_n int; v_cards int; v_last int; v_sum int; v_placed int;
        v_bid int; v_led char; v_card char(2); v_held int; v_top int;
begin
  select * into v_room from rooms where id = p_room for update;
  if v_room.turn_seat is null then
    update rooms set deadline = null, version = version + 1 where id = p_room;
    return;
  end if;
  select count(*) into v_n from seats where room_id = p_room;

  if v_room.game = 'declare' then
    if v_room.phase = 'throw' then
      -- the most expensive single card: keeps the table moving without playing
      -- an absent player's hand well for them. Never declares: declaring is a
      -- bet, and nobody should have one placed for them.
      select count(*) into v_held from declare_hands
        where room_id = p_room and round = v_room.round and seat = v_room.turn_seat;
      if v_held <= 1 then                    -- cannot throw the last card
        update rooms set deadline = null, version = version + 1 where id = p_room;
        return;
      end if;
      select card into v_card from declare_hands
        where room_id = p_room and round = v_room.round and seat = v_room.turn_seat
        order by declare_value(card) desc, card limit 1;
      perform _declare_discard(p_room, v_room.turn_seat, array[v_card]::text[]);

    elsif v_room.phase = 'pick' then
      /* Look before picking. If _declare_draw raised in here the whole nudge
         transaction would roll back with the deadline still in the past, and
         every client would nudge again a second later. */
      perform _declare_refill_stock(p_room, v_room.round);
      select max(seq) into v_top from declare_discards
        where room_id = p_room and round = v_room.round;
      if exists (select 1 from declare_stock where room_id = p_room and round = v_room.round) then
        perform _declare_draw(p_room, v_room.turn_seat, 'stock', null);
      elsif exists (select 1 from declare_discards
                     where room_id = p_room and round = v_room.round and seq = v_top - 1
                       and coalesce(array_length(cards, 1), 0) > 0) then
        perform _declare_draw(p_room, v_room.turn_seat, 'discard', null);
      else
        update rooms set deadline = null, version = version + 1 where id = p_room;
        return;
      end if;

    else
      update rooms set deadline = null, version = version + 1 where id = p_room;
      return;
    end if;

  elsif v_room.phase = 'bidding' then
    select cards into v_cards from rounds where room_id = p_room and round = v_room.round;
    v_bid := 0;
    v_last := (v_room.round % v_n + v_n - 1) % v_n;
    if v_room.turn_seat = v_last then
      select coalesce(sum(bid), 0), count(*) into v_sum, v_placed
        from bids where room_id = p_room and round = v_room.round;
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

    if v_card is null then
      select card into v_card from hands
       where room_id = p_room and round = v_room.round and seat = v_room.turn_seat and not played
       order by rank_value(card) limit 1;
    end if;
    if v_card is null then
      update rooms set deadline = null, version = version + 1 where id = p_room;
      return;
    end if;

    perform _apply_play(p_room, v_room.turn_seat, v_card);

  else
    update rooms set deadline = null, version = version + 1 where id = p_room;
    return;
  end if;

  insert into events (room_id, kind, payload)
    values (p_room, 'auto_move', jsonb_build_object('seat', v_room.turn_seat, 'round', v_room.round));
end $$;

-- ----------------------------------------------------------------- grants ----
revoke all on function public._declare_draw(uuid, int, text, char)  from public;
revoke all on function public._declare_discard(uuid, int, text[])   from public;
revoke all on function public._declare_declare(uuid, int)           from public;
revoke all on function public._declare_refill_stock(uuid, int)      from public;
revoke all on function public.auto_move(uuid)                       from public;
grant execute on function public.declare_start(text) to authenticated;
