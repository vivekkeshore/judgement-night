/* Table animations. Both are deliberately slow — this is a game night, not a
   speed run — and both are driven from snapshots the server already sent.

   The trick animation has a timing wrinkle worth knowing about: the moment the
   last card lands, the server advances trick_no, so the very next snapshot has
   an empty table and the winning cards are already gone. So we hold on to the
   previous snapshot's plays and work out the winner locally with trickWinner()
   — the same function the SQL mirrors — rather than waiting for a tricks row
   that may belong to the next round by the time it arrives. */
import { $ } from "../dom.js";
import { trickWinner } from "../../shared/rules.js";

export const SHUFFLE_MS = 2600;
export const TRICK_MS   = 2000;
export const DECLARE_MS = 2800;

const wait = ms => new Promise(r => setTimeout(r, ms));

/* Did a full trick just finish? Returns its cards and winner, or null.

   The finished trick's cards are read from the NEW snapshot, not the old one:
   the server completes a trick and advances trick_no in the same transaction,
   so the last card only ever arrives alongside the advance. The old snapshot
   has one card too few. */
export function completedTrick(prev, next) {
  if (!prev || !prev.round || prev.room.phase !== "playing") return null;

  const sameRound = next.room.round === prev.room.round;
  const advanced  = sameRound && next.room.trick_no > prev.room.trick_no;
  const rolledOver = next.room.round > prev.room.round;
  if (!advanced && !rolledOver) return null;

  const plays = (next.plays || []).filter(
    p => p.round === prev.room.round && p.trick_no === prev.room.trick_no);
  if (plays.length !== prev.seats.length) return null;   // not actually complete

  return { plays, winner: trickWinner(plays, prev.round.trump) };
}

/* Was a fresh round just dealt? */
export function freshDeal(prev, next) {
  if (!prev) return next.room.status === "playing" && next.room.round === 0;
  return next.room.round !== prev.room.round
      || (prev.room.status === "lobby" && next.room.status === "playing");
}

/* The winner sweeps the cards up. Each card is measured against the winner's
   seat row so it actually travels towards them rather than in a generic
   direction. */
export async function sweepTrick(winnerSeat, winnerName) {
  const cards = [...document.querySelectorAll("#playpanel .trickcard")];
  if (!cards.length) return;

  const target = document.querySelector(`#playpanel .nm[data-seat="${winnerSeat}"]`);
  const to = target ? target.getBoundingClientRect() : null;

  for (const el of cards) {
    const from = el.getBoundingClientRect();
    const dx = to ? (to.left + to.width / 2) - (from.left + from.width / 2) : 0;
    const dy = to ? (to.top + to.height / 2) - (from.top + from.height / 2) : -140;
    el.style.setProperty("--tx", `${Math.round(dx)}px`);
    el.style.setProperty("--ty", `${Math.round(dy)}px`);
    el.style.setProperty("--tr", `${Math.round(-14 + Math.random() * 28)}deg`);
  }

  const banner = document.createElement("div");
  banner.className = "winbanner";
  banner.textContent = `${winnerName} takes the trick`;
  document.querySelector("#playpanel .trick")?.appendChild(banner);
  if (target) target.classList.add("tookit");

  requestAnimationFrame(() => cards.forEach(el => el.classList.add("taking")));
  await wait(TRICK_MS);
}

/* A deck riffles and deals itself out before the new hand appears. Shared: a
   shuffle is a shuffle, whichever game is about to be dealt. */
export async function shuffleCurtain(mountId, roundNo, cardCount) {
  const host = $(mountId);
  if (!host) return;
  const backs = Array.from({ length: 7 }, (_, i) =>
    `<div class="back" style="--i:${i};--dx:${-150 + i * 50}px;--dy:${-40 - (i % 3) * 24}px;--dr:${-20 + i * 6}deg"></div>`
  ).join("");
  host.innerHTML = `
    <div class="shuffle">
      <div class="deck">${backs}</div>
      <p class="shuffletext">Shuffling…<br><small>round ${roundNo} · ${cardCount} card${cardCount === 1 ? "" : "s"} each</small></p>
    </div>`;
  await wait(SHUFFLE_MS);
}

/* ------------------------------------------------------------- declare ----
   Declare has no tricks to sweep, and the one moment worth stopping for is
   somebody calling the round. */

/* Did somebody just declare? Read off the events log rather than off the
   results, because the payload says who called it and how it went — and because
   the events log is the same shared history that decides the dethroned king, so
   every browser sees the same declaration whatever order its updates arrived
   in. Returns null on the first snapshot, when everything is "new". */
export function newDeclaration(prev, next) {
  if (!prev) return null;
  const seen = (prev.events || []).reduce((m, e) => Math.max(m, e.id || 0), 0);
  const e = (next.events || [])
    .filter(x => x.kind === "round_scored" && (x.id || 0) > seen && x.payload
                 && x.payload.declarer !== undefined)
    .pop();
  if (!e) return null;
  return {
    seat: e.payload.declarer,
    count: e.payload.count ?? 0,
    lower: e.payload.lower ?? 0,
    round: e.payload.round,
  };
}

/* Hold the table for a beat on the result. Whether the call came off is the
   whole drama of the round, so it says which, rather than just who. */
export async function declareReveal(mountId, { name, count, lower }) {
  const host = $(mountId);
  if (!host) return;
  const ok = lower === 0;
  const banner = document.createElement("div");
  banner.className = `declareflash ${ok ? "good" : "bad"}`;
  banner.innerHTML = `<b>${name} declares at ${count}</b><span>${ok
    ? "nobody was lower — that round costs them nothing"
    : `caught: ${lower} player${lower === 1 ? " was" : "s were"} lower, ${20 * lower} + ${count} = ${20 * lower + count}`}</span>`;
  host.appendChild(banner);
  requestAnimationFrame(() => banner.classList.add("on"));
  await wait(DECLARE_MS);
}
