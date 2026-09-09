-- Phase 3: trick play, scoring and round advance.
--
-- Run in the Supabase SQL editor after 0002_deal_and_bid.sql.
--
-- The three rules below mirror shared/rules.js exactly. This copy is the
-- authoritative one — it is what actually enforces play — while the JS copy only
-- greys out illegal cards in the browser. tests/tricks.test.js is the reference
-- for both; if they ever disagree, that file decides which is wrong.
--   * you must follow the led suit if you hold it
--   * highest trump wins, else highest card of the led suit; other suits cannot win
--   * exactly your bid scores 10 + bid, anything else costs 10 + bid

-- ---------------------------------------------------------------- tables ----
create table if not exists public.plays (
  room_id   uuid not null references public.rooms(id) on delete cascade,
  round     int  not null,
  trick_no  int  not null,
  seat      int  not null,
  card      char(2) not null,
  played_at timestamptz not null default clock_timestamp(),
  primary key (room_id, round, trick_no, seat)
);

create table if not exists public.tricks (
  room_id     uuid not null references public.rooms(id) on delete cascade,
  round       int  not null,
  trick_no    int  not null,
  lead_seat   int  not null,
  winner_seat int  not null,
  primary key (room_id, round, trick_no)
);

create table if not exists public.results (
  room_id    uuid not null references public.rooms(id) on delete cascade,
  round      int  not null,
  seat       int  not null,
  tricks_won int  not null,
  points     int  not null,
  primary key (room_id, round, seat)
);

-- history the clients cannot recompute from the standings alone: who lost the
-- lead and when. Phase 5 drives the apsara and the dethroned king off this, so
-- that every screen agrees rather than each browser remembering its own version.
create table if not exists public.events (
  id      bigserial primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  at      timestamptz not null default now(),
  kind    text not null,
  payload jsonb not null default '{}'::jsonb
);
create index if not exists events_room_idx on public.events(room_id, id);

-- ------------------------------------------------------------------ rls ----
alter table public.plays   enable row level security;
alter table public.tricks  enable row level security;
alter table public.results enable row level security;
alter table public.events  enable row level security;

drop policy if exists plays_read   on public.plays;
drop policy if exists tricks_read  on public.tricks;
drop policy if exists results_read on public.results;
drop policy if exists events_read  on public.events;

-- a played card is face up on the table, so all of this is public
create policy plays_read   on public.plays   for select to authenticated using (true);
create policy tricks_read  on public.tricks  for select to authenticated using (true);
create policy results_read on public.results for select to authenticated using (true);
create policy events_read  on public.events  for select to authenticated using (true);

-- ------------------------------------------------------------- functions ----
create or replace function public.rank_value(p_card char(2)) returns int
language sql immutable as $$ select strpos('23456789TJQKA', substr(p_card, 1, 1)); $$;

/* Highest trump, else highest card of the led suit. A card of any other suit was
   a discard and cannot win. Mirrors trickWinner() in shared/rules.js. */
create or replace function public.trick_winner(p_room uuid, p_round int, p_trick int, p_trump char)
returns int
language sql stable as $$
  with p as (
    select seat, substr(card, 2, 1) as suit, rank_value(card) as val, played_at
    from plays where room_id = p_room and round = p_round and trick_no = p_trick
  ),
  led as (select suit from p order by played_at limit 1),
  pool as (
    select * from p where suit = p_trump
    union all
    select * from p
     where suit = (select suit from led)
       and not exists (select 1 from p where suit = p_trump)
  )
  select seat from pool order by val desc limit 1;
$$;

/* Score one finished round, then record a lead change if the top seat moved. */
create or replace function public.score_round(p_room uuid, p_round int)
returns void
language plpgsql security definer set search_path = public as $$
declare v_before int; v_after int;
begin
  select seat into v_before from results
    where room_id = p_room group by seat order by sum(points) desc, seat asc limit 1;

  insert into results (room_id, round, seat, tricks_won, points)
  select p_room, p_round, s.seat, coalesce(t.won, 0),
         (10 + b.bid) * (case when coalesce(t.won, 0) = b.bid then 1 else -1 end)
  from seats s
  join bids b on b.room_id = p_room and b.round = p_round and b.seat = s.seat
  left join (
    select winner_seat as seat, count(*) as won
    from tricks where room_id = p_room and round = p_round group by winner_seat
  ) t on t.seat = s.seat
  where s.room_id = p_room
  on conflict (room_id, round, seat)
    do update set tricks_won = excluded.tricks_won, points = excluded.points;

  insert into events (room_id, kind, payload)
    values (p_room, 'round_scored', jsonb_build_object('round', p_round));

  select seat into v_after from results
    where room_id = p_room group by seat order by sum(points) desc, seat asc limit 1;

  if v_after is distinct from v_before then
    insert into events (room_id, kind, payload)
      values (p_room, 'lead_change',
              jsonb_build_object('from', v_before, 'to', v_after, 'round', p_round));
  end if;
