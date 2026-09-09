-- Phase 2: dealing and bidding.
--
-- Run in the Supabase SQL editor after 0001_rooms.sql.
--
-- The security property that matters is on `hands`: every player's cards live in
-- one table, and the RLS policy below means Postgres itself refuses to hand you
-- anyone else's. Hands are also deliberately NOT added to the realtime
-- publication — clients learn only that rooms.version changed and then re-select
-- their own hand, so another player's cards never travel over a channel at all.

-- ---------------------------------------------------------------- tables ----
create table if not exists public.rounds (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round   int  not null,
  cards   int  not null,
  trump   char(1) not null,                 -- S H D C
  primary key (room_id, round)
);

create table if not exists public.hands (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round   int  not null,
  seat    int  not null,
  card    char(2) not null,                 -- rank then suit, e.g. AS TH 2C
  played  boolean not null default false,
  primary key (room_id, round, seat, card)
);

create table if not exists public.bids (
  room_id uuid not null references public.rooms(id) on delete cascade,
  round   int  not null,
  seat    int  not null,
  bid     int  not null,
  primary key (room_id, round, seat)
);

create index if not exists hands_lookup_idx on public.hands(room_id, round, seat);

-- ------------------------------------------------------------------ rls ----
alter table public.rounds enable row level security;
alter table public.hands  enable row level security;
alter table public.bids   enable row level security;

drop policy if exists rounds_read on public.rounds;
drop policy if exists bids_read   on public.bids;
drop policy if exists own_hand_only on public.hands;

-- the round schedule and everyone's bids are public knowledge at the table
create policy rounds_read on public.rounds for select to authenticated using (true);
create policy bids_read   on public.bids   for select to authenticated using (true);

-- your cards, and nobody else's
create policy own_hand_only on public.hands for select to authenticated using (
  exists (
    select 1 from public.seats s
    where s.room_id = hands.room_id
      and s.seat    = hands.seat
      and s.player_id = auth.uid()
  )
);
-- No insert/update/delete policies anywhere: only the functions below write.

-- ------------------------------------------------------------- functions ----
create or replace function public.deck() returns text[]
language sql immutable as $$
  select array(
    select r || s
    from unnest(array['2','3','4','5','6','7','8','9','T','J','Q','K','A']) r,
         unnest(array['S','H','D','C']) s
  );
$$;

/* Shuffle and deal one round. Called with the room row already locked. */
create or replace function public.deal_round(p_room uuid, p_round int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_cards int; v_n int;
begin
  select cards into v_cards from rounds where room_id = p_room and round = p_round;
  select count(*) into v_n from seats where room_id = p_room;

  delete from hands where room_id = p_room and round = p_round;

  insert into hands (room_id, round, seat, card)
  select p_room, p_round, s.seat, d.card
  from (select card, row_number() over (order by random()) as rn
          from unnest(deck()) as card) d
  join (select seat, row_number() over (order by seat) - 1 as idx
          from seats where room_id = p_room) s
    on d.rn between s.idx * v_cards + 1 and (s.idx + 1) * v_cards;
end $$;

/* Host starts the game: fix the round schedule, deal round 0, open bidding. */
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

  -- one deck limits the opening hand
  v_m := least(v_room.max_cards, floor(52.0 / v_n)::int);
  if v_m < 1 then raise exception 'not enough cards to deal'; end if;

  delete from rounds where room_id = v_room.id;
  i := 0;
  for r in reverse v_m..1 loop            -- max down to one
    insert into rounds (room_id, round, cards, trump)
      values (v_room.id, i, r, substr('HSDC', (i % 4) + 1, 1));
    i := i + 1;
  end loop;
  for r in 1..v_m loop                    -- and back up
    insert into rounds (room_id, round, cards, trump)
      values (v_room.id, i, r, substr('HSDC', (i % 4) + 1, 1));
    i := i + 1;
  end loop;

  perform deal_round(v_room.id, 0);

  update rooms set status = 'playing', phase = 'bidding', round = 0,
                   turn_seat = 0,          -- first bidder of round 0 is seat 0
                   lead_seat = null, trick_no = 0, max_cards = v_m,
                   version = version + 1
    where id = v_room.id;
end $$;

/* One bid, from the player whose turn it is. */
create or replace function public.place_bid(p_code text, p_bid int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_uid uuid := auth.uid(); v_seat int; v_n int;
        v_cards int; v_last int; v_sum int; v_placed int;
begin
  select * into v_room from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'no room with that code'; end if;
  if v_room.phase <> 'bidding' then raise exception 'not bidding right now'; end if;

  select seat into v_seat from seats where room_id = v_room.id and player_id = v_uid;
  if not found then raise exception 'you are not at this table'; end if;
  if v_seat <> v_room.turn_seat then raise exception 'not your turn'; end if;

  select count(*) into v_n from seats where room_id = v_room.id;
  select cards into v_cards from rounds where room_id = v_room.id and round = v_room.round;

  if p_bid is null or p_bid < 0 or p_bid > v_cards then
    raise exception 'bid between 0 and %', v_cards;
  end if;

  -- the last bidder may not make the bids add up to the tricks available
  v_last := (v_room.round % v_n + v_n - 1) % v_n;
  if v_seat = v_last then
    select coalesce(sum(bid), 0), count(*) into v_sum, v_placed
      from bids where room_id = v_room.id and round = v_room.round;
    if v_placed = v_n - 1 and v_sum + p_bid = v_cards then
      raise exception 'not % — the bids may not add up to %', p_bid, v_cards;
    end if;
  end if;

  insert into bids (room_id, round, seat, bid) values (v_room.id, v_room.round, v_seat, p_bid)
    on conflict (room_id, round, seat) do update set bid = excluded.bid;

  select count(*) into v_placed from bids where room_id = v_room.id and round = v_room.round;
  if v_placed = v_n then
    -- everyone has bid: the first bidder leads the first trick
    update rooms set phase = 'playing',
                     lead_seat = v_room.round % v_n,
                     turn_seat = v_room.round % v_n,
                     trick_no = 0, version = version + 1
      where id = v_room.id;
  else
    update rooms set turn_seat = (v_seat + 1) % v_n, version = version + 1
      where id = v_room.id;
  end if;
end $$;

revoke all on function public.start_game(text)     from public;
revoke all on function public.place_bid(text, int) from public;
revoke all on function public.deal_round(uuid, int) from public;
grant execute on function public.start_game(text)     to authenticated;
grant execute on function public.place_bid(text, int) to authenticated;
-- deal_round is internal: no grant, so clients can never trigger a re-deal.

-- ------------------------------------------------------------- realtime ----
-- rounds and bids are public and broadcast. `hands` is deliberately absent:
-- clients re-select their own hand when rooms.version changes.
do $$ begin
  alter publication supabase_realtime add table public.rounds;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.bids;
exception when duplicate_object then null; end $$;
