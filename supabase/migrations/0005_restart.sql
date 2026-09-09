-- Phase 5b: let a table start over.
--
-- Run in the Supabase SQL editor after 0004_turn_clock.sql.
--
-- Without this there is no way out of a finished game: the room stays at
-- status 'playing' forever and start_game refuses to run again. This clears the
-- game away and returns the room to the lobby, keeping the seats — so the same
-- players can deal a fresh game without swapping codes.
--
-- Leaving a table needs no new function: leave_room already keeps your seat and
-- marks you away mid-game, so you can rejoin, while in the lobby it frees the
-- seat and hands the room to whoever is left.

create or replace function public.restart_game(p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare v_room rooms; v_uid uuid := auth.uid();
begin
  select * into v_room from rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'no room with that code'; end if;
  if v_room.host_id <> v_uid then raise exception 'only the host can start a new game'; end if;
  if v_room.status = 'lobby' then return; end if;   -- already back in the lobby

  delete from plays   where room_id = v_room.id;
  delete from tricks  where room_id = v_room.id;
  delete from results where room_id = v_room.id;
  delete from hands   where room_id = v_room.id;
  delete from bids    where room_id = v_room.id;
  delete from rounds  where room_id = v_room.id;
  delete from events  where room_id = v_room.id;

  update rooms set status = 'lobby', phase = 'lobby', round = 0,
                   turn_seat = null, lead_seat = null, trick_no = 0,
                   deadline = null, version = version + 1
    where id = v_room.id;
end $$;

revoke all on function public.restart_game(text) from public;
grant execute on function public.restart_game(text) to authenticated;
