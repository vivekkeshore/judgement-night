/* Online mode: owns the lobby lifecycle — sign in, create or join, subscribe,
   and keep the seat list live. Card play arrives in the phases after this. */
import { $ } from "../dom.js";
import { isConfigured } from "../config.js";
import { signIn, currentUserId } from "../net/supabase.js";
import { createRoom, joinRoom, leaveRoom, lastRoom, forgetRoom } from "../net/room.js";
import { subscribeGame, startGame, placeBid, playCard, nudge, heartbeat, restartGame } from "../net/game.js";
import { showLobby, renderJoinForm, renderSeated, lobbyError, lobbyBusy } from "../ui/lobby.js";
import { renderPlay } from "../ui/play.js";
import { setG } from "../state.js";
import { totals, ordered, doneCount, lastCompleteRound, TRUMPS } from "../../shared/rules.js";
import { snapshotToG, fallenSeatFrom } from "./adapt.js";
import { renderStrip, renderFallen, placeFigures } from "../ui/strip.js";
import { renderLeaderboard } from "../ui/leaderboard.js";
import { renderChart } from "../ui/chart.js";
import { renderScoreTable } from "../ui/scoretable.js";
import { completedTrick, freshDeal, sweepTrick, shuffleCurtain } from "../ui/animations.js";
import { renderTicker, renderStock } from "../ui/ticker.js";
import { syncSticky } from "../ui/sticky.js";

let unsubscribe = null;
let meId = null;
let code = null;
let snap = null;          // latest server snapshot
let ticker = null;        // 1s clock + expiry nudge
let beat = null;          // presence heartbeat
let nudging = false;
let animating = false;   // an animation owns the panel; hold later snapshots
let queuedSnap = null;

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
  unsubscribe = await subscribeGame(code, onSnapshot);
  startTimers();
  heartbeat(code);
}

/* Animations run against the table as it currently stands, before the new
   snapshot replaces it — the winning cards only exist in the DOM at that point,
   because the server has already moved on to the next trick. Snapshots that
   arrive mid-animation are queued rather than dropped, so the table always
   settles on the latest state. */
async function onSnapshot(next) {
  if (animating) { queuedSnap = next; return; }

  const prev = snap;
  lobbyBusy(false);

  if (next.room.status === "lobby") {
    snap = next; showTable(false);
    renderSeated(next, meId, { onLeave: doLeave, onDeal: doDeal });
    return;
  }

  const trick = completedTrick(prev, next);
  const dealt = freshDeal(prev, next);
  if (!trick && !dealt) { snap = next; renderTable(next); return; }

  animating = true;
  try {
    if (trick) {
      const who = prev.seats.find(s => s.seat === trick.winner);
      await sweepTrick(trick.winner, who ? who.name : "");
    }
    if (dealt) {
      const r = next.rounds.find(x => x.round === next.room.round);
      showTable(true);
      await shuffleCurtain("playpanel", next.room.round + 1, r ? r.cards : 0);
    }
  } finally {
    animating = false;
    const latest = queuedSnap || next;
    queuedSnap = null;
    snap = latest;
    renderTable(latest);
  }
}

/* Once dealing starts, online play moves out of the lobby panel and into the
   real furniture — the pinned strip, the leaderboard and the chart — so it gets
   the apsara and the rest for free rather than reimplementing them. */
function showTable(on) {
  $("lobby").hidden = on;
  $("game").hidden = !on;
  $("actions").hidden = true;      // Edit players / New game belong to manual mode
  $("tablewrap").hidden = on;      // the editable score table is manual-only
  $("playpanel").hidden = !on;
  $("status").hidden = on;
  $("scoresection").hidden = !on;
}

function renderTable(next) {
  showTable(true);
  const g = snapshotToG(next);
  setG(g);                          // the shared UI modules read state from here

  const T = totals(g), ord = ordered(g), scored = doneCount(g);
  renderStrip(T, scored, ord[0], ord[ord.length - 1]);
  /* renderStrip moves the apsara and infers a dethroned seat from that move.
     Override it with the server's own history so every screen agrees, and so a
     client that joined late or received a batch does not miss a change.
     The guard is belt and braces: the server picks the leader with the same
     "highest total, lowest seat wins ties" rule used here, so the seat it
     records as dethroned should never be the one currently leading — but if
     they ever did coincide, both figures would land on one card. */
  const fallen = fallenSeatFrom(next.events);
  renderFallen(fallen === ord[0].i ? null : fallen);
  renderLeaderboard(ord, scored);
  renderTicker(ord, next.room.phase === "game_over");
  renderStock(lastCompleteRound(g));
  renderChart();
  /* the masthead is shared with manual mode, so it would otherwise keep showing
     whatever an unfinished local game left behind */
  const t = TRUMPS.find(x => x[3] === (next.round ? next.round.trump : "H")) || TRUMPS[0];
  $("meta").innerHTML = `${next.seats.length} players · ${next.rounds.length} rounds`
    + `<br>Round <b>${next.room.round + 1} / ${next.rounds.length}</b> · Trump <b>${t[0]} ${t[1]}</b>`
    + `<br>Table <b>${next.room.code}</b>`;

  renderScoreTable(next);
  renderPlay(next, meId, { onBid: doBid, onPlay: doPlay, onLeave: doLeave, onRestart: doRestart }, "playpanel");
  syncSticky();
  placeFigures();
}

async function doDeal() {
  try { lobbyError(""); lobbyBusy(true, "shuffling…"); await startGame(code); }
  catch (e) { lobbyError(e.message); lobbyBusy(false); }
}

async function doBid(bid) {
  try { lobbyError(""); await placeBid(code, bid); }
  catch (e) { lobbyError(e.message); }
}

async function doRestart() {
  try {
    lobbyError(""); lobbyBusy(true, "clearing the table…");
    await restartGame(code);          // back to the lobby, seats kept
  } catch (e) { lobbyError(e.message); lobbyBusy(false); }
}

async function doPlay(card) {
  try { lobbyError(""); await playCard(code, card); }
  catch (e) { lobbyError(e.message); }
}

async function doLeave() {
  try {
    lobbyBusy(true, "leaving…");
    stopTimers();
    snap = null; queuedSnap = null; animating = false;
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (code) await leaveRoom(code);
  } catch (e) {
    lobbyError(e.message);
  } finally {
    code = null;
    location.hash = "";
    showTable(false);
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
