/* The online lobby: create or join a table, then watch the seats fill up live.
   Pure rendering plus callbacks — all network work lives in app/net/room.js. */
import { $ } from "../dom.js";
import { colorFor } from "../../shared/rules.js";

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
export function renderJoinForm({ name = "", code = "", maxCards = 5 }, { onCreate, onJoin }) {
  $("lobbyBody").innerHTML = `
    <div class="field">
      <label for="myName">Your name</label>
      <input type="text" id="myName" maxlength="18" autocomplete="nickname" value="${esc(name)}" placeholder="e.g. Vivek" style="max-width:260px">
    </div>
    <div class="plan"><span>3 to 8 players</span><span>Everyone needs the 4-letter code</span><span>Cards <b>max → 1 → max</b></span></div>

    <div class="field">
      <label for="maxCards">Cards in the first round</label>
      <input type="number" id="maxCards" min="1" max="17" value="${maxCards}" style="width:120px">
      <span class="hint">Capped by the deck once everyone has joined.</span>
    </div>
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

  const nameOf = () => $("myName").value.trim();
  $("btnCreate").onclick = () => onCreate(nameOf(), +$("maxCards").value || 5);
  $("btnJoin").onclick   = () => onJoin(nameOf(), $("joinCode").value.trim().toUpperCase());
  $("joinCode").addEventListener("input", e => { e.target.value = e.target.value.toUpperCase(); });
  $("myName").focus();
}

/* Seated view: the code to share, and the seats as they fill. */
export function renderSeated(snap, meId, { onLeave }) {
  const { room, seats } = snap;
  const me = seats.find(s => s.player_id === meId);
  const isHost = room.host_id === meId;
  const enough = seats.length >= 3;

  $("lobbyBody").innerHTML = `
    <div class="field">
      <label>Share this code</label>
      <div style="font-family:var(--mono);font-size:44px;letter-spacing:.3em;font-weight:600">${esc(room.code)}</div>
      <span class="hint">Anyone on the same code joins this table.</span>
    </div>

    <div class="field">
      <label>At the table (${seats.length} of 8)</label>
      <div class="names">${seats.map(s => `
        <div class="nm">
          <i style="background:${colorFor(s.name, s.seat)}"></i>
          <input type="text" value="${esc(s.name)}${s.player_id === meId ? " (you)" : ""}" readonly
                 style="cursor:default${s.connected ? "" : ";opacity:.45"}">
        </div>`).join("")}</div>
      <span class="hint">${enough
        ? (isHost ? "You're the host — dealing arrives in the next phase." : "Waiting for the host to deal.")
        : `Need at least 3 players — ${3 - seats.length} more.`}</span>
    </div>

    <div class="plan">
      <span>Seat <b>${me ? me.seat + 1 : "?"}</b></span>
      <span>First round <b>${room.max_cards}</b> cards</span>
      <span>Status <b>${esc(room.status)}</b></span>
    </div>

    <div class="actions">
      <button class="btn gold" id="btnDeal" disabled title="Dealing arrives in the next phase">Deal the first round</button>
      <button class="btn danger" id="btnLeave">Leave table</button>
    </div>
    <div class="err" id="lobbyErr"></div>
    <div class="hint" id="lobbyStatus"></div>`;

  $("btnLeave").onclick = onLeave;
}
