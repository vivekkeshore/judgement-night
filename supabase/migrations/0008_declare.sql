-- Phase 6: Declare (Least Count) as a second game on the same tables.
--
-- Run in the Supabase SQL editor after 0007_cap_hand_size.sql.
--
-- Rooms, seats, presence, the turn clock and the events log are shared with
-- Judgement; only the cards differ. rooms.game says which game a table is
-- playing, and every entry point now checks it, so a Judgement RPC aimed at a
-- Declare room is refused rather than half-applied.
--
-- The rules enforced here are mirrored by shared/declare.js, which greys out
-- illegal throws in the browser. This copy is the authoritative one, exactly as
-- with Judgement in 0003; tests/declare.test.js is the reference for both.
--   * a card is worth its face value, and the ace is worth ONE
--   * a turn is: draw one card, then throw a single card, a set, or a run of 3+
--   * you always keep at least one card
--   * declare only at a count of ten or less
--   * anyone strictly lower than the declarer scores nothing; the declarer
--     scores nothing if nobody was lower, else twenty a head plus their own
--     cards; everybody else scores their own cards
--
-- It also fixes a bug in auto_move that predates Declare — see the comment
-- above it. That fix has to land first: without it, the new phases would send
-- every connected browser into a nudge loop.

-- ---------------------------------------------------------------- schema ----
alter table public.rooms add column if not exists game        text not null default 'judgement';
alter table public.rooms add column if not exists total_rounds int not null default 8;
alter table public.rooms add column if not exists stock_left   int not null default 0;

-- Declare has no trump, and reuses the rounds table purely for the schedule.
alter table public.rounds alter column trump drop not null;

-- The stock: face down, and nobody may read it. There is deliberately no
-- select policy below, so RLS returns nothing to everyone — a player who could
-- read this table could read the whole deal. Clients see rooms.stock_left only.
create table if not exists public.declare_stock (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round   int  not null,
  pos     int  not null,
  card    char(2) not null,
  primary key (room_id, round, pos)
);

-- Hands, one row per card. The primary key is (room, round, card) rather than
-- including the seat: one deck means a card is in exactly one place at a time,
-- and saying so here makes it impossible for a bug to deal the same card twice.
create table if not exists public.declare_hands (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round   int  not null,
  card    char(2) not null,
  seat    int  not null,
  primary key (room_id, round, card)
);
create index if not exists declare_hands_seat_idx on public.declare_hands(room_id, round, seat);

-- The discard pile, newest group last. Everything here is face up.
-- seat is null for the card turned up at the start of the round.
create table if not exists public.declare_discards (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round   int  not null,
  seq     int  not null,
  seat    int,
  cards   text[] not null,
  at      timestamptz not null default clock_timestamp(),
  primary key (room_id, round, seq)
);

-- How many cards each player is holding. Public, because that is public at a
-- real table — you can see the size of everyone's hand, just not its contents.
create table if not exists public.declare_seat_state (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round   int  not null,
  seat    int  not null,
  n_cards int  not null default 0,
  primary key (room_id, round, seat)
);

create table if not exists public.declare_results (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  round      int  not null,
  seat       int  not null,
  hand_count int  not null,
  points     int  not null,
  declared   boolean not null default false,
  primary key (room_id, round, seat)
);

-- ------------------------------------------------------------------ rls ----
alter table public.declare_stock      enable row level security;
alter table public.declare_hands      enable row level security;
alter table public.declare_discards   enable row level security;
alter table public.declare_seat_state enable row level security;
alter table public.declare_results    enable row level security;

drop policy if exists declare_own_hand    on public.declare_hands;
drop policy if exists declare_discards_read on public.declare_discards;
drop policy if exists declare_sizes_read  on public.declare_seat_state;
drop policy if exists declare_results_read on public.declare_results;

-- your cards, and nobody else's — the same shape as own_hand_only on `hands`
create policy declare_own_hand on public.declare_hands for select to authenticated using (
  exists (
    select 1 from public.seats s
    where s.room_id = declare_hands.room_id
      and s.seat    = declare_hands.seat
      and s.player_id = auth.uid()
  )
);

create policy declare_discards_read on public.declare_discards   for select to authenticated using (true);
create policy declare_sizes_read    on public.declare_seat_state for select to authenticated using (true);
create policy declare_results_read  on public.declare_results    for select to authenticated using (true);

-- declare_stock gets NO policy of any kind. That is the point.
-- No insert/update/delete policies anywhere: only the functions below write.