end $$;

/* One card, from the player whose turn it is. */
create or replace function public.play_card(p_code text, p_card char(2))
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_uid uuid := auth.uid(); v_seat int; v_n int;
        v_cards int; v_trump char; v_led char; v_played int; v_winner int; v_next int;
begin
  select * into v_room from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'no room with that code'; end if;
  if v_room.phase <> 'playing' then raise exception 'not playing right now'; end if;

  select seat into v_seat from seats where room_id = v_room.id and player_id = v_uid;
  if not found then raise exception 'you are not at this table'; end if;
  if v_seat <> v_room.turn_seat then raise exception 'not your turn'; end if;

  select count(*) into v_n from seats where room_id = v_room.id;
  select cards, trump into v_cards, v_trump
    from rounds where room_id = v_room.id and round = v_room.round;

  -- the card must be one you hold and have not already played
  if not exists (select 1 from hands
                 where room_id = v_room.id and round = v_room.round
                   and seat = v_seat and card = p_card and not played) then
    raise exception 'you do not hold %', p_card;
  end if;

  -- follow the led suit if you can
  select substr(card, 2, 1) into v_led from plays
    where room_id = v_room.id and round = v_room.round and trick_no = v_room.trick_no
    order by played_at limit 1;
  if v_led is not null and substr(p_card, 2, 1) <> v_led
     and exists (select 1 from hands
                 where room_id = v_room.id and round = v_room.round and seat = v_seat
                   and not played and substr(card, 2, 1) = v_led) then
    raise exception 'you must follow %', v_led;
  end if;

  insert into plays (room_id, round, trick_no, seat, card)
    values (v_room.id, v_room.round, v_room.trick_no, v_seat, p_card);
  update hands set played = true
    where room_id = v_room.id and round = v_room.round and seat = v_seat and card = p_card;

  select count(*) into v_played from plays
    where room_id = v_room.id and round = v_room.round and trick_no = v_room.trick_no;

  if v_played < v_n then
    update rooms set turn_seat = (v_seat + 1) % v_n, version = version + 1 where id = v_room.id;
    return;
  end if;

  -- trick complete
  v_winner := trick_winner(v_room.id, v_room.round, v_room.trick_no, v_trump);
  insert into tricks (room_id, round, trick_no, lead_seat, winner_seat)
    values (v_room.id, v_room.round, v_room.trick_no, coalesce(v_room.lead_seat, v_seat), v_winner)
    on conflict (room_id, round, trick_no) do update set winner_seat = excluded.winner_seat;

  if v_room.trick_no + 1 < v_cards then
    -- winner leads the next trick
    update rooms set trick_no = v_room.trick_no + 1, lead_seat = v_winner,
                     turn_seat = v_winner, version = version + 1
      where id = v_room.id;
    return;
  end if;

  -- round complete
  perform score_round(v_room.id, v_room.round);
  v_next := v_room.round + 1;

  if exists (select 1 from rounds where room_id = v_room.id and round = v_next) then
    perform deal_round(v_room.id, v_next);
    update rooms set round = v_next, phase = 'bidding',
                     turn_seat = v_next % v_n, lead_seat = null, trick_no = 0,
                     version = version + 1
      where id = v_room.id;
  else
    update rooms set status = 'finished', phase = 'game_over',
                     turn_seat = null, lead_seat = null, version = version + 1
      where id = v_room.id;
    insert into events (room_id, kind, payload) values (v_room.id, 'game_over', '{}'::jsonb);
  end if;
end $$;

revoke all on function public.play_card(text, char) from public;
grant execute on function public.play_card(text, char) to authenticated;
-- score_round and trick_winner are internal; no grants.

-- ------------------------------------------------------------- realtime ----
do $$ begin alter publication supabase_realtime add table public.plays;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.tricks;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.results;
exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.events;
exception when duplicate_object then null; end $$;
