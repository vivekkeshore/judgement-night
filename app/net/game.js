/* Game state reads and moves. Writes are RPCs to the SECURITY DEFINER functions
   in supabase/migrations/0002_deal_and_bid.sql — the client cannot write a row.

   Note that a player's hand is fetched separately and only ever contains their
   own cards: the RLS policy on `hands` filters it server-side, and `hands` is
   not in the realtime publication, so nobody else's cards are ever sent here. */
import { client } from "./supabase.js";

const unwrap = ({ data, error }) => {
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ""));
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

/* One authoritative snapshot: the room, the seats, this round, every bid, and
   only my own hand. */
export async function fetchGame(code) {
  const sb = await client();
  const room = unwrap(await sb.from("rooms").select("*").eq("code", code.toUpperCase()).maybeSingle());
  if (!room) return null;

  const [seats, rounds, bids, hand] = await Promise.all([
    sb.from("seats").select("*").eq("room_id", room.id).order("seat").then(unwrap),
    sb.from("rounds").select("*").eq("room_id", room.id).order("round").then(unwrap),
    sb.from("bids").select("*").eq("room_id", room.id).eq("round", room.round).then(unwrap),
    sb.from("hands").select("card,played").eq("room_id", room.id).eq("round", room.round).then(unwrap),
  ]);

  return {
    room, seats, rounds, bids,
    round: rounds.find(r => r.round === room.round) || null,
    hand: hand.map(h => h.card),
  };
}

/* Realtime says "something moved"; we then re-read the snapshot so every client
   converges on the server's view rather than patching a local copy. */
export async function subscribeGame(code, onSnapshot) {
  const sb = await client();
  const first = await fetchGame(code);
  if (!first) throw new Error("no room with that code");
  onSnapshot(first);

  const roomId = first.room.id;
  let queued = false;
  const refresh = async () => {
    if (queued) return;                       // collapse bursts into one read
    queued = true;
    await Promise.resolve();
    queued = false;
    const next = await fetchGame(code);
    if (next) onSnapshot(next);
  };

  const filter = `room_id=eq.${roomId}`;
  const channel = sb.channel(`game:${code}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms",  filter: `id=eq.${roomId}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "seats",  filter }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "rounds", filter }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "bids",   filter }, refresh)
    .subscribe();

  return () => sb.removeChannel(channel);
}
