import test from "node:test";
import assert from "node:assert/strict";
import { completedTrick, freshDeal } from "../app/ui/animations.js";

/* Deciding *when* to animate is the fiddly part, because by the time the client
   hears about a finished trick the server has already moved on to the next one.
   These cases pin down that detection; the animation itself is CSS. */

const seats = [{ seat: 0 }, { seat: 1 }, { seat: 2 }];
const round = { round: 0, cards: 3, trump: "H" };
const TRICK = t => [
  { round: 0, trick_no: t, seat: 0, card: "5H" },
  { round: 0, trick_no: t, seat: 1, card: "KH" },
  { round: 0, trick_no: t, seat: 2, card: "2S" },
];
/* the state the client held while the trick was still being played */
const during = (trickNo, cards = 2) => ({
  seats, round,
  room: { round: 0, trick_no: trickNo, phase: "playing", status: "playing" },
  plays: TRICK(trickNo).slice(0, cards),
});
/* the state that arrives once the server has closed the trick: it carries the
   whole round's plays, including the card that finished it */
const after = (trickNo, extra = {}) => ({
  seats, round,
  room: { round: 0, trick_no: trickNo, phase: "playing", status: "playing", ...extra },
  plays: TRICK(trickNo - 1),
});

test("the finished trick is taken from the new snapshot, not the old one", () => {
  // the client only ever saw two cards; the third arrived with the advance
  const got = completedTrick(during(0, 2), after(1));
  assert.ok(got, "the trick completed even though the old snapshot was short a card");
  assert.equal(got.plays.length, 3, "all three cards, including the winning one");
  assert.equal(got.winner, 1, "the king of trumps took it");
});

test("the last trick of a round counts, even though the round has moved on", () => {
  const next = { seats, round, plays: TRICK(2),
    room: { round: 1, trick_no: 0, phase: "bidding", status: "playing" } };
  const got = completedTrick(during(2, 2), next);
  assert.ok(got, "a round rollover must still show who took the final trick");
  assert.equal(got.winner, 1);
});

test("a trick that has not actually closed is not animated", () => {
  // trick_no advanced but the new snapshot is missing a card: refuse
  const short = { seats, round, plays: TRICK(0).slice(0, 2),
    room: { round: 0, trick_no: 1, phase: "playing", status: "playing" } };
  assert.equal(completedTrick(during(0, 2), short), null);
});

test("nothing moving means nothing to animate", () => {
  assert.equal(completedTrick(during(0, 2), during(0, 2)), null);
  assert.equal(completedTrick(during(0, 3), during(0, 3)), null);
});

test("no previous snapshot means no trick to replay", () => {
  assert.equal(completedTrick(null, after(1)), null);
  assert.equal(completedTrick(undefined, after(1)), null);
});

test("bidding is not trick play", () => {
  const bidding = { seats, round, plays: [],
    room: { round: 0, trick_no: 0, phase: "bidding", status: "playing" } };
  assert.equal(completedTrick(bidding, after(1)), null);
});

test("freshDeal fires on a new round and on the first deal", () => {
  const r0 = { room: { round: 0, status: "playing" } };
  const r1 = { room: { round: 1, status: "playing" } };
  assert.equal(freshDeal(r0, r1), true);
  assert.equal(freshDeal({ room: { round: 0, status: "lobby" } }, r0), true);
  assert.equal(freshDeal(null, r0), true, "joining straight into a fresh game");
});

test("freshDeal does not fire on ordinary play within a round", () => {
  const a = { room: { round: 2, status: "playing" } };
  const b = { room: { round: 2, status: "playing" } };
  assert.equal(freshDeal(a, b), false);
  assert.equal(freshDeal(null, { room: { round: 3, status: "playing" } }), false,
    "joining mid-game should not replay a shuffle");
});
