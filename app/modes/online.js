/* Online mode: owns the lobby lifecycle — sign in, create or join, subscribe,
   and keep the seat list live. Card play arrives in the phases after this. */
import { $ } from "../dom.js";
import { isConfigured } from "../config.js";
import { signIn, currentUserId } from "../net/supabase.js";
import { createRoom, joinRoom, leaveRoom, subscribeRoom, lastRoom, forgetRoom } from "../net/room.js";
import { showLobby, renderJoinForm, renderSeated, lobbyError, lobbyBusy } from "../ui/lobby.js";

let unsubscribe = null;
let meId = null;
let code = null;

const hashCode = () => (location.hash.match(/^#([A-Za-z0-9]{4})$/) || [])[1]?.toUpperCase() || "";

function notConfigured() {
  $("lobbyBody").innerHTML = `
    <p class="lede">Online play needs a Supabase project — it is free, and nothing here works without it.</p>
    <div class="plan" style="display:block;line-height:1.9">
      <b>1.</b> Create a project at supabase.com<br>
      <b>2.</b> Run <b>supabase/migrations/0001_rooms.sql</b> in the SQL editor<br>
      <b>3.</b> Enable <b>anonymous sign-ins</b> under Authentication → Providers<br>
      <b>4.</b> Paste the Project URL and anon key into <b>app/config.js</b>
    </div>
    <div class="err">app/config.js is empty, so there is nothing to connect to.</div>`;
}

async function watch(newCode) {
  code = newCode;
  location.hash = code;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  unsubscribe = await subscribeRoom(code, snap => {
    renderSeated(snap, meId, { onLeave: doLeave });
  });
}

async function doLeave() {
  try {
    lobbyBusy(true, "leaving…");
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (code) await leaveRoom(code);
  } catch (e) {
    lobbyError(e.message);
  } finally {
    code = null;
    location.hash = "";
    forgetRoom();
    lobbyBusy(false);
    await showJoinForm();
  }
}

async function showJoinForm() {
  const remembered = lastRoom();
  renderJoinForm(
    { name: remembered?.name || "", code: hashCode() || "", maxCards: 5 },
    {
      onCreate: async (name, maxCards) => {
        if (!name) return lobbyError("Your name, first.");
        try {
          lobbyError(""); lobbyBusy(true, "setting the table…");
          await watch(await createRoom(name, maxCards));
        } catch (e) { lobbyError(e.message); lobbyBusy(false); }
      },
      onJoin: async (name, joinCode) => {
        if (!name) return lobbyError("Your name, first.");
        if (joinCode.length !== 4) return lobbyError("A table code is four letters.");
        try {
          lobbyError(""); lobbyBusy(true, "joining…");
          await joinRoom(joinCode, name);
          await watch(joinCode);
        } catch (e) { lobbyError(e.message); lobbyBusy(false); }
      },
    }
  );
}

export async function startOnline() {
  showLobby(true);
  if (!isConfigured()) return notConfigured();

  try {
    const user = await signIn();
    meId = user.id;
  } catch (e) {
    $("lobbyBody").innerHTML = `<div class="err">${e.message}</div>`;
    return;
  }

  await showJoinForm();

  /* A shared link (#ABCD) or a refresh mid-lobby: if this browser already holds
     a seat, join_room hands the same one back rather than erroring. */
  const auto = hashCode() || lastRoom()?.code;
  const name = lastRoom()?.name;
  if (auto && name) {
    try {
      lobbyBusy(true, "rejoining…");
      meId = meId || await currentUserId();
      await joinRoom(auto, name);
      await watch(auto);
    } catch {
      lobbyBusy(false);   // stale code or the game moved on — the form is already up
    }
  }
}
