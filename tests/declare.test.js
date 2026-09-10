import test from "node:test";
import assert from "node:assert/strict";
import {
  cardValue, handCount, isSet, isRun, legalDiscard, discardError,
  canDeclare, declareError, scoreDeclare, autoDiscard, sortDeclareHand,
  dealFits, HAND_SIZE, DECLARE_AT, PENALTY,
} from "../shared/declare.js";
import { DECK, rankValue } from "../shared/rules.js";

/* ------------------------------------------------------------ card values ----
   The one thing most likely to go quietly wrong: rules.js already has a
   rankValue(), it is ace-HIGH and zero-based, and using it here would misprice
   every hand at the table. */

test("the ace is worth one and the king thirteen", () => {
  assert.equal(cardValue("AS"), 1);
  assert.equal(cardValue("KH"), 13);
  assert.equal(cardValue("QD"), 12);
  assert.equal(cardValue("JC"), 11);
  assert.equal(cardValue("TS"), 10);
  assert.equal(cardValue("2H"), 2);
  assert.equal(cardValue("9D"), 9);
});

test("value follows the rank and ignores the suit", () => {
  for (const s of "SHDC") assert.equal(cardValue("7" + s), 7);
});

test("every card in the deck prices between one and thirteen", () => {
  for (const c of DECK) {
    const v = cardValue(c);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 13, `${c} priced ${v}`);
  }
});

test("card value is not rankValue — the ace is the whole difference", () => {
  assert.equal(rankValue("AS"), 12, "rules.js still ranks the ace highest");
  assert.equal(cardValue("AS"), 1, "declare still prices it at one");
});

test("a hand is worth the sum of its cards", () => {
  assert.equal(handCount([]), 0);
  assert.equal(handCount(["AS", "5H", "TD", "QC"]), 1 + 5 + 10 + 12);   // the user's own example
  assert.equal(handCount(["KS", "KH", "KD", "KC"]), 52);
});

/* ------------------------------------------------------------------ sets ----- */

test("two or more of a rank is a set, in any suits", () => {
  assert.ok(isSet(["7S", "7H"]));
  assert.ok(isSet(["7S", "7H", "7D"]));
  assert.ok(isSet(["7S", "7H", "7D", "7C"]));
});

test("one card is not a set, and neither are mixed ranks", () => {
  assert.equal(isSet(["7S"]), false);
  assert.equal(isSet(["7S", "8H"]), false);
  assert.equal(isSet(["7S", "7H", "8D"]), false);
  assert.equal(isSet([]), false);
});

/* ------------------------------------------------------------------ runs ----- */

test("three or more consecutive cards in one suit is a run", () => {
  assert.ok(isRun(["4H", "5H", "6H"]));
  assert.ok(isRun(["4H", "5H", "6H", "7H"]));
  assert.ok(isRun(["6H", "4H", "5H"]), "order of selection must not matter");
});

test("the ace is low, so A-2-3 runs", () => {
  assert.ok(isRun(["AS", "2S", "3S"]));
});

test("the ace is low ONLY, so Q-K-A does not run", () => {
  assert.equal(isRun(["QS", "KS", "AS"]), false,
    "wrapping round the top would be worth 12 + 13 + 1, which is not a sequence");
  assert.equal(isRun(["KS", "AS", "2S"]), false);
});

test("a run needs three, one suit, and no gaps", () => {
  assert.equal(isRun(["4H", "5H"]), false, "two is not enough");
  assert.equal(isRun(["4H", "5S", "6H"]), false, "one suit only");
  assert.equal(isRun(["4H", "6H", "7H"]), false, "no gaps");
  assert.equal(isRun(["4H", "4H", "5H"]), false, "and no repeats");
});

/* ------------------------------------------------------------- throwing ----- */

test("a throw is one card, a set, or a run", () => {
  assert.ok(legalDiscard(["9C"]));
  assert.ok(legalDiscard(["9C", "9S"]));
  assert.ok(legalDiscard(["9C", "TC", "JC"]));
  assert.equal(legalDiscard(["9C", "TS"]), false);
  assert.equal(legalDiscard([]), false);
});

test("you must hold what you throw", () => {
  assert.match(discardError(["AS", "5H"], ["KD"]), /do not hold/);
});

test("you have to keep at least one card", () => {
  assert.match(discardError(["7S", "7H"], ["7S", "7H"]), /at least one/);
  assert.equal(discardError(["7S", "7H", "2D"], ["7S", "7H"]), null);
});