-- ------------------------------------------------------------- internals ----
/* Face value, ace low. Note this is NOT rank_value() from 0003, which is an
   ace-high ordinal for deciding which card beats which. Declare adds card
   values up and never compares them; Judgement compares and never adds. Using
   one where the other belongs would misprice every hand at the table. */
create or replace function public.declare_value(p_card char(2)) returns int
language sql immutable as $$ select strpos('A23456789TJQK', substr(p_card, 1, 1)); $$;

/* Is this a legal throw, ignoring whose hand it came from? One card always is.
   A set is two or more of one rank. A run is three or more of one suit with no
   gaps — and since the ace is worth one, the ace is low and only low, so A-2-3
   is a run and Q-K-A is not. Mirrors legalDiscard() in shared/declare.js. */
create or replace function public._declare_legal_group(p_cards text[]) returns boolean
language sql immutable as $$
  select case
    when coalesce(array_length(p_cards, 1), 0) = 0 then false
    when (select count(distinct c) from unnest(p_cards) c) <> array_length(p_cards, 1) then false
    when array_length(p_cards, 1) = 1 then true
    when (select count(distinct substr(c, 1, 1)) from unnest(p_cards) c) = 1 then true
    when array_length(p_cards, 1) >= 3
     and (select count(distinct substr(c, 2, 1)) from unnest(p_cards) c) = 1
     and (select count(distinct declare_value(c)) from unnest(p_cards) c) = array_length(p_cards, 1)
     and (select max(declare_value(c)) - min(declare_value(c)) from unnest(p_cards) c)
         = array_length(p_cards, 1) - 1
      then true
    else false
  end;
$$;

/* Publish what the clients are allowed to know about the shape of the round:
   how many cards everyone holds, and how much stock is left. Called after every
   move, so the two can never drift from the hands they describe. */
