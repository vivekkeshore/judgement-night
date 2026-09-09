import test from "node:test";
import assert from "node:assert/strict";
import { completedTrick, freshDeal } from "../app/ui/animations.js";

/* Deciding *when* to animate is the fiddly part, because by the time the client
   hears about a finished trick the server has already moved on to the next one.
   These cases pin down that detection; the animation itself is CSS. */

const seats = [{ seat: 0 }, { seat: 1 }, { seat: 2 }];
const round = { round: 0, cards: 3, trump: "H" };
const at = (over, extra = {}) => ({
  seats, round,
  room: { round: 0, trick_no: over, phase: "playing", status: "playing", ...extra },
  plays: [],
});
const full = trickNo => ({
  seats, round,
  room: { round: 0, trick_no: trickNo, phase: "playing", status: "playing" },
  plays: [{ seat: 0, card: "5H" }, { seat: 1, card: "KH" }, { seat: 2, card: "2S" }],
});

test("a full trick followed by the next trick is a completed trick", () => {
  const got = completedTrick(full(0), at(1));
  assert.ok(got);
  assert.equal(got.winner, 1, "the king of trumps took it");
  assert.equal(got.plays.length, 3);
});

test("the last trick of a round counts, even though the round has moved on", () => {
  // the server deals the next round in the same step, so trick_no resets to 0
  const next = { seats, round, room: { round: 1, trick_no: 0, phase: "bidding", status: "playing" }, plays: [] };
  const got = completedTrick(full(2), next);
  assert.ok(got, "a round rollover must still show who took the final trick");
  assert.equal(got.winner, 1);
});

test("a part-played trick is not a completed trick", () => {
  const half = { seats, round, room: { round: 0, trick_no: 0, phase: "playing", status: "playing" },
                 plays: [{ seat: 0, card: "5H" }] };
  assert.equal(completedTrick(half, at(0)), null);
});

test("nothing moving means nothing to animate", () => {
  assert.equal(completedTrick(full(0), full(0)), null);
});

test("no previous snapshot means no trick to replay", () => {
  assert.equal(completedTrick(null, at(1)), null);
  assert.equal(completedTrick(undefined, at(1)), null);
});

test("bidding is not trick play", () => {
  const bidding = { seats, round, plays: [],
    room: { round: 0, trick_no: 0, phase: "bidding", status: "playing" } };
  assert.equal(completedTrick(bidding, at(0)), null);
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
