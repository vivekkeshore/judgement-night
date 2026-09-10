import test from "node:test";
import assert from "node:assert/strict";
import { declareSnapshotToG, snapshotToG, fallenSeatFrom } from "../app/modes/adapt.js";
import { newDeclaration } from "../app/ui/animations.js";
import { totals, cum, ordered, roundDelta, gameOf, fmtFor, lastCompleteRound, doneCount, NAVY }
  from "../shared/rules.js";

/* A three-player Declare table. Round 0: Vivek declared at 8 with Nivesh on 5
   and Shruti on 6 — the user's own worked example, so these points are the
   yardstick. Round 1: Nivesh declared at 4 and got away with it. */
const snap = {
  room: { code: "ABCD", round: 2, phase: "draw" },
  seats: [
    { seat: 0, name: "Nivesh", player_id: "p0" },
    { seat: 1, name: "Vivek",  player_id: "p1" },
    { seat: 2, name: "Shruti", player_id: "p2" },
  ],
  rounds: [
    { round: 0, cards: 5, trump: null },
    { round: 1, cards: 5, trump: null },
    { round: 2, cards: 5, trump: null },
  ],
  results: [
    { round: 0, seat: 0, hand_count: 5,  points: 0,  declared: false },
    { round: 0, seat: 1, hand_count: 8,  points: 48, declared: true  },
    { round: 0, seat: 2, hand_count: 6,  points: 0,  declared: false },
    { round: 1, seat: 0, hand_count: 4,  points: 0,  declared: true  },
    { round: 1, seat: 1, hand_count: 19, points: 19, declared: false },
    { round: 1, seat: 2, hand_count: 11, points: 11, declared: false },
  ],
  events: [],
};

test("the adapted state reproduces the server's own points exactly", () => {
  const g = declareSnapshotToG(snap);
  const fromServer = [0, 1, 2].map(seat =>
    snap.results.filter(r => r.seat === seat).reduce((a, r) => a + r.points, 0));
  assert.deepEqual(totals(g), fromServer);
  assert.deepEqual(totals(g), [0, 67, 11]);
});

test("declare state declares itself as declare, and so ranks the other way up", () => {
  const g = declareSnapshotToG(snap);
  assert.equal(g.game, "declare");
  assert.equal(gameOf(g).lowestWins, true);
  assert.deepEqual(ordered(g).map(p => p.n), ["Nivesh", "Shruti", "Vivek"],
    "Vivek's 67 is the worst night, not the best");
});

test("the same totals in a judgement game rank the opposite way", () => {
  const g = { ...declareSnapshotToG(snap), game: "judgement" };
  assert.deepEqual(ordered(g).map(p => p.n), ["Vivek", "Shruti", "Nivesh"]);
});

test("only scored rounds count, so the round in progress moves nothing", () => {
  const g = declareSnapshotToG(snap);
  assert.deepEqual(g.done, [true, true, false]);
  assert.equal(lastCompleteRound(g), 2);
  assert.equal(doneCount(g), 2);
});

test("the running total climbs round by round", () => {
  const g = declareSnapshotToG(snap);
  assert.deepEqual(cum(g, 1), [0, 48, 67, 67], "Vivek: start, after the 48, after 19, unfinished round");
  assert.deepEqual(cum(g, 0), [0, 0, 0, 0]);
});

test("seating and colours come across exactly as in judgement", () => {
  const g = declareSnapshotToG(snap);
  assert.deepEqual(g.players.map(p => p.n), ["Nivesh", "Vivek", "Shruti"]);
  assert.equal(g.players[1].c, NAVY, "Vivek is navy here too");
  assert.equal(g.players[1].navy, true);
  assert.deepEqual(g.cards, [5, 5, 5]);
});

test("an empty declare table adapts without throwing", () => {
  const g = declareSnapshotToG({ seats: [], rounds: [], results: [], events: [] });
  assert.deepEqual(g.players, []);
  assert.deepEqual(totals(g), []);
  assert.deepEqual(ordered(g), []);
});