create or replace function public._declare_sync(p_room uuid, p_round int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into declare_seat_state (room_id, round, seat, n_cards)
  select p_room, p_round, s.seat, coalesce(h.n, 0)
  from seats s
  left join (select seat, count(*) as n from declare_hands
              where room_id = p_room and round = p_round group by seat) h on h.seat = s.seat
  where s.room_id = p_room
  on conflict (room_id, round, seat) do update set n_cards = excluded.n_cards;

  update rooms
     set stock_left = (select count(*) from declare_stock where room_id = p_room and round = p_round)
   where id = p_room;
end $$;

/* Five each, one card turned up to start the pile, the rest face down. Eight
   players is 41 cards, so one deck always covers it. */
create or replace function public._declare_deal(p_room uuid, p_round int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_n int; v_dealt int;
begin
  select count(*) into v_n from seats where room_id = p_room;
  v_dealt := v_n * 5;

  delete from declare_hands    where room_id = p_room and round = p_round;
  delete from declare_stock    where room_id = p_room and round = p_round;
  delete from declare_discards where room_id = p_room and round = p_round;

  /* `materialized` is not decoration: d is referenced three times and its
     ordering comes from random(), so inlining it would shuffle the deck three
     separate ways and deal the same card to two people. */
  with d as materialized (
    select card, row_number() over (order by random()) as rn from unnest(deck()) as card
  ),
  st as (
    select seat, row_number() over (order by seat) - 1 as idx from seats where room_id = p_room
  ),
  dealt as (
    insert into declare_hands (room_id, round, seat, card)
    select p_room, p_round, st.seat, d.card
      from d join st on d.rn between st.idx * 5 + 1 and (st.idx + 1) * 5
    returning card
  ),
  turned as (
    insert into declare_discards (room_id, round, seq, seat, cards)
    select p_room, p_round, 0, null, array[d.card] from d where d.rn = v_dealt + 1
    returning cards
  )
  insert into declare_stock (room_id, round, pos, card)
  select p_room, p_round, d.rn, d.card from d where d.rn > v_dealt + 1;
end $$;

/* Stock exhausted: shuffle everything but the top group back into it, so a long
   round cannot deadlock. The top group stays put because the next player is
   entitled to draw from it. */
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
     where room_id = p_room and round = p_round and seq < v_top
    returning cards
  )
  insert into declare_stock (room_id, round, pos, card)
  select p_room, p_round, row_number() over (order by random()), c
    from cleared, unnest(cleared.cards) as c;
end $$;

/* Draw one card, on behalf of a seat. p_from is 'stock' or 'discard'; drawing
   from the discard takes any single card out of the group the previous player
   threw, which is what makes throwing a run a real decision. */
create or replace function public._declare_draw(p_room uuid, p_seat int, p_from text, p_card char(2))
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_card char(2); v_top int; v_cards text[];
begin
  select * into v_room from rooms where id = p_room for update;
  if v_room.game <> 'declare' then raise exception 'that table is playing judgement'; end if;
  if v_room.phase <> 'draw' then raise exception 'it is not your draw right now'; end if;
  if p_seat <> v_room.turn_seat then raise exception 'not your turn'; end if;

  if p_from = 'discard' then
    select seq, cards into v_top, v_cards from declare_discards
      where room_id = p_room and round = v_room.round order by seq desc limit 1;
    if v_top is null or coalesce(array_length(v_cards, 1), 0) = 0 then
      raise exception 'there is nothing on the discard pile';
    end if;
    v_card := coalesce(p_card, v_cards[1]);
    -- the casts are deliberate: `cards` is text[] and v_card is char(2), and
    -- leaving Postgres to reconcile bpchar with text is a needless risk
    if not (v_card::text = any(v_cards)) then raise exception '% is not on top of the pile', v_card; end if;
    update declare_discards set cards = array_remove(cards, v_card::text)
      where room_id = p_room and round = v_room.round and seq = v_top;
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

  update rooms set phase = 'discard' where id = p_room;
  perform _declare_sync(p_room, v_room.round);
  perform _set_turn(p_room, p_seat);      -- same player, fresh clock for the throw
end $$;

/* Throw a card, a set or a run, on behalf of a seat. */
create or replace function public._declare_discard(p_room uuid, p_seat int, p_cards text[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_n int; v_held int; v_want int; v_have int; v_seq int;
begin
  select * into v_room from rooms where id = p_room for update;
  if v_room.game <> 'declare' then raise exception 'that table is playing judgement'; end if;
  if v_room.phase <> 'discard' then raise exception 'draw a card first'; end if;
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
  update rooms set phase = 'draw' where id = p_room;
  perform _declare_sync(p_room, v_room.round);
  perform _set_turn(p_room, (p_seat + 1) % v_n);
end $$;

/* Score a declared round, then record a lead change if the top seat moved.
   "Top" here means the LOWEST running total, because Declare's points are
   penalties — this is the server-side half of the direction-aware ranking in
   shared/rules.js, and it is what the apsara and the dethroned king read. */
create or replace function public.declare_score_round(p_room uuid, p_round int, p_declarer int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_before int; v_after int; v_mine int; v_lower int;
begin
  select seat into v_before from declare_results
    where room_id = p_room group by seat order by sum(points) asc, seat asc limit 1;

  select coalesce(sum(declare_value(card)), 0) into v_mine
    from declare_hands where room_id = p_room and round = p_round and seat = p_declarer;

  select count(*) into v_lower
    from (select s.seat, coalesce((select sum(declare_value(h.card)) from declare_hands h
             where h.room_id = p_room and h.round = p_round and h.seat = s.seat), 0) as cnt
            from seats s where s.room_id = p_room) x
   where x.seat <> p_declarer and x.cnt < v_mine;

  insert into declare_results (room_id, round, seat, hand_count, points, declared)
  select p_room, p_round, x.seat, x.cnt,
         case when x.seat = p_declarer then (case when v_lower = 0 then 0 else 20 * v_lower + v_mine end)
              when x.cnt < v_mine then 0
              else x.cnt end,
         x.seat = p_declarer
    from (select s.seat, coalesce((select sum(declare_value(h.card))::int from declare_hands h
             where h.room_id = p_room and h.round = p_round and h.seat = s.seat), 0) as cnt
            from seats s where s.room_id = p_room) x
  on conflict (room_id, round, seat) do update
    set hand_count = excluded.hand_count, points = excluded.points, declared = excluded.declared;

  insert into events (room_id, kind, payload)
    values (p_room, 'round_scored',
            jsonb_build_object('round', p_round, 'declarer', p_declarer,
                               'count', v_mine, 'lower', v_lower));

  select seat into v_after from declare_results
    where room_id = p_room group by seat order by sum(points) asc, seat asc limit 1;

  if v_after is distinct from v_before then
    insert into events (room_id, kind, payload)
      values (p_room, 'lead_change',
              jsonb_build_object('from', v_before, 'to', v_after, 'round', p_round));
  end if;
end $$;

/* Declare, on behalf of a seat: score the round and move the table on. */
create or replace function public._declare_declare(p_room uuid, p_seat int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_count int; v_n int; v_next int;
begin
  select * into v_room from rooms where id = p_room for update;
  if v_room.game <> 'declare' then raise exception 'that table is playing judgement'; end if;
  if v_room.phase <> 'draw' then raise exception 'you can only declare at the start of your turn'; end if;
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
    update rooms set round = v_next, phase = 'draw', lead_seat = null, trick_no = 0
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

  -- five each plus the turn-up; one deck covers eight players with room to spare
  delete from rounds where room_id = v_room.id;
  for r in 0 .. greatest(1, least(v_room.total_rounds, 20)) - 1 loop
    insert into rounds (room_id, round, cards, trump) values (v_room.id, r, 5, null);
  end loop;

  perform _declare_deal(v_room.id, 0);
  update rooms set status = 'playing', phase = 'draw', round = 0,
                   lead_seat = null, trick_no = 0, max_cards = 5
    where id = v_room.id;
  perform _declare_sync(v_room.id, 0);
  perform _set_turn(v_room.id, 0);
end $$;

create or replace function public.draw_card(p_code text, p_from text default 'stock', p_card char(2) default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_seat int;
begin
  select id into v_id from rooms where code = upper(trim(p_code));
  if v_id is null then raise exception 'no room with that code'; end if;
  select seat into v_seat from seats where room_id = v_id and player_id = auth.uid();
  if v_seat is null then raise exception 'you are not at this table'; end if;
  perform _declare_draw(v_id, v_seat, coalesce(p_from, 'stock'), p_card);
end $$;

create or replace function public.discard_cards(p_code text, p_cards text[])
returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_seat int;
begin
  select id into v_id from rooms where code = upper(trim(p_code));
  if v_id is null then raise exception 'no room with that code'; end if;
  select seat into v_seat from seats where room_id = v_id and player_id = auth.uid();
  if v_seat is null then raise exception 'you are not at this table'; end if;
  perform _declare_discard(v_id, v_seat, p_cards);
end $$;

create or replace function public.declare_hand(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_seat int;
begin
  select id into v_id from rooms where code = upper(trim(p_code));
  if v_id is null then raise exception 'no room with that code'; end if;
  select seat into v_seat from seats where room_id = v_id and player_id = auth.uid();
  if v_seat is null then raise exception 'you are not at this table'; end if;
  perform _declare_declare(v_id, v_seat);
end $$;

-- ---------------------------------------------------- room creation ----
-- create_room has to be dropped rather than replaced: Postgres identifies a
-- function by its argument types, so adding parameters needs the old signature
-- out of the way first, or the two become ambiguous. Same reasoning as 0006.
drop function if exists public.create_room(text, int);

create or replace function public.create_room(
  p_name    text,
  p_players int  default 4,
  p_game    text default 'judgement',
  p_rounds  int  default 8
) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text; v_id uuid; v_uid uuid := auth.uid(); v_n int; v_game text; v_rounds int;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name required'; end if;

  v_game := case when lower(coalesce(p_game, '')) = 'declare' then 'declare' else 'judgement' end;
  v_n := greatest(3, least(coalesce(p_players, 4), 8));
  v_rounds := greatest(3, least(coalesce(p_rounds, 8), 20));
  v_code := gen_room_code();

  insert into rooms (code, expected_players, max_cards, host_id, game, total_rounds)
    values (v_code, v_n,
            case when v_game = 'declare' then 5 else least(10, floor(52.0 / v_n)::int) end,
            v_uid, v_game, v_rounds)
    returning id into v_id;
  insert into seats (room_id, seat, player_id, name)
    values (v_id, 0, v_uid, trim(p_name));
  return v_code;
end $$;

/* Judgement's own dealer, unchanged except that it now refuses a Declare table
   rather than laying a trump schedule over one. */
create or replace function public.start_game(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_uid uuid := auth.uid(); v_n int; v_m int; r int; i int;
begin
  select * into v_room from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'no room with that code'; end if;
  if v_room.game <> 'judgement' then raise exception 'that table is playing declare'; end if;
  if v_room.host_id <> v_uid then raise exception 'only the host can deal'; end if;
  if v_room.status <> 'lobby' then raise exception 'this game has already started'; end if;

  select count(*) into v_n from seats where room_id = v_room.id;
  if v_n < 3 then raise exception 'need at least 3 players'; end if;
  if v_n > 8 then raise exception 'too many players'; end if;

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

-- ------------------------------------------------------------- auto-play ----
/* THE BUG THIS FIXES, which predates Declare:
   auto_move used to be `if bidding ... elsif playing ... end if` with no else.
   A room in any other phase fell straight through, returning without clearing
   the deadline — while nudge() still reported success. So every connected
   browser saw an expired clock a second later and nudged again, forever,
   writing an events row each time. Two new phases would have walked into it.

   Now it dispatches on rooms.game first, and every path that cannot move ends
   by clearing the deadline, which is what actually stops the loop. */
create or replace function public.auto_move(p_room uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_n int; v_cards int; v_last int; v_sum int; v_placed int;
        v_bid int; v_led char; v_card char(2); v_held int;
begin
  select * into v_room from rooms where id = p_room for update;
  if v_room.turn_seat is null then
    update rooms set deadline = null, version = version + 1 where id = p_room;
    return;
  end if;
  select count(*) into v_n from seats where room_id = p_room;

  if v_room.game = 'declare' then
    if v_room.phase = 'draw' then
      /* Look before drawing. If _declare_draw raised in here the whole nudge
         transaction would roll back with the deadline still in the past, and
         every client would nudge again a second later — which is the exact loop
         this rewrite exists to close. Never declares, either: declaring is a
         bet, and nobody should have one placed for them. */
      perform _declare_refill_stock(p_room, v_room.round);
      if exists (select 1 from declare_stock where room_id = p_room and round = v_room.round) then
        perform _declare_draw(p_room, v_room.turn_seat, 'stock', null);
      elsif exists (select 1 from declare_discards
                     where room_id = p_room and round = v_room.round
                       and coalesce(array_length(cards, 1), 0) > 0) then
        perform _declare_draw(p_room, v_room.turn_seat, 'discard', null);
      else
        update rooms set deadline = null, version = version + 1 where id = p_room;
        return;
      end if;

    elsif v_room.phase = 'discard' then
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

-- ---------------------------------------------------------------- restart ----
/* Clearing a table has to clear both games' tables, or a Declare room would
   deal a fresh round on top of the last one's cards. */
create or replace function public.restart_game(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_uid uuid := auth.uid();
begin
  select * into v_room from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'no room with that code'; end if;
  if v_room.host_id <> v_uid then raise exception 'only the host can start a new game'; end if;
  if v_room.status = 'lobby' then return; end if;

  delete from plays   where room_id = v_room.id;
  delete from tricks  where room_id = v_room.id;
  delete from results where room_id = v_room.id;
  delete from hands   where room_id = v_room.id;
  delete from bids    where room_id = v_room.id;

  delete from declare_stock      where room_id = v_room.id;
  delete from declare_hands      where room_id = v_room.id;
  delete from declare_discards   where room_id = v_room.id;
  delete from declare_seat_state where room_id = v_room.id;
  delete from declare_results    where room_id = v_room.id;

  delete from rounds  where room_id = v_room.id;
  delete from events  where room_id = v_room.id;

  update rooms set status = 'lobby', phase = 'lobby', round = 0,
                   turn_seat = null, lead_seat = null, trick_no = 0,
                   deadline = null, stock_left = 0, version = version + 1
    where id = v_room.id;
end $$;

-- ----------------------------------------------------------------- grants ----
revoke all on function public.create_room(text, int, text, int) from public;
revoke all on function public.declare_start(text)               from public;
revoke all on function public.draw_card(text, text, char)       from public;
revoke all on function public.discard_cards(text, text[])       from public;
revoke all on function public.declare_hand(text)                from public;

grant execute on function public.create_room(text, int, text, int) to authenticated;
grant execute on function public.declare_start(text)               to authenticated;
grant execute on function public.draw_card(text, text, char)       to authenticated;
grant execute on function public.discard_cards(text, text[])       to authenticated;
grant execute on function public.declare_hand(text)                to authenticated;
grant execute on function public.start_game(text)                  to authenticated;
grant execute on function public.restart_game(text)                to authenticated;

-- the internals stay ungranted: a client can only ever move on its own behalf
revoke all on function public._declare_draw(uuid, int, text, char)  from public;
revoke all on function public._declare_discard(uuid, int, text[])   from public;
revoke all on function public._declare_declare(uuid, int)           from public;
revoke all on function public._declare_deal(uuid, int)              from public;
revoke all on function public._declare_sync(uuid, int)              from public;
revoke all on function public._declare_refill_stock(uuid, int)      from public;
revoke all on function public.declare_score_round(uuid, int, int)   from public;
revoke all on function public.auto_move(uuid)                       from public;

-- -------------------------------------------------------------- realtime ----
-- The face-up tables broadcast. declare_hands and declare_stock are absent for
-- the same reason `hands` is: nobody else's cards should ever cross a channel.
do $$ begin alter publication supabase_realtime add table public.declare_discards;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.declare_seat_state;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.declare_results;
exception when duplicate_object then null; end $$;
