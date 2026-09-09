import test from "node:test";
import assert from "node:assert/strict";
import {
  PAL, NAVY, TRUMPS, colorFor, pts, fmt, cardsPerRound,
  totals, cum, currentRound, lastCompleteRound, doneCount, ordered
} from "../shared/rules.js";

/* A four-player fixture. Rounds 0 and 1 are scored; round 2 has bids but is NOT
   flagged done, which is the distinction the whole scoring model rests on. */
const G = {
  players: [{n:"Ana"},{n:"Bo"},{n:"Cy"},{n:"Vivek"}],
  cards: [3, 2, 1],
  bids:  [[1,2,0,1], [0,1,1,0], [1,1,1,0]],
  res:   [[1,1,0,1], [1,0,1,1], [1,1,1,1]],
  done:  [true, true, false],
};

test("pts: a made contract banks 10 + bid, a missed one costs the same", () => {
  assert.equal(pts(0, true), 10);
  assert.equal(pts(3, true), 13);
  assert.equal(pts(0, false), -10);
  assert.equal(pts(3, false), -13);
});

test("cardsPerRound counts down to one and back up", () => {
  assert.deepEqual(cardsPerRound(3), [3,2,1,1,2,3]);
  assert.deepEqual(cardsPerRound(1), [1,1]);
  // the deck limits the opening hand: 8 players can only be dealt 6 each
  assert.equal(cardsPerRound(6).length, 12);
});

test("totals count only rounds flagged done", () => {
  // round 0: +11, +12, -10, +11   round 1: +10, -11, +11, +10
  // round 2 is unscored and must contribute nothing
  assert.deepEqual(totals(G), [21, 1, 1, 21]);
});

test("an unscored round moves no total even when every bid is in", () => {
  const scored = { ...G, done: [true, true, true] };
  assert.notDeepEqual(totals(scored), totals(G));
  assert.deepEqual(totals(G), [21, 1, 1, 21]);
});

test("res treats null as correct, only 0 is a miss", () => {
  const g = { players:[{n:"A"}], cards:[1], bids:[[2]], res:[[null]], done:[true] };
  assert.deepEqual(totals(g), [12]);
  assert.deepEqual(totals({ ...g, res:[[0]] }), [-12]);
});

test("cum is a running total with a leading zero, one entry per round", () => {
  const c = cum(G, 0);
  assert.equal(c.length, G.cards.length + 1);
  assert.equal(c[0], 0);
  assert.deepEqual(c, [0, 11, 21, 21]); // round 2 unscored, so it flatlines
});

test("currentRound is the first unscored round, -1 when the game is over", () => {
  assert.equal(currentRound(G), 2);
  assert.equal(currentRound({ ...G, done:[true,true,true] }), -1);
  assert.equal(currentRound({ ...G, done:[false,false,false] }), 0);
});

test("lastCompleteRound is the contiguous prefix, not the count", () => {
  assert.equal(lastCompleteRound(G), 2);
  // a gap stops the prefix even though two rounds are scored
  assert.equal(lastCompleteRound({ ...G, done:[true,false,true] }), 1);
  assert.equal(doneCount({ ...G, done:[true,false,true] }), 2);
});

test("ordered ranks by total, breaking ties by seat order", () => {
  const o = ordered(G);
  assert.deepEqual(o.map(p => p.n), ["Ana","Vivek","Bo","Cy"]);
  assert.deepEqual(o.map(p => p.i), [0, 3, 1, 2]);
  assert.equal(o[0].tot, 21);
});

test("colorFor gives Vivek navy and everyone else a palette colour", () => {
  assert.equal(colorFor("Vivek", 0), NAVY);
  assert.equal(colorFor("  vivek ", 3), NAVY);
  // \b needs a boundary after "vivek", so longer names starting with it are not caught
  assert.equal(colorFor("Vivekananda", 0), PAL[0]);
  assert.equal(colorFor("Ana", 0), PAL[0]);
  assert.equal(colorFor("Ana", PAL.length), PAL[0]); // wraps
});

test("fmt signs positives and leaves negatives alone", () => {
  assert.equal(fmt(5), "+5");
  assert.equal(fmt(0), "0");
  assert.equal(fmt(-5), "-5");
});

test("trump rotates hearts, spades, diamonds, clubs by round", () => {
  assert.deepEqual([0,1,2,3,4].map(r => TRUMPS[r % 4][1]),
    ["Hearts","Spades","Diamonds","Clubs","Hearts"]);
});