test("missing results are tolerated", () => {
  const g = declareSnapshotToG({ seats: snap.seats, rounds: snap.rounds });
  assert.deepEqual(g.done, [false, false, false]);
  assert.deepEqual(totals(g), [0, 0, 0]);
});

/* ---------------------------------------------------------------- shared ---- */

test("G.points wins over bids when both somehow exist", () => {
  const g = {
    players: [{ n: "a" }], cards: [3], done: [true],
    bids: [[2]], res: [[1]],          // would derive 12
    points: [[99]],
  };
  assert.equal(roundDelta(g, 0, 0), 99, "the server's own arithmetic, not a reconstruction of it");
  assert.deepEqual(totals(g), [99]);
});

test("judgement state without G.points still scores off the bid", () => {
  const g = { players: [{ n: "a" }], cards: [3], done: [true], bids: [[2]], res: [[1]] };
  assert.deepEqual(totals(g), [12]);
});

test("penalties are shown unsigned, winnings are signed", () => {
  assert.equal(fmtFor({ game: "declare" }, 48), "48");
  assert.equal(fmtFor({ game: "judgement" }, 48), "+48");
  assert.equal(fmtFor(null, 48), "+48", "no game named means judgement, as every old save is");
  assert.equal(fmtFor({ game: "declare" }, 0), "0");
});

test("an unknown game name falls back to judgement rather than throwing", () => {
  assert.equal(gameOf({ game: "bridge" }).id, "judgement");
  assert.equal(gameOf(undefined).id, "judgement");
});

/* ---------------------------------------------------- declaration events ---- */

test("a new round_scored event is a fresh declaration", () => {
  const prev = { events: [{ id: 4, kind: "round_scored", payload: { round: 0, declarer: 1, count: 8, lower: 2 } }] };
  const next = { events: [
    ...prev.events,
    { id: 5, kind: "lead_change",  payload: { from: 1, to: 0 } },
    { id: 6, kind: "round_scored", payload: { round: 1, declarer: 0, count: 4, lower: 0 } },
  ] };
  assert.deepEqual(newDeclaration(prev, next), { seat: 0, count: 4, lower: 0, round: 1 });
});

test("a declaration already seen does not replay", () => {
  const events = [{ id: 6, kind: "round_scored", payload: { round: 1, declarer: 0, count: 4, lower: 0 } }];
  assert.equal(newDeclaration({ events }, { events }), null);
});

test("the very first snapshot reveals nothing, however much history it carries", () => {
  assert.equal(newDeclaration(null, { events: [{ id: 6, kind: "round_scored", payload: { declarer: 0 } }] }), null);
});

test("judgement's own round_scored events are not mistaken for declarations", () => {
  const prev = { events: [] };
  const next = { events: [{ id: 1, kind: "round_scored", payload: { round: 0 } }] };
  assert.equal(newDeclaration(prev, next), null, "no declarer in the payload, so nobody declared");
});

test("the dethroned king reads the same events in both games", () => {
  assert.equal(fallenSeatFrom([
    { kind: "round_scored", payload: { round: 0, declarer: 1 } },
    { kind: "lead_change",  payload: { from: 1, to: 0, round: 0 } },
  ]), 1);
});

/* Judgement's adapter must be untouched by any of this. */
test("the judgement adapter still produces a judgement state", () => {
  const g = snapshotToG({ seats: snap.seats, rounds: [{ round: 0, cards: 3, trump: "H" }],
                          allBids: [{ round: 0, seat: 0, bid: 2 }],
                          results: [{ round: 0, seat: 0, tricks_won: 2, points: 12 }] });
  assert.equal(gameOf(g).lowestWins, false);
  assert.equal(g.points, undefined, "judgement derives its points and must keep doing so");
  assert.equal(totals(g)[0], 12);
});
