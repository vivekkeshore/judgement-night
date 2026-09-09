/* Game state reads and moves. Writes are RPCs to the SECURITY DEFINER functions
   in the migrations — the client cannot write a row.

   A player's hand is fetched separately and only ever contains their own cards:
   the RLS policy on `hands` filters it server-side, and `hands` is not in the
   realtime publication, so nobody else's cards are ever sent here. */
import { client } from "./supabase.js";

const unwrap = ({ data, error }) => {
  if (error) {
    /* PostgREST says "Could not find the table 'public.x' in the schema cache"
       when a migration has not been applied. Say which one. */
    const m = /Could not find the table 'public\.(\w+)'/.exec(error.message);
    if (m) {
      const which = ["rounds","hands","bids"].includes(m[1]) ? "0002_deal_and_bid.sql"
                  : ["plays","tricks","results","events"].includes(m[1]) ? "0003_trick_play.sql"
                  : "0001_rooms.sql";
      throw new Error(`the database is missing table "${m[1]}" — run supabase/migrations/${which} in the SQL editor`);
    }
    throw new Error(error.message.replace(/^.*?:\s*/, ""));
  }
  return data;
};

export async function startGame(code) {
  const sb = await client();
  unwrap(await sb.rpc("start_game", { p_code: code }));
}

export async function placeBid(code, bid) {
  const sb = await client();
  unwrap(await sb.rpc("place_bid", { p_code: code, p_bid: bid }));
}

/* Clear a finished (or abandoned) game and put the room back in the lobby,
   keeping the seats so the same players can deal again on the same code. */
export async function restartGame(code) {
  const sb = await client();
  unwrap(await sb.rpc("restart_game", { p_code: code }));
}

export async function playCard(code, card) {
  const sb = await client();
  unwrap(await sb.rpc("play_card", { p_code: code, p_card: card }));
}

/* Tell the server the clock has run out. It re-checks the deadline itself, so
   this is only a nudge — several clients calling at once is harmless. */
export async function nudge(code) {
  const sb = await client();
  return unwrap(await sb.rpc("nudge", { p_code: code }));
}

/* Presence: "I am still here", and age out anyone who is not. */
export async function heartbeat(code) {
  const sb = await client();
  try { await sb.rpc("heartbeat", { p_code: code }); } catch { /* not worth surfacing */ }
}

/* One authoritative snapshot: the room, seats, this round, the bids, the trick
   in progress, tricks won so far, every round's result — and only my own hand. */
export async function fetchGame(code) {
  const sb = await client();
  const room = unwrap(await sb.from("rooms").select("*").eq("code", code.toUpperCase()).maybeSingle());
  if (!room) return null;
  const id = room.id;

  const [seats, rounds, bids, allBids, hand, plays, tricks, results, events] = await Promise.all([
    sb.from("seats").select("*").eq("room_id", id).order("seat").then(unwrap),
    sb.from("rounds").select("*").eq("room_id", id).order("round").then(unwrap),
    sb.from("bids").select("*").eq("room_id", id).eq("round", room.round).then(unwrap),
    sb.from("bids").select("*").eq("room_id", id).then(unwrap),
    sb.from("hands").select("card,played").eq("room_id", id).eq("round", room.round).then(unwrap),
    /* the round's plays, not just this trick's. The server finishes a trick and
       advances trick_no in one transaction, so filtering on the live trick_no
       means the winning card is never fetched at all — the table would jump from
       three cards to none and nobody would see what took it. The previous round
       comes too, so the last trick of a round survives the rollover. */
    sb.from("plays").select("*").eq("room_id", id)
      .in("round", [Math.max(0, room.round - 1), room.round])
      .order("played_at").then(unwrap),
    sb.from("tricks").select("*").eq("room_id", id).eq("round", room.round).then(unwrap),
    sb.from("results").select("*").eq("room_id", id).then(unwrap),
    sb.from("events").select("*").eq("room_id", id).order("id").then(unwrap),
  ]);

  return {
    room, seats, rounds, bids, allBids, plays, tricks, results, events,
    /* what is on the table right now, derived rather than fetched */
    trickPlays: plays.filter(p => p.round === room.round && p.trick_no === room.trick_no),
    round: rounds.find(r => r.round === room.round) || null,
    hand: hand.filter(h => !h.played).map(h => h.card),   // cards still in hand
  };
}

/* Realtime says "something moved"; we then re-read the snapshot so every client
   converges on the server's view rather than patching a local copy. */
export async function subscribeGame(code, onSnapshot) {
  const sb = await client();
  const first = await fetchGame(code);
  if (!first) throw new Error("no room with that code");
  onSnapshot(first);

  const id = first.room.id;
  let pending = false;
  const refresh = async () => {
    if (pending) return;                       // collapse bursts into one read
    pending = true;
    await Promise.resolve();
    pending = false;
    const next = await fetchGame(code);
    if (next) onSnapshot(next);
  };

  const f = `room_id=eq.${id}`;
  const channel = sb.channel(`game:${code}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms",   filter: `id=eq.${id}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "seats",   filter: f }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "rounds",  filter: f }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "bids",    filter: f }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "plays",   filter: f }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "tricks",  filter: f }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "results", filter: f }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "events",  filter: f }, refresh)
    .subscribe();

  return () => sb.removeChannel(channel);
}
