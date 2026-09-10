/* Online Declare. Same rooms, same seats, same presence and the same turn clock
   as Judgement — see modes/table.js for the parts they share — with a different
   game bolted to the front of them.

   The shared furniture comes along too: the pinned strip with the apsara, the
   leaderboard portraits, the ticker and the chart all read the adapted state and
   do not care which game produced it. What they do care about is which way the
   scoring runs, and G.game tells them: in Declare the points are penalties, so
   the apsara stands on the SMALLEST total and the slipper goes to the largest. */
import { $ } from "../dom.js";
import { isConfigured } from "../config.js";
import { signIn, currentUserId } from "../net/supabase.js";
import { createRoom, joinRoom, leaveRoom, lastRoom, forgetRoom } from "../net/room.js";
import { nudge, heartbeat, restartGame } from "../net/game.js";
import {
  subscribeDeclare, declareStart, drawCard, discardCards, declareHand,
} from "../net/declare.js";
import { showLobby, renderJoinForm, renderSeated, lobbyError, lobbyBusy } from "../ui/lobby.js";
import { renderDeclarePlay, clearDeclareSelection } from "../ui/declare-play.js";
import { renderDeclareScores } from "../ui/declare-scores.js";
import { setG } from "../state.js";
import { totals, ordered, doneCount, lastCompleteRound } from "../../shared/rules.js";
import { HAND_SIZE, DEFAULT_ROUNDS } from "../../shared/declare.js";
import { declareSnapshotToG, fallenSeatFrom } from "./adapt.js";
import { hashCode, notConfigured, makeClock, makeGate } from "./table.js";
import { renderStrip, renderFallen, placeFigures } from "../ui/strip.js";
import { renderLeaderboard } from "../ui/leaderboard.js";
import { renderChart } from "../ui/chart.js";
import { freshDeal, shuffleCurtain, newDeclaration, declareReveal } from "../ui/animations.js";
import { renderTicker, renderStock } from "../ui/ticker.js";
import { syncSticky } from "../ui/sticky.js";

let unsubscribe = null;
let meId = null;
let code = null;
let snap = null;

const clock = makeClock({
  code: () => code,
  snap: () => snap,
  seat: () => snap?.seats.find(s => s.player_id === meId)?.seat ?? 0,
  nudge, heartbeat,
});
const gate = makeGate();

async function watch(newCode) {
  code = newCode;
  location.hash = code;
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  unsubscribe = await subscribeDeclare(code, onSnapshot);
  clock.start();
  heartbeat(code);
}

/* Two things are worth pausing the table for: a declaration, and the next deal.
   They arrive together — declaring scores the round and deals the next one in
   the same transaction — so the reveal has to run before the shuffle, or the
   round everyone was playing is gone before anyone has read the result. */
async function onSnapshot(next) {
  if (gate.busy) { gate.hold(next); return; }

  const prev = snap;
  lobbyBusy(false);

  if (next.room.status === "lobby") {
    snap = next; showTable(false);
    renderSeated(next, meId, { onLeave: doLeave, onDeal: doDeal, game: "declare" });
    return;
  }

  const called = newDeclaration(prev, next);
  const dealt = freshDeal(prev, next);
  if (!called && !dealt) { snap = next; renderTable(next); return; }

  await gate.run(next, async () => {
    if (called) {
      /* Render the round that just ended, not the one that has replaced it —
         the reveal is about the hand people were holding a moment ago. */
      if (prev) renderTable(prev);
      const who = next.seats.find(s => s.seat === called.seat);
      await declareReveal("playpanel", { name: who ? who.name : "Somebody", ...called });
    }
    if (dealt) {
      showTable(true);
      await shuffleCurtain("playpanel", next.room.round + 1, HAND_SIZE);
    }
  }, latest => { snap = latest; renderTable(latest); });
}

/* Declare moves out of the lobby panel and into the real furniture, exactly as
   Judgement does — so it gets the apsara and the rest for free. */
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
  const g = declareSnapshotToG(next);
  setG(g);                          // the shared UI modules read state from here

  const T = totals(g), ord = ordered(g), scored = doneCount(g);
  renderStrip(T, scored, ord[0], ord[ord.length - 1]);
  /* The server picks the leader with the same "lowest total, lowest seat breaks
     ties" rule that ordered() uses here, so the seat it records as dethroned
     should never be the one currently leading — but if they ever did coincide,
     the apsara and the fallen king would land on the same card. */
  const fallen = fallenSeatFrom(next.events);
  renderFallen(fallen === ord[0].i ? null : fallen);
  renderLeaderboard(ord, scored);
  renderTicker(ord, next.room.phase === "game_over");
  renderStock(lastCompleteRound(g));
  renderChart();

  $("meta").innerHTML = `${next.seats.length} players · Declare`
    + `<br>Round <b>${next.room.round + 1} / ${next.rounds.length}</b> · <b>Lowest total wins</b>`
    + `<br>Table <b>${next.room.code}</b>`;
  /* the footer is shared with Judgement, so it would otherwise be explaining
     bids at a table where nobody bids */
  $("foot").textContent = "Throw one card, a set, or a run of three or more in a suit — then pick one up · "
    + "Take the stock, or any card from the group the player before you threw · "
    + "Ace 1, jack 11, queen 12, king 13 · Declare at 10 or less, before you throw · "
    + "Anyone lower than the declarer scores nothing and costs them 20 · Lowest total after the last round wins";

  renderDeclareScores(next);
  renderDeclarePlay(next, meId, {
    onDraw: doDraw, onThrow: doThrow, onDeclare: doDeclare,
    onLeave: doLeave, onRestart: doRestart,
  }, "playpanel");
  syncSticky();
  placeFigures();
}

async function doDeal() {
  try { lobbyError(""); lobbyBusy(true, "shuffling…"); await declareStart(code); }
  catch (e) { lobbyError(e.message); lobbyBusy(false); }
}

async function doDraw(from, card) {
  try { lobbyError(""); await drawCard(code, from, card); }
  catch (e) { lobbyError(e.message); }
}

async function doThrow(cards) {
  try { lobbyError(""); await discardCards(code, cards); }
  catch (e) { lobbyError(e.message); if (snap) renderTable(snap); }
}

async function doDeclare() {
  try { lobbyError(""); await declareHand(code); }
  catch (e) { lobbyError(e.message); }
}

async function doRestart() {
  try {
    lobbyError(""); lobbyBusy(true, "clearing the table…");
    clearDeclareSelection();
    await restartGame(code);          // back to the lobby, seats kept
  } catch (e) { lobbyError(e.message); lobbyBusy(false); }
}

async function doLeave() {
  try {
    lobbyBusy(true, "leaving…");
    clock.stop();
    snap = null; gate.reset(); clearDeclareSelection();
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
    { name: remembered?.name || "", code: hashCode() || "", players: 4,
      game: "declare", rounds: DEFAULT_ROUNDS },
    {
      onCreate: async (name, players, rounds) => {
        if (!name) return lobbyError("Your name, first.");
        try {
          lobbyError(""); lobbyBusy(true, "setting the table…");
          await watch(await createRoom(name, players, "declare", rounds));
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

export async function startDeclare() {
  showLobby(true);
  if (!isConfigured()) return notConfigured("0001_rooms.sql");

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
