/* The Declare table: your hand, the pile, and the two halves of a turn.
   Rendering only — every decision shown here is the server's, and the checks
   from shared/declare.js that grey out an illegal throw are enforced again in
   SQL before anything moves.

   A turn is two moves, in this order. First THROW a single card, a set, or a
   run. Then PICK one up, off the stock or out of the group below your own
   throw — which is whatever the player before you put down. The phase on the
   room row says which half you are in, so every browser agrees about whose move
   it is and what kind of move it has to be. */
import { $ } from "../dom.js";
import { colorFor, suitOf } from "../../shared/rules.js";
import {
  handCount, sortDeclareHand, discardError, declareError, DECLARE_AT,
} from "../../shared/declare.js";

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const GLYPH = { S:"♠", H:"♥", D:"♦", C:"♣" };
const isRed = s => s === "H" || s === "D";
const face = c => (c[0] === "T" ? "10" : c[0]);

const cardHtml = (c, { extra = "", attrs = "" } = {}) =>
  `<span class="card${isRed(suitOf(c)) ? " red" : ""}${extra}" ${attrs}>
     <b>${face(c)}</b><i>${GLYPH[suitOf(c)]}</i></span>`;

/* Which cards are ticked for throwing.

   This has to live outside the render, because the render runs again on every
   snapshot and snapshots arrive for reasons that have nothing to do with you —
   somebody else's heartbeat, say. Losing a half-built run every fifteen seconds
   would make throwing a group nearly impossible. Keyed by table and round so it
   cannot leak across a deal. */
let sel = new Set();
let selKey = "";

export function clearDeclareSelection() { sel = new Set(); selKey = ""; }

