/* Room membership and the live seat list.

   Every mutation is an RPC to a SECURITY DEFINER function (see
   supabase/migrations/0001_rooms.sql) — clients have no direct write access.
   Reads and Realtime go through the normal PostgREST client. */
import { client, signIn } from "./supabase.js";

export const LAST_ROOM_KEY = "judgement-room";

/* Which room this browser was last in, so a refresh can offer to rejoin. */
export const rememberRoom = (code, name) => {
  try { localStorage.setItem(LAST_ROOM_KEY, JSON.stringify({ code, name })); } catch {}
};
export const forgetRoom = () => { try { localStorage.removeItem(LAST_ROOM_KEY); } catch {} };
export const lastRoom = () => {
  try { return JSON.parse(localStorage.getItem(LAST_ROOM_KEY) || "null"); } catch { return null; }
};

const unwrap = ({ data, error }) => {
  if (error) throw new Error(error.message.replace(/^.*?:\s*/, ""));
  return data;
};

export async function createRoom(name, players, game = "judgement", rounds = 8) {
  const sb = await client(); await signIn();
  const code = unwrap(await sb.rpc("create_room",
    { p_name: name, p_players: players, p_game: game, p_rounds: rounds }));
  rememberRoom(code, name);
  return code;
}

/* Which game a table is playing, so a shared #CODE link or a remembered room
   opens the right client. Reading rooms.game rather than storing it alongside
   the code keeps every link that was ever shared working, including the ones
   handed out before Declare existed.

   Defaults to judgement on any failure, which covers the one case that matters:
   a database that has not had 0008_declare.sql applied yet has no `game`
   column, so the select errors and every room is a Judgement room. */
export async function roomGame(code) {
  try {
    const sb = await client(); await signIn();
    const room = unwrap(await sb.from("rooms").select("game")
      .eq("code", String(code).toUpperCase()).maybeSingle());
    return room?.game === "declare" ? "declare" : "judgement";
  } catch {
    return "judgement";
  }
}

/* Also the rejoin path: the SQL function returns your existing seat if you
   already hold one, rather than erroring. */
export async function joinRoom(code, name) {
  const sb = await client(); await signIn();
  const seat = unwrap(await sb.rpc("join_room", { p_code: code, p_name: name }));
  rememberRoom(code.toUpperCase(), name);
  return seat;
}

export async function leaveRoom(code) {
  const sb = await client();
  await sb.rpc("leave_room", { p_code: code });
  forgetRoom();
}

export async function fetchRoom(code) {
  const sb = await client();
  const room = unwrap(await sb.from("rooms").select("*").eq("code", code.toUpperCase()).maybeSingle());
  if (!room) return null;
  const seats = unwrap(await sb.from("seats").select("*").eq("room_id", room.id).order("seat"));
  return { room, seats };
}

/* Realtime tells us *that* something changed; we then re-read the room so every
   client converges on one authoritative snapshot rather than trying to patch
   its local copy from individual row events. */
export async function subscribeRoom(code, onSnapshot) {
  const sb = await client();
  const snap = await fetchRoom(code);
  if (!snap) throw new Error("no room with that code");
  onSnapshot(snap);

  const refresh = async () => {
    const next = await fetchRoom(code);
    if (next) onSnapshot(next);
  };

  const channel = sb
    .channel(`room:${code}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "seats", filter: `room_id=eq.${snap.room.id}` }, refresh)
    .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${snap.room.id}` }, refresh)
    .subscribe();

  return () => sb.removeChannel(channel);
}
