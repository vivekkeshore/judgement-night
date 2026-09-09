import test from "node:test";
import assert from "node:assert/strict";
import { legalPlays, trickWinner, roundPoints, suitOf } from "../shared/rules.js";

/* These cases are the reference for BOTH implementations: the plpgsql in
   migration 0003 that actually enforces the rules, and the JS above that greys
   out illegal cards in the browser. If the two ever disagree, this file says
   which one is wrong. */

test("leading a trick, every card is legal", () => {
  const hand = ["AS", "2H", "7D"];
  assert.deepEqual(legalPlays(hand, null), hand);
  assert.deepEqual(legalPlays(hand, undefined), hand);
});

test("you must follow the led suit when you hold it", () => {
  const hand = ["AS", "3S", "2H", "7D"];
  assert.deepEqual(legalPlays(hand, "S"), ["AS", "3S"]);
  assert.deepEqual(legalPlays(hand, "H"), ["2H"]);
});

test("holding none of the led suit frees you to play anything, trump included", () => {
  const hand = ["AS", "3S", "2H"];
  assert.deepEqual(legalPlays(hand, "D"), hand);
});

test("legalPlays never mutates or aliases the hand", () => {
  const hand = ["AS", "2H"];
  const out = legalPlays(hand, null);
  out.push("XX");
  assert.equal(hand.length, 2);
});

test("highest card of the led suit wins when nobody trumps", () => {
  const plays = [{ seat: 0, card: "5S" }, { seat: 1, card: "KS" }, { seat: 2, card: "9S" }];
  assert.equal(trickWinner(plays, "H"), 1);
});

test("ace is high", () => {
  const plays = [{ seat: 0, card: "KS" }, { seat: 1, card: "AS" }, { seat: 2, card: "2S" }];
  assert.equal(trickWinner(plays, "H"), 1);
});

test("any trump beats the highest card of the led suit", () => {
  const plays = [{ seat: 0, card: "AS" }, { seat: 1, card: "2H" }, { seat: 2, card: "KS" }];
  assert.equal(trickWinner(plays, "H"), 1, "the 2 of trumps beats the ace of the led suit");
});

test("with several trumps, the highest trump wins", () => {
  const plays = [{ seat: 0, card: "AS" }, { seat: 1, card: "2H" }, { seat: 2, card: "QH" }, { seat: 3, card: "9H" }];
  assert.equal(trickWinner(plays, "H"), 2);
});

test("a discard of a third suit cannot win, however high", () => {
  const plays = [{ seat: 0, card: "3S" }, { seat: 1, card: "AD" }, { seat: 2, card: "2S" }];
  assert.equal(trickWinner(plays, "H"), 0, "the ace of diamonds is neither trump nor led suit");
});

test("leading trump means the highest trump still wins", () => {
  const plays = [{ seat: 0, card: "5H" }, { seat: 1, card: "AH" }, { seat: 2, card: "KD" }];
  assert.equal(trickWinner(plays, "H"), 1);
});

test("a single-card trick is won by that card", () => {
  assert.equal(trickWinner([{ seat: 3, card: "2C" }], "H"), 3);
  assert.equal(trickWinner([], "H"), null);
});

test("the winner is a seat number, not a position in the array", () => {
  const plays = [{ seat: 5, card: "KS" }, { seat: 6, card: "AS" }, { seat: 0, card: "2S" }];
  assert.equal(trickWinner(plays, "H"), 6);
});

test("scoring pays 10 + bid for an exact call and costs the same otherwise", () => {
  assert.equal(roundPoints(0, 0), 10);
  assert.equal(roundPoints(3, 3), 13);
  assert.equal(roundPoints(3, 2), -13);
  assert.equal(roundPoints(3, 4), -13, "overshooting is just as wrong as falling short");
  assert.equal(roundPoints(0, 1), -10);
});

test("a full trick uses every seat exactly once", () => {
  // sanity check on the shape the server will hand us
  const plays = [{ seat: 0, card: "5S" }, { seat: 1, card: "KS" }, { seat: 2, card: "9S" }];
  assert.equal(new Set(plays.map(p => p.seat)).size, plays.length);
  assert.ok(plays.every(p => suitOf(p.card).length === 1));
});
