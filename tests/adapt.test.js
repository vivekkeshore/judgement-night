import test from "node:test";
import assert from "node:assert/strict";
import { snapshotToG, fallenSeatFrom } from "../app/modes/adapt.js";
import { totals, ordered, lastCompleteRound, NAVY } from "../shared/rules.js";

/* A three-player table, two rounds scored and a third under way. The results
   rows are what the server actually computed, so they are the yardstick: the
   adapter is only correct if the UI's own totals() agrees with them. */
const snap = {
  seats: [
    { seat: 0, name: "Nivesh", player_id: "p0" },
    { seat: 1, name: "Vivek",  player_id: "p1" },
    { seat: 2, name: "Shruti", player_id: "p2" },
  ],
  rounds: [
    { round: 0, cards: 3, trump: "H" },
    { round: 1, cards: 2, trump: "S" },
    { round: 2, cards: 1, trump: "D" },
  ],
  allBids: [
    { round: 0, seat: 0, bid: 2 }, { round: 0, seat: 1, bid: 1 }, { round: 0, seat: 2, bid: 1 },
    { round: 1, seat: 0, bid: 0 }, { round: 1, seat: 1, bid: 1 }, { round: 1, seat: 2, bid: 0 },
    { round: 2, seat: 0, bid: 1 },                       // round 2 still being bid
  ],
  results: [
    // round 0: Nivesh made 2, Vivek made 1, Shruti missed with 0
    { round: 0, seat: 0, tricks_won: 2, points: 12 },
    { round: 0, seat: 1, tricks_won: 1, points: 11 },
    { round: 0, seat: 2, tricks_won: 0, points: -11 },
    // round 1: Nivesh made 0, Vivek missed with 2, Shruti made 0
    { round: 1, seat: 0, tricks_won: 0, points: 10 },
    { round: 1, seat: 1, tricks_won: 2, points: -11 },
    { round: 1, seat: 2, tricks_won: 0, points: 10 },
  ],
  events: [],
};

test("the adapted state reproduces the server's own points exactly", () => {
  const g = snapshotToG(snap);
  const fromServer = [0, 1, 2].map(seat =>
    snap.results.filter(r => r.seat === seat).reduce((a, r) => a + r.points, 0));
  assert.deepEqual(totals(g), fromServer, "UI totals must match what the server scored");
  assert.deepEqual(totals(g), [22, 0, -1]);
});

test("only scored rounds are marked done, so an in-progress round moves nothing", () => {
  const g = snapshotToG(snap);
  assert.deepEqual(g.done, [true, true, false]);
  assert.equal(lastCompleteRound(g), 2);
  // round 2 has a bid recorded but no result, and must not affect any total
  assert.equal(g.bids[2][0], 1);
  assert.equal(g.res[2][0], null);
});

test("the round schedule and seating come across intact", () => {
  const g = snapshotToG(snap);
  assert.deepEqual(g.cards, [3, 2, 1]);
  assert.deepEqual(g.players.map(p => p.n), ["Nivesh", "Vivek", "Shruti"]);
  assert.equal(g.players[1].c, NAVY, "Vivek is navy, as everywhere else");
  assert.equal(g.players[1].navy, true);
  assert.equal(g.players[0].navy, false);
});

test("standings order matches the server's points", () => {
  assert.deepEqual(ordered(snapshotToG(snap)).map(p => p.n), ["Nivesh", "Vivek", "Shruti"]);
});

test("an empty table adapts without throwing", () => {
  const g = snapshotToG({ seats: [], rounds: [], allBids: [], results: [], events: [] });
  assert.deepEqual(g.players, []);
  assert.deepEqual(totals(g), []);
});

test("missing allBids or results are tolerated", () => {
  const g = snapshotToG({ seats: snap.seats, rounds: snap.rounds });
  assert.deepEqual(g.done, [false, false, false]);
  assert.deepEqual(totals(g), [0, 0, 0]);
});

/* the dethroned king comes from the server's history, not local memory */

test("fallenSeatFrom takes the most recent lead change", () => {
  const events = [
    { kind: "round_scored", payload: { round: 0 } },
    { kind: "lead_change",  payload: { from: null, to: 0, round: 0 } },
    { kind: "round_scored", payload: { round: 1 } },
    { kind: "lead_change",  payload: { from: 0, to: 2, round: 1 } },
  ];
  assert.equal(fallenSeatFrom(events), 0, "seat 0 was just dethroned by seat 2");
});

test("the first leader dethrones nobody", () => {
  assert.equal(fallenSeatFrom([{ kind: "lead_change", payload: { from: null, to: 1 } }]), null);
});

test("no lead changes yet means no fallen king", () => {
  assert.equal(fallenSeatFrom([{ kind: "round_scored", payload: {} }]), null);
  assert.equal(fallenSeatFrom([]), null);
  assert.equal(fallenSeatFrom(undefined), null);
});
