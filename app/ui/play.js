/* The online table: the trick in progress, your hand, the bidding, the standings.
   Rendering only — every decision shown here is the server's. The same
   shared/rules.js checks that grey out an illegal move are enforced again in SQL. */
import { $ } from "../dom.js";
import {
  colorFor, TRUMPS, trumpOf, suitOf, bidError, lastBidder, sortHand, legalPlays, fmt
} from "../../shared/rules.js";

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const GLYPH = { S:"♠", H:"♥", D:"♦", C:"♣" };
const isRed = s => s === "H" || s === "D";

const cardHtml = (c, { trump, extra = "", attrs = "" }) =>
  `<span class="card${isRed(suitOf(c)) ? " red" : ""}${suitOf(c) === trump ? " trump" : ""}${extra}" ${attrs}>
     <b>${c[0] === "T" ? "10" : c[0]}</b><i>${GLYPH[suitOf(c)]}</i></span>`;

export function renderPlay(state, meId, { onBid, onPlay, onLeave, onRestart }, mountId = "lobbyBody") {
  const { room, seats, round, bids, hand, trickPlays = [], tricks = [], results = [] } = state;
  const plays = trickPlays;   // only the trick on the table
  const me = seats.find(s => s.player_id === meId);
  const n = seats.length;
  const trump = round ? round.trump : trumpOf(room.round);
  const trumpName = (TRUMPS.find(t => t[3] === trump) || TRUMPS[0])[1];
  const bidBy = Object.fromEntries(bids.map(b => [b.seat, b.bid]));
  const wonBy = tricks.reduce((a, t) => (a[t.winner_seat] = (a[t.winner_seat] || 0) + 1, a), {});
  const totals = results.reduce((a, r) => (a[r.seat] = (a[r.seat] || 0) + r.points, a), {});
  const over = room.phase === "game_over";
  const bidding = room.phase === "bidding";
  const myTurn = Boolean(me) && room.turn_seat === me.seat && !over;
  const onTurn = seats.find(s => s.seat === room.turn_seat);
  const isHost = Boolean(me) && room.host_id === me.player_id;
  const hostSeat = seats.find(s => s.player_id === room.host_id);
  const hostName = hostSeat ? hostSeat.name : "the host";

  /* what was led, and therefore which of my cards are legal right now */
  const ledSuit = plays.length ? suitOf(plays[0].card) : null;
  const playable = new Set(myTurn && !bidding ? legalPlays(hand, ledSuit) : []);

  const seatRows = seats.map(s => {
    const turn = s.seat === room.turn_seat && !over;
    const bid = bidBy[s.seat];
    const won = wonBy[s.seat] || 0;
    const tot = totals[s.seat];
    return `<div class="nm" data-seat="${s.seat}" style="${turn ? "outline:2px solid var(--gold)" : ""}">
      <i style="background:${colorFor(s.name, s.seat)}"></i>
      <input type="text" readonly style="cursor:default${s.connected ? "" : ";opacity:.45"}"
             value="${esc(s.name)}${s.player_id === meId ? " (you)" : ""}">
      <span class="tally" title="tricks won of tricks bid">${bid === undefined ? (turn && bidding ? "…" : "–") : `${won} of ${bid}`}</span>
      <span class="tally total" title="score for the game so far">${tot === undefined ? "" : fmt(tot)}</span>
    </div>`;
  }).join("");

  let action = "";
  if (over) {
    const rank = seats.map(s => ({ ...s, tot: totals[s.seat] || 0 }))
      .sort((a, b) => b.tot - a.tot || a.seat - b.seat);
    action = `<div class="field f-action"><label>Final</label>
      <div class="plan" style="display:block;line-height:2">${rank.map((p, i) =>
        `<div><b>${i === 0 ? "👑" : i === rank.length - 1 ? "🩴" : `${i + 1}.`}</b>
          ${esc(p.name)} <b>${fmt(p.tot)}</b></div>`).join("")}</div></div>`;
  } else if (bidding && myTurn && round) {
    const others = Object.fromEntries(seats.filter(s => s.seat !== me.seat).map(s => [s.seat, bidBy[s.seat] ?? null]));
    const isLast = me.seat === lastBidder(room.round, n);
    action = `<div class="field f-action"><label>Your bid — how many tricks will you take?</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${
        Array.from({ length: round.cards + 1 }, (_, b) => {
          const err = bidError({ cards: round.cards, bid: b, isLastBidder: isLast, otherBids: others });
          return `<button class="bidbtn" data-bid="${b}" ${err ? `disabled title="${esc(err)}"` : ""}>${b}</button>`;
        }).join("")}</div>
      <span class="hint">${isLast ? `You bid last, so the total may not come to exactly ${round.cards}.` : ""}</span>
    </div>`;
  }

  const trickHtml = plays.length
    ? plays.map(p => {
        const s = seats.find(x => x.seat === p.seat);
        return `<div class="trickcard">${cardHtml(p.card, { trump })}
          <span class="who" style="color:${colorFor(s ? s.name : "", p.seat)}">${esc(s ? s.name : "?")}</span></div>`;
      }).join("")
    : `<span class="hint">${bidding ? "bidding first" : "no cards played yet"}</span>`;

  const handHtml = sortHand(hand, trump).map(c => {
    const can = playable.has(c);
    return cardHtml(c, {
      trump,
      extra: myTurn && !bidding ? (can ? " playable" : " muted") : "",
      attrs: can ? `data-card="${c}" role="button" tabindex="0"` : "",
    });
  }).join("");

  $(mountId).innerHTML = `
    <div class="f-head" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px">
      <span class="trumpcall ${isRed(trump) ? "red" : "blk"}">
        <span class="pip">${GLYPH[trump]}</span>
        <span><small>trump</small><br><b>${trumpName}</b></span>
      </span>
      <div class="plan" style="margin:0">
        <span>Round <b>${room.round + 1} of ${state.rounds.length}</b></span>
        <span>Cards <b>${round ? round.cards : "?"}</b></span>
        ${over ? "" : `<span>Trick <b>${room.trick_no + 1}</b></span>`}
        <span>Table <b>${esc(room.code)}</b></span>
      </div>
    </div>

    <div class="field f-seats">
      <label>${over ? "Game over"
        : myTurn ? (bidding ? "Your call" : "Your turn — play a card")
        : `Waiting for ${esc(onTurn ? onTurn.name : "…")}`}<span id="clock" class="clock"></span></label>
      <div class="names">${seatRows}</div>
      <span class="hint">Each row: tricks won so far out of the tricks bid, then that player's score for the game.</span>
    </div>

    ${over ? "" : `<div class="field f-trick"><label>On the table</label>
      <div class="trick">${trickHtml}</div>
      ${ledSuit ? `<span class="hint">${GLYPH[ledSuit]} was led — follow it if you can.</span>` : ""}
    </div>`}

    ${action}

    ${over ? "" : `<div class="field f-hand">
      <label>Your hand — ${hand.length} card${hand.length === 1 ? "" : "s"}</label>
      <div class="hand${hand.length >= 8 ? " big" : ""}">${handHtml || '<span class="hint">nothing left</span>'}</div>
      <span class="hint">Only you can see these. Trump is ${GLYPH[trump]} ${trumpName} — those cards are marked.</span>
    </div>`}

    <div class="actions" style="margin-top:20px;padding-top:16px;border-top:1px solid var(--card-shade)">
      ${over && isHost ? `<button class="panelbtn gold" id="btnAgain">Play again with these players</button>` : ""}
      <button class="panelbtn danger" id="btnLeaveGame">${over ? "Leave table" : "Leave this table"}</button>
      ${over && !isHost ? `<span class="hint" style="align-self:center">Only ${esc(hostName)} can start another game.</span>` : ""}
      ${!over ? `<span class="hint" style="align-self:center">Your seat is kept — you can rejoin with the code.</span>` : ""}
    </div>

    <div class="err" id="lobbyErr"></div>
    <div class="hint" id="lobbyStatus"></div>`;

  $(mountId).querySelectorAll("button[data-bid]").forEach(b => {
    b.onclick = () => onBid(Number(b.dataset.bid));
  });
  const again = document.getElementById("btnAgain");
  if (again && onRestart) again.onclick = onRestart;
  const leave = document.getElementById("btnLeaveGame");
  if (leave && onLeave) leave.onclick = onLeave;

  $(mountId).querySelectorAll("[data-card]").forEach(el => {
    el.onclick = () => onPlay(el.dataset.card);
    el.onkeydown = e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPlay(el.dataset.card); }
    };
  });
}