export function renderDeclarePlay(state, meId, handlers, mountId = "playpanel") {
  const { onDraw, onThrow, onDeclare, onLeave, onRestart } = handlers;
  const { room, seats, rounds, hand = [], sizes = {},
          top = [], topSeat = null, under = [], underSeat = null,
          stockLeft = 0, results = [] } = state;

  const me = seats.find(s => s.player_id === meId);
  const over = room.phase === "game_over";
  const throwing = room.phase === "throw";
  const picking = room.phase === "pick";
  const myTurn = Boolean(me) && room.turn_seat === me.seat && !over;
  const onTurn = seats.find(s => s.seat === room.turn_seat);
  const isHost = Boolean(me) && room.host_id === me.player_id;
  const hostSeat = seats.find(s => s.player_id === room.host_id);
  const hostName = hostSeat ? hostSeat.name : "the host";

  const totalBy = results.reduce((a, r) => (a[r.seat] = (a[r.seat] || 0) + r.points, a), {});
  const myCount = handCount(hand);
  const sorted = sortDeclareHand(hand);

  /* keep any selection that still makes sense, drop the rest */
  const key = `${room.code}:${room.round}`;
  if (key !== selKey) { sel = new Set(); selKey = key; }
  sel = new Set([...sel].filter(c => hand.includes(c)));
  if (!myTurn || !throwing) sel = new Set();

  const canThrow = myTurn && throwing;
  const canPickUp = myTurn && picking;

  const seatRows = seats.map(s => {
    const turn = s.seat === room.turn_seat && !over;
    const held = sizes[s.seat];
    const tot = totalBy[s.seat];
    return `<div class="nm" data-seat="${s.seat}" style="${turn ? "outline:2px solid var(--gold)" : ""}">
      <i style="background:${colorFor(s.name, s.seat)}"></i>
      <input type="text" readonly style="cursor:default${s.connected ? "" : ";opacity:.45"}"
             value="${esc(s.name)}${s.player_id === meId ? " (you)" : ""}">
      <span class="tally" title="cards in hand">${held === undefined ? "–" : `${held} card${held === 1 ? "" : "s"}`}</span>
      <span class="tally total" title="penalty points so far — lowest wins">${tot === undefined ? "" : tot}</span>
    </div>`;
  }).join("");

  /* ------------------------------------------------------------- the pile */
  /* Whose cards to show. Once you have thrown, the top of the pile is your own
     throw and you may not take it back — what you may take is the group under
     it, so that is what gets shown and made clickable. Everyone else sees the
     top, which is the newest thing on the table. */
  const showUnder = canPickUp;
  const group = showUnder ? under : top;
  const groupSeat = showUnder ? underSeat : topSeat;
  const groupName = groupSeat == null ? null : (seats.find(s => s.seat === groupSeat)?.name || "");
  const pileCards = group.length
    ? group.map(c => cardHtml(c, {
        extra: canPickUp ? " playable" : "",
        attrs: canPickUp ? `data-take="${c}" role="button" tabindex="0" title="Pick up the ${face(c)}${GLYPH[suitOf(c)]}"` : "",
      })).join("")
    : `<span class="hint">${canPickUp ? "nothing here — take from the stock" : "nothing thrown yet"}</span>`;

  const pile = over ? "" : `
    <div class="field f-pile">
      <label>${canPickUp ? "Now pick one up"
        : myTurn ? "The pile — throw first, then you may pick from it"
        : `The pile — waiting for ${esc(onTurn ? onTurn.name : "…")}`}</label>
      <div class="pile">
        <div class="pilehalf">
          <span class="pilelabel">Stock</span>
          <span class="stockpile${canPickUp && stockLeft > 0 ? " playable" : ""}"
                ${canPickUp && stockLeft > 0 ? `id="btnStock" role="button" tabindex="0" title="Take the top card of the stock"` : ""}>
            <b>${stockLeft}</b><i>left</i>
          </span>
        </div>
        <div class="pilehalf">
          <span class="pilelabel">${groupName == null ? "Turned up" : `Thrown by ${esc(groupName)}`}</span>
          <div class="hand pilehand">${pileCards}</div>
        </div>
      </div>
      <span class="hint">${canPickUp
        ? "Take the top of the stock, or any one card from the group under your own throw."
        : "Every turn: throw one card, a set, or a run of three or more in a suit — then pick one up."}</span>
    </div>`;

  /* ------------------------------------------------------------- your hand */
  const handHtml = sorted.map(c => cardHtml(c, {
    extra: (canThrow ? " playable" : "") + (sel.has(c) ? " sel" : ""),
    attrs: canThrow ? `data-card="${c}" role="button" tabindex="0" aria-pressed="${sel.has(c)}"` : "",
  })).join("");

  const declareWhy = declareError(hand);
  const throwWhy = discardError(hand, [...sel]);

  const actions = over ? "" : `
    <div class="field f-action">
      <div class="declarebar">
        <button class="panelbtn gold" id="btnThrow" ${canThrow && !throwWhy ? "" : "disabled"}
                title="${esc(!myTurn ? "Wait for your turn"
                  : picking ? "You have thrown — now pick a card up"
                  : (throwWhy || `Throw ${sel.size} card${sel.size === 1 ? "" : "s"}`))}">
          Throw${sel.size ? ` ${sel.size}` : ""}</button>
        <button class="panelbtn danger" id="btnDeclare" ${canThrow && !declareWhy ? "" : "disabled"}
                title="${esc(!myTurn ? "Wait for your turn"
                  : picking ? "Too late — declare before you throw"
                  : (declareWhy || "Declare — you think nobody is lower"))}">
          Declare at ${myCount}</button>
        <span class="hint">Declaring is legal at ${DECLARE_AT} or less, before you throw. Anyone lower than you scores nothing, and costs you 20.</span>
      </div>
    </div>`;

  /* ------------------------------------------------------------- game over */
  let finalHtml = "";
  if (over) {
    const rank = seats.map(s => ({ ...s, tot: totalBy[s.seat] || 0 }))
      .sort((a, b) => a.tot - b.tot || a.seat - b.seat);   // lowest wins
    finalHtml = `<div class="field f-action"><label>Final — lowest total wins</label>
      <div class="plan" style="display:block;line-height:2">${rank.map((p, i) =>
        `<div><b>${i === 0 ? "👑" : i === rank.length - 1 ? "🩴" : `${i + 1}.`}</b>
          ${esc(p.name)} <b>${p.tot}</b></div>`).join("")}</div></div>`;
  }

  $(mountId).classList.add("dcl");     // the mobile layout orders the two games differently
  $(mountId).innerHTML = `
    <div class="f-head" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px">
      ${over ? "" : `<span class="countcall${myCount <= DECLARE_AT ? " ready" : ""}">
        <span><small>your count</small><br><b>${myCount}</b></span>
      </span>`}
      <div class="plan" style="margin:0">
        <span>Round <b>${room.round + 1} of ${rounds.length}</b></span>
        ${over ? "" : `<span>Hand <b>${hand.length}</b></span><span>Stock <b>${stockLeft}</b></span>`}
        <span>Table <b>${esc(room.code)}</b></span>
      </div>
    </div>

    <div class="field f-seats">
      <label>${over ? "Game over"
        : myTurn ? (throwing ? "Your turn — throw first" : "Thrown — now pick one up")
        : `Waiting for ${esc(onTurn ? onTurn.name : "…")}`}<span id="clock" class="clock"></span></label>
      <div class="names">${seatRows}</div>
      <span class="hint">Each row: how many cards they are holding, then their penalty points. Lowest total wins.</span>
    </div>

    ${over ? "" : `<div class="field f-hand">
      <label>Your hand — ${hand.length} card${hand.length === 1 ? "" : "s"}, worth ${myCount}</label>
      <div class="hand${hand.length >= 8 ? " big" : ""}">${handHtml || '<span class="hint">nothing left</span>'}</div>
      <span class="hint">Only you can see these. ${canThrow
        ? "Tap the cards you want to throw — one, a pair or better, or a run of three or more in one suit."
        : "Ace 1, jack 11, queen 12, king 13."}</span>
    </div>`}

    ${actions}
    ${pile}
    ${finalHtml}

    <div class="actions" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--card-shade)">
      ${over && isHost ? `<button class="panelbtn gold" id="btnAgain">Play again with these players</button>` : ""}
      <button class="panelbtn danger" id="btnLeaveGame">${over ? "Leave table" : "Leave this table"}</button>
      ${over && !isHost ? `<span class="hint" style="align-self:center">Only ${esc(hostName)} can start another game.</span>` : ""}
      ${!over ? `<span class="hint" style="align-self:center">Your seat is kept — you can rejoin with the code.</span>` : ""}
    </div>

    <div class="err" id="lobbyErr"></div>
    <div class="hint" id="lobbyStatus"></div>`;

  /* --------------------------------------------------------------- wiring */
  const panel = $(mountId);

  /* Selecting cards repaints only the cards and the Throw button. A full
     re-render here would be a round trip through the server for something that
     has not happened yet, and it would fight the click that caused it. */
  function refreshSelection() {
    panel.querySelectorAll("[data-card]").forEach(el => {
      const on = sel.has(el.dataset.card);
      el.classList.toggle("sel", on);
      el.setAttribute("aria-pressed", String(on));
    });
    const why = discardError(hand, [...sel]);
    const btn = panel.querySelector("#btnThrow");
    if (btn) {
      btn.disabled = Boolean(why);
      btn.textContent = sel.size ? `Throw ${sel.size}` : "Throw";
      btn.title = why || `Throw ${sel.size} card${sel.size === 1 ? "" : "s"}`;
    }
  }

  const toggle = c => { sel.has(c) ? sel.delete(c) : sel.add(c); refreshSelection(); };
  panel.querySelectorAll("[data-card]").forEach(el => {
    el.onclick = () => toggle(el.dataset.card);
    el.onkeydown = e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(el.dataset.card); }
    };
  });

  panel.querySelectorAll("[data-take]").forEach(el => {
    const take = () => onDraw("discard", el.dataset.take);
    el.onclick = take;
    el.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); take(); } };
  });

  const stock = panel.querySelector("#btnStock");
  if (stock) {
    const take = () => onDraw("stock", null);
    stock.onclick = take;
    stock.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); take(); } };
  }

  const thr = panel.querySelector("#btnThrow");
  if (thr) thr.onclick = () => { if (!thr.disabled) { const cards = [...sel]; sel = new Set(); onThrow(cards); } };

  const dec = panel.querySelector("#btnDeclare");
  if (dec) dec.onclick = () => { if (!dec.disabled) onDeclare(); };

  const again = panel.querySelector("#btnAgain");
  if (again && onRestart) again.onclick = onRestart;
  const leave = panel.querySelector("#btnLeaveGame");
  if (leave && onLeave) leave.onclick = onLeave;
}
