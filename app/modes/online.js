/* Online mode: owns the lobby lifecycle — sign in, create or join, subscribe,
   and keep the seat list live. Card play arrives in the phases after this. */
import { $ } from "../dom.js";
import { isConfigured } from "../config.js";
import { signIn, currentUserId } from "../net/supabase.js";
import { createRoom, joinRoom, leaveRoom, lastRoom, forgetRoom } from "../net/room.js";
import { subscribeGame, startGame, placeBid, playCard, nudge, heartbeat } from "../net/game.js";
import { showLobby, renderJoinForm, renderSeated, lobbyError, lobbyBusy } from "../ui/lobby.js";
import { renderPlay } from "../ui/play.js";

let unsubscribe = null;
let meId = null;
let code = null;
let snap = null;          // latest server snapshot
let ticker = null;        // 1s clock + expiry nudge
let beat = null;          // presence heartbeat
let nudging = false;

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

/* The clock is redrawn every second in place rather than by re-rendering the
   view, which would reset hover and focus mid-turn. When it runs out, whoever
   notices tells the server; the server re-checks the deadline itself, so this
   cannot be used to hurry anyone. The stagger keeps three browsers from all
   firing the same nudge at the same instant. */
function stopTimers() {
  clearInterval(ticker); ticker = null;
  clearInterval(beat);   beat = null;
}

function startTimers() {
  stopTimers();
  beat = setInterval(() => { if (code) heartbeat(code); }, 15000);
  ticker = setInterval(async () => {
    const el = document.getElementById("clock");
    if (!snap || !snap.room.deadline || snap.room.phase === "game_over") {
      if (el) el.textContent = "";
      return;
    }
    const left = Math.ceil((new Date(snap.room.deadline) - Date.now()) / 1000);
    if (el) {
      el.textContent = left > 0 ? `${left}s` : "time";
      el.classList.toggle("urgent", left <= 10);
    }
    if (left > 0 || nudging) return;

    const mySeat = snap.seats.find(s => s.player_id === meId)?.seat ?? 0;
    await new Promise(r => setTimeout(r, 250 * mySeat));   // stagger
    if (nudging) return;
    nudging = true;
    try { await nudge(code); } catch { /* someone else got there first */ }
    finally { nudging = false; }
  }, 1000);
}

/* One subscription for the whole table. Which view is shown is decided purely by
   the server's phase, so every client agrees on what is happening. */
async function watch(newCode) {
  code = newCode;
  location.hash = code;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  unsubscribe = await subscribeGame(code, next => {
    snap = next;
    lobbyBusy(false);
    if (next.room.status === "lobby") {
      renderSeated(next, meId, { onLeave: doLeave, onDeal: doDeal });
    } else {
      renderPlay(next, meId, { onBid: doBid, onPlay: doPlay });
    }
  });
  startTimers();
  heartbeat(code);
}

async function doDeal() {
  try { lobbyError(""); lobbyBusy(true, "shuffling…"); await startGame(code); }
  catch (e) { lobbyError(e.message); lobbyBusy(false); }
}

async function doBid(bid) {
  try { lobbyError(""); await placeBid(code, bid); }
  catch (e) { lobbyError(e.message); }
}

async function doPlay(card) {
  try { lobbyError(""); await playCard(code, card); }
  catch (e) { lobbyError(e.message); }
}

async function doLeave() {
  try {
    lobbyBusy(true, "leaving…");
    stopTimers();
    snap = null;
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
