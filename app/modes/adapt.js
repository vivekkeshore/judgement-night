/* Turn a server snapshot into the state shape the manual-mode UI already speaks.
   This is what lets online play reuse the strip, the apsara, the leaderboard
   portraits and the chart unchanged, rather than growing a second copy of each.

   The mapping is exact rather than approximate: the server scores a round with
   (10 + bid) for hitting it and -(10 + bid) otherwise, which is precisely what
   pts() computes from a bid and a hit/miss flag. So recording res as "did the
   tricks won equal the bid" reproduces the server's own points. */
import { colorFor, NAVY } from "../../shared/rules.js";

export function snapshotToG(snap) {
  const players = snap.seats.map(s => {
    const c = colorFor(s.name, s.seat);
    return { n: s.name, c, navy: c === NAVY };
  });
  const cards = snap.rounds.map(r => r.cards);

  const bids = cards.map(() => players.map(() => null));
  const res  = cards.map(() => players.map(() => null));
  const done = cards.map(() => false);

  for (const b of snap.allBids || []) {
    if (bids[b.round]) bids[b.round][b.seat] = b.bid;
  }
  /* A results row exists only once a round has been scored, and score_round
     writes every seat at once — so a single row is enough to mark it done. */
  for (const r of snap.results || []) {
    if (!res[r.round]) continue;
    res[r.round][r.seat] = r.tricks_won === bids[r.round][r.seat] ? 1 : 0;
    done[r.round] = true;
  }

  return { players, cards, bids, res, done };
}

/* Who was dethroned, according to the server rather than to this browser's own
   memory. The apsara leaving a seat is a local observation — two clients that
   received different batches of updates would disagree — whereas the
   lead_change events are one shared history every screen can read. */
export function fallenSeatFrom(events) {
  for (let i = (events || []).length - 1; i >= 0; i--) {
    if (events[i].kind === "lead_change") {
      const from = events[i].payload?.from;
      return from === undefined ? null : from;   // null on the very first leader
    }
  }
  return null;
}
