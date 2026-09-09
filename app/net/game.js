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

export async function playCard(code, card) {
  const sb = await client();
  unwrap(await sb.rpc("play_card", { p_code: code, p_card: card }));
}

/* One authoritative snapshot: the room, seats, this round, the bids, the trick
   in progress, tricks won so far, every round's result — and only my own hand. */
export async function fetchGame(code) {
  const sb = await client();
  const room = unwrap(await sb.from("rooms").select("*").eq("code", code.toUpperCase()).maybeSingle());
  if (!room) return null;
  const id = room.id;

  const [seats, rounds, bids, hand, plays, tricks, results] = await Promise.all([
    sb.from("seats").select("*").eq("room_id", id).order("seat").then(unwrap),
    sb.from("rounds").select("*").eq("room_id", id).order("round").then(unwrap),
    sb.from("bids").select("*").eq("room_id", id).eq("round", room.round).then(unwrap),
    sb.from("hands").select("card,played").eq("room_id", id).eq("round", room.round).then(unwrap),
    sb.from("plays").select("*").eq("room_id", id).eq("round", room.round)
      .eq("trick_no", room.trick_no).order("played_at").then(unwrap),
    sb.from("tricks").select("*").eq("room_id", id).eq("round", room.round).then(unwrap),
    sb.from("results").select("*").eq("room_id", id).then(unwrap),
  ]);

  return {
    room, seats, rounds, bids, plays, tricks, results,
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
    .subscribe();

  return () => sb.removeChannel(channel);
}