test("an illegal group is refused with a reason", () => {
  assert.match(discardError(["7S", "8H", "2D"], ["7S", "8H"]), /pair/);
  assert.match(discardError(["7S", "8H", "9D", "2C"], ["7S", "8H", "9D"]), /set or a run/);
});

/* ------------------------------------------------------------ declaring ----- */

test("declaring is legal at ten or less and not above it", () => {
  assert.ok(canDeclare(["AS", "2H", "3D", "4C"]));       // 10 exactly
  assert.ok(canDeclare(["AS"]));
  assert.equal(canDeclare(["AS", "2H", "3D", "5C"]), false);   // 11
  assert.equal(DECLARE_AT, 10);
});

test("the refusal says what the hand actually came to", () => {
  assert.equal(declareError(["AS", "2H"]), null);
  assert.match(declareError(["KS", "2H"]), /comes to 15/);
});

/* --------------------------------------------------------------- scoring ----
   The four cases, using the example the rules were explained with: A declares
   on 8, B has 5, C has 6, D has 20. */

test("the declarer who is beaten pays twenty a head plus their own cards", () => {
  const points = scoreDeclare({ counts: { 0: 8, 1: 5, 2: 6, 3: 20 }, declarer: 0 });
  assert.equal(points[0], PENALTY * 2 + 8, "two players were lower: 20 + 20 + 8");
  assert.equal(points[0], 48);
  assert.equal(points[1], 0, "B was lower, so B scores nothing");
  assert.equal(points[2], 0, "C was lower, so C scores nothing");
  assert.equal(points[3], 20, "D was not lower, so D eats their own count");
});

test("a declarer nobody beat scores nothing, and everyone else their cards", () => {
  const points = scoreDeclare({ counts: { 0: 8, 1: 9, 2: 20 }, declarer: 0 });
  assert.deepEqual(points, { 0: 0, 1: 9, 2: 20 });
});

test("level is not lower — a tie neither saves the tier nor costs the declarer", () => {
  const points = scoreDeclare({ counts: { 0: 8, 1: 8, 2: 12 }, declarer: 0 });
  assert.equal(points[0], 0, "nobody was strictly lower, so no penalty");
  assert.equal(points[1], 8, "level with the declarer still pays their own count");
  assert.equal(points[2], 12);
});

test("one player lower is one penalty, not a flat fee", () => {
  const points = scoreDeclare({ counts: { 0: 10, 1: 4, 2: 30 }, declarer: 0 });
  assert.equal(points[0], 30, "20 for B, plus the declarer's own 10");
  assert.equal(points[1], 0);
  assert.equal(points[2], 30);
});

test("the declarer's own count is added on top of the penalties, not swallowed by them", () => {
  const a = scoreDeclare({ counts: { 0: 0, 1: -1 }, declarer: 0 });   // -1 is impossible, but the arithmetic should be visible
  assert.equal(a[0], PENALTY + 0);
});

test("scoring a seat that never declared throws rather than guessing", () => {
  assert.throws(() => scoreDeclare({ counts: { 0: 5, 1: 6 }, declarer: 2 }), /no count/);
});

test("a three-player round always adds up to something the table can total", () => {
  const points = scoreDeclare({ counts: { 0: 3, 1: 3, 2: 3 }, declarer: 1 });
  assert.deepEqual(points, { 0: 3, 1: 0, 2: 3 }, "all level: only the declarer escapes");
});

/* ------------------------------------------------------------- the deal ----- */

test("one deck deals five each plus a turn-up for every table size", () => {
  for (let n = 3; n <= 8; n++) assert.ok(dealFits(n), `${n} players`);
  assert.equal(HAND_SIZE, 5);
  assert.equal(dealFits(11), false, "55 cards is more than a deck");
});

/* ------------------------------------------------------------ auto-play ----- */

test("auto-discard throws the most expensive single card", () => {
  assert.equal(autoDiscard(["2S", "KH", "5D"]), "KH");
  assert.equal(autoDiscard(["AS", "2H"]), "2H");
});

test("auto-discard keeps the last card rather than emptying the hand", () => {
  assert.equal(autoDiscard(["KH"]), null);
  assert.equal(autoDiscard([]), null);
});

/* -------------------------------------------------------------- display ----- */

test("a hand sorts by suit then by value, so runs and pairs sit together", () => {
  assert.deepEqual(
    sortDeclareHand(["KH", "2S", "AS", "3S", "5H"]),
    ["AS", "2S", "3S", "5H", "KH"]);
});
