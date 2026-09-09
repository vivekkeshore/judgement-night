/* The online table during a hand: your cards, the bidding, and who is on turn.
   Rendering only — every decision it displays is the server's, and the same
   shared/rules.js check that greys out an illegal bid also rejects it in SQL. */
import { $ } from "../dom.js";
import { colorFor, TRUMPS, trumpOf, suitOf, bidError, lastBidder, sortHand } from "../../shared/rules.js";

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const SUIT_GLYPH = { S:"♠", H:"♥", D:"♦", C:"♣" };
const isRed = s => s === "H" || s === "D";

export function renderPlay(state, meId, { onBid }) {
  const { room, seats, round, bids, hand } = state;
  const me = seats.find(s => s.player_id === meId);
  const n = seats.length;
  const bidBy = Object.fromEntries(bids.map(b => [b.seat, b.bid]));
  const trump = round ? round.trump : trumpOf(room.round);
  const trumpName = (TRUMPS.find(t => t[3] === trump) || TRUMPS[0])[1];
  const myTurn = me && room.turn_seat === me.seat && room.phase === "bidding";
  const onTurn = seats.find(s => s.seat === room.turn_seat);

  const seatRows = seats.map(s => {
    const bid = bidBy[s.seat];
    const turn = s.seat === room.turn_seat;
    return `<div class="nm" style="${turn ? "outline:2px solid var(--gold)" : ""}">
      <i style="background:${colorFor(s.name, s.seat)}"></i>
      <input type="text" readonly style="cursor:default${s.connected ? "" : ";opacity:.45"}"
             value="${esc(s.name)}${s.player_id === meId ? " (you)" : ""}">
      <span style="font-family:var(--mono);font-weight:600;min-width:2.5em;text-align:right">${
        bid === undefined ? (turn ? "…" : "") : bid}</span>
    </div>`;
  }).join("");

  /* one button per legal bid, with the banned one visibly out of reach */
  let bidBar = "";
  if (myTurn && round) {
    const others = Object.fromEntries(seats.filter(s => s.seat !== me.seat).map(s => [s.seat, bidBy[s.seat] ?? null]));
    const isLast = me.seat === lastBidder(room.round, n);
    bidBar = `<div class="field"><label>Your bid — how many tricks will you take?</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${
        Array.from({ length: round.cards + 1 }, (_, b) => {
          const err = bidError({ cards: round.cards, bid: b, isLastBidder: isLast, otherBids: others });
          return `<button class="bidbtn" data-bid="${b}" ${err ? `disabled title="${esc(err)}"` : ""}>${b}</button>`;
        }).join("")}</div>
      <span class="hint">${isLast ? "You bid last, so the total may not come to exactly " + round.cards + "." : ""}</span>
    </div>`;
  }

  const cards = sortHand(hand, trump).map(c => `
    <span class="card${isRed(suitOf(c)) ? " red" : ""}${suitOf(c) === trump ? " trump" : ""}">
      <b>${c[0] === "T" ? "10" : c[0]}</b><i>${SUIT_GLYPH[suitOf(c)]}</i>
    </span>`).join("");

  $("lobbyBody").innerHTML = `
    <div class="plan">
      <span>Round <b>${room.round + 1} of ${state.rounds.length}</b></span>
      <span>Trump <b>${SUIT_GLYPH[trump]} ${trumpName}</b></span>
      <span>Cards <b>${round ? round.cards : "?"}</b></span>
      <span>Table <b>${esc(room.code)}</b></span>
    </div>

    <div class="field">
      <label>${room.phase === "bidding"
        ? (myTurn ? "Your call" : `Waiting for ${esc(onTurn ? onTurn.name : "…")} to bid`)
        : "Bidding is done"}</label>
      <div class="names">${seatRows}</div>
    </div>

    ${bidBar}

    <div class="field">
      <label>Your hand — ${hand.length} card${hand.length === 1 ? "" : "s"}</label>
      <div class="hand">${cards || '<span class="hint">nothing dealt yet</span>'}</div>
      <span class="hint">Only you can see these. Trump is ${SUIT_GLYPH[trump]} ${trumpName}.</span>
    </div>

    ${room.phase === "playing" ? '<div class="hint">Everyone has bid — trick play arrives in the next phase.</div>' : ""}
    <div class="err" id="lobbyErr"></div>
    <div class="hint" id="lobbyStatus"></div>`;

  $("lobbyBody").querySelectorAll("button[data-bid]").forEach(b => {
    b.onclick = () => onBid(Number(b.dataset.bid));
  });
}
