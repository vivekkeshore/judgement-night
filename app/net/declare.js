/* Declare state reads and moves. Writes are RPCs to the SECURITY DEFINER
   functions in supabase/migrations/0008_declare.sql — the client cannot write a
   row here any more than it can in Judgement.

   Two things are deliberately unreadable. `declare_hands` has an RLS policy
   restricting it to your own seat and is absent from the realtime publication,
   so another player's cards never cross a channel. `declare_stock` has no
   select policy at all: if a client could read the stock it would know the whole
   deal, and the game would be over. What is left of it arrives as a bare count
   on rooms.stock_left. */
import { client } from "./supabase.js";

const unwrap = ({ data, error }) => {
  if (error) {
    /* PostgREST says "Could not find the table 'public.x' in the schema cache"
       when a migration has not been applied. Say which one. */
    const m = /Could not find the (?:table|function) 'public\.(\w+)'/.exec(error.message);
    if (m) throw new Error(
      `the database is missing "${m[1]}" — run supabase/migrations/0008_declare.sql in the SQL editor`);
    if (/column rooms\.(game|total_rounds|stock_left) does not exist/.test(error.message))
      throw new Error("the database predates Declare — run supabase/migrations/0008_declare.sql in the SQL editor");
    throw new Error(error.message.replace(/^.*?:\s*/, ""));
  }
  return data;
};

export async function declareStart(code) {
  const sb = await client();
  unwrap(await sb.rpc("declare_start", { p_code: code }));
}

/* from is "stock" or "discard"; card names which of the thrown group you want,
   and is ignored when drawing off the stock. */
export async function drawCard(code, from, card = null) {
  const sb = await client();
  unwrap(await sb.rpc("draw_card", { p_code: code, p_from: from, p_card: card }));
}

export async function discardCards(code, cards) {
  const sb = await client();
  unwrap(await sb.rpc("discard_cards", { p_code: code, p_cards: cards }));
}

export async function declareHand(code) {
  const sb = await client();
  unwrap(await sb.rpc("declare_hand", { p_code: code }));
}

/* One authoritative snapshot: the room, seats, the round schedule, the discard
   pile, how many cards everyone is holding, every round's result — and only my
   own hand. */
export async function fetchDeclare(code) {
  const sb = await client();
  const room = unwrap(await sb.from("rooms").select("*").eq("code", code.toUpperCase()).maybeSingle());
  if (!room) return null;
  const id = room.id;

  const [seats, rounds, mine, discards, sizes, results, events] = await Promise.all([
    sb.from("seats").select("*").eq("room_id", id).order("seat").then(unwrap),
    sb.from("rounds").select("*").eq("room_id", id).order("round").then(unwrap),
    sb.from("declare_hands").select("card").eq("room_id", id).eq("round", room.round).then(unwrap),
    sb.from("declare_discards").select("*").eq("room_id", id).eq("round", room.round).order("seq").then(unwrap),
    sb.from("declare_seat_state").select("*").eq("room_id", id).eq("round", room.round).then(unwrap),
    sb.from("declare_results").select("*").eq("room_id", id).then(unwrap),
    sb.from("events").select("*").eq("room_id", id).order("id").then(unwrap),
  ]);

  /* The pile, newest group last. Two of them matter, because a turn is throw
     then pick: the top is whatever was thrown most recently, and the group
     under it is what the player now picking is entitled to take — their own
     throw is sitting on top of it. See 0009_declare_throw_first.sql. */
  const n = discards.length;
  const top = n ? discards[n - 1] : null;
  const under = n > 1 ? discards[n - 2] : null;
  const cardsOf = g => (g && Array.isArray(g.cards) ? g.cards : []);

  return {
    room, seats, rounds, discards, results, events,
    round: rounds.find(r => r.round === room.round) || null,
    hand: mine.map(h => h.card),
    sizes: Object.fromEntries(sizes.map(s => [s.seat, s.n_cards])),
    top: cardsOf(top), topSeat: top ? top.seat : null,
    under: cardsOf(under), underSeat: under ? under.seat : null,
    stockLeft: room.stock_left ?? 0,
  };
}

/* Realtime says "something moved"; we then re-read the snapshot so every client
   converges on the server's view rather than patching a local copy. The two
   hidden tables are not in the publication, so the trigger for a new hand is
   the rooms row changing — which _set_turn guarantees on every move. */
export async function subscribeDeclare(code, onSnapshot) {
  const sb = await client();
  const first = await fetchDeclare(code);
  if (!first) throw new Error("no room with that code");
  onSnapshot(first);

  const id = first.room.id;
  let pending = false;
  const refresh = async () => {
    if (pending) return;                       // collapse bursts into one read
    pending = true;
    await Promise.resolve();
    pending = false;
    const next = await fetchDeclare(code);
    if (next) onSnapshot(next);
  };

  const f = `room_id=eq.${id}`;
  const channel = sb.channel(`declare:${code}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms",              filter: `id=eq.${id}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "seats",              filter: f }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "rounds",             filter: f }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "declare_discards",   filter: f }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "declare_seat_state", filter: f }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "declare_results",    filter: f }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "events",             filter: f }, refresh)
    .subscribe();

  return () => sb.removeChannel(channel);
}
