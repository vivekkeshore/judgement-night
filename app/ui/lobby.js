/* The online lobby: create or join a table, then watch the seats fill up live.
   Pure rendering plus callbacks — all network work lives in app/net/room.js. */
import { $ } from "../dom.js";
import { colorFor, handSize, cardsPerRound } from "../../shared/rules.js";

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));

export function showLobby(on) {
  $("modepick").hidden = true;
  $("setup").hidden = true;
  $("lobby").hidden = !on;
}

export function lobbyError(msg) {
  const el = $("lobbyErr");
  if (el) el.textContent = msg || "";
}

export function lobbyBusy(on, label) {
  const el = $("lobbyBody");
  if (on) el.setAttribute("aria-busy", "true"); else el.removeAttribute("aria-busy");
  const b = $("lobbyStatus");
  if (b) b.textContent = label || "";
}

/* Not-yet-in-a-room view: pick a name, then start a table or join one. */
/* One deck, so the hand size is not really a choice: floor(52 / players), capped
   at ten so a small table is not a two-hour game. The organiser picks the table
   size and sees what that implies before committing. */
const shapeFor = players => {
  const cards = handSize(players);
  return { cards, rounds: cardsPerRound(cards).length };
};

export function renderJoinForm({ name = "", code = "", players = 4 }, { onCreate, onJoin }) {
  $("lobbyBody").innerHTML = `
    <div class="field">
      <label for="myName">Your name</label>
      <input type="text" id="myName" maxlength="18" autocomplete="nickname" value="${esc(name)}" placeholder="e.g. Vivek" style="max-width:260px">
    </div>
    <div class="field">
      <label for="players">How many are playing?</label>
      <div class="stepper"><button type="button" id="pDec" aria-label="Fewer players">−</button><output id="players">${players}</output><button type="button" id="pInc" aria-label="More players">+</button></div>
      <span class="hint">3 to 8. One deck, so this decides the rest.</span>
    </div>

    <div class="plan" id="shape"></div>
    <button class="btn gold" id="btnCreate" style="padding:12px 22px;font-size:15px">Start a new table</button>

    <div class="field" style="margin-top:26px">
      <label for="joinCode">…or join a table</label>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input type="text" id="joinCode" maxlength="4" value="${esc(code)}" placeholder="CODE"
               style="width:130px;text-transform:uppercase;letter-spacing:.22em;font-family:var(--mono);font-size:20px;text-align:center">
        <button class="btn" id="btnJoin">Join</button>
      </div>
    </div>

    <div class="err" id="lobbyErr"></div>
    <div class="hint" id="lobbyStatus"></div>`;

  let count = players;
  const shape = () => {
    const s = shapeFor(count);
    $("players").value = count;
    $("shape").innerHTML = `<span>Deal <b>${s.cards}</b> cards each</span>`
      + `<span><b>${s.rounds}</b> rounds</span>`
      + `<span>${s.cards} → 1 → ${s.cards}</span>`
      + `<span>Trump <b>♥ ♠ ♦ ♣</b> repeating</span>`;
  };
  shape();
  $("pDec").onclick = () => { count = Math.max(3, count - 1); shape(); };
  $("pInc").onclick = () => { count = Math.min(8, count + 1); shape(); };

  const nameOf = () => $("myName").value.trim();
  $("btnCreate").onclick = () => onCreate(nameOf(), count);
  $("btnJoin").onclick   = () => onJoin(nameOf(), $("joinCode").value.trim().toUpperCase());
  $("joinCode").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase(); });
  $("myName").focus();
}

/* Seated view: the code to share, and the seats as they fill. */
export function renderSeated(snap, meId, { onLeave, onDeal }) {
  const { room, seats } = snap;
  const me = seats.find(s => s.player_id === meId);
  const isHost = room.host_id === meId;
  const enough = seats.length >= 3;
  const missing = Math.max(0, (room.expected_players || seats.length) - seats.length);
  /* what a deal would actually produce right now, for however many turned up */
  const dealt = shapeFor(Math.max(3, seats.length));

  $("lobbyBody").innerHTML = `
    <div class="field">
      <label>Share this code</label>
      <div style="font-family:var(--mono);font-size:44px;letter-spacing:.3em;font-weight:600">${esc(room.code)}</div>
      <span class="hint">Anyone on the same code joins this table.</span>
    </div>

    <div class="field">
      <label>At the table (${seats.length} of ${room.expected_players || seats.length})</label>
      <div class="names">${seats.map(s => `
        <div class="nm">
          <i style="background:${colorFor(s.name, s.seat)}"></i>
          <input type="text" value="${esc(s.name)}${s.player_id === meId ? " (you)" : ""}" readonly
                 style="cursor:default${s.connected ? "" : ";opacity:.45"}">
        </div>`).join("")}</div>
      <span class="hint">${!enough
        ? `Need at least 3 players — ${3 - seats.length} more.`
        : missing > 0
          ? (isHost ? `Waiting for ${missing} more, or deal now with ${seats.length}.` : `Waiting for ${missing} more.`)
          : (isHost ? "Everyone is here — deal when ready." : "Waiting for the host to deal.")}</span>
    </div>

    <div class="plan">
      <span>Seat <b>${me ? me.seat + 1 : "?"}</b></span>
      <span>Deal <b>${dealt.cards}</b> cards each</span>
      <span><b>${dealt.rounds}</b> rounds</span>
      <span>Status <b>${esc(room.status)}</b></span>
    </div>

    <div class="actions">
      <button class="btn gold" id="btnDeal" ${isHost && enough ? "" : "disabled"}
              title="${isHost ? (enough ? "Shuffle and deal round one" : "Need at least 3 players") : "Only the host can deal"}">Deal the first round</button>
      <button class="btn danger" id="btnLeave">Leave table</button>
    </div>
    <div class="err" id="lobbyErr"></div>
    <div class="hint" id="lobbyStatus"></div>`;

  $("btnLeave").onclick = onLeave;
  const deal = $("btnDeal");
  if (deal && !deal.disabled) deal.onclick = onDeal;
}
