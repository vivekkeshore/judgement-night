import test from "node:test";
import assert from "node:assert/strict";
import {
  DECK, SUITS, RANKS, suitOf, rankOf, rankValue, trumpOf, maxDealable,
  firstBidder, lastBidder, nextSeat, bannedBid, bidError, cardsPerRound, sortHand
} from "../shared/rules.js";

test("the deck is 52 unique cards, two characters each", () => {
  assert.equal(DECK.length, 52);
  assert.equal(new Set(DECK).size, 52);
  assert.ok(DECK.every(c => c.length === 2));
  assert.equal(SUITS.length, 4);
  assert.equal(RANKS.length, 13);
});

test("cards parse into rank and suit, ace high", () => {
  assert.equal(rankOf("AS"), "A");
  assert.equal(suitOf("AS"), "S");
  assert.ok(rankValue("AS") > rankValue("KS"));
  assert.ok(rankValue("TS") > rankValue("9S"));
  assert.ok(rankValue("2S") < rankValue("3S"));
  assert.equal(rankValue("AS"), RANKS.length - 1);
});

test("trump rotates by round and matches the display order", () => {
  assert.deepEqual([0,1,2,3,4,5].map(trumpOf), ["H","S","D","C","H","S"]);
});

test("one deck caps the opening hand", () => {
  assert.equal(maxDealable(3), 17);
  assert.equal(maxDealable(5), 10);
  assert.equal(maxDealable(8), 6);
  // the round schedule must never need more cards than the deck holds
  for (const players of [3,4,5,6,7,8]) {
    const m = maxDealable(players);
    assert.ok(Math.max(...cardsPerRound(m)) * players <= DECK.length);
  }
});

test("the first bidder moves one seat clockwise each round", () => {
  assert.deepEqual([0,1,2,3,4].map(r => firstBidder(r, 4)), [0,1,2,3,0]);
  assert.deepEqual([0,1,2,3,4].map(r => lastBidder(r, 4)),  [3,0,1,2,3]);
  assert.equal(nextSeat(3, 4), 0);
});

test("bannedBid is the value that would make the bids add up exactly", () => {
  // 5 cards, others bid 1+1+1 = 3, so the last player may not bid 2
  assert.equal(bannedBid(5, {0:1, 1:1, 2:1}), 2);
  // nothing is banned while a bid is still missing
  assert.equal(bannedBid(5, {0:1, 1:null, 2:1}), null);
  // if the others already exceed the cards, no legal bid could total exactly
  assert.equal(bannedBid(2, {0:2, 1:2, 2:2}), null);
});

test("bidError enforces range for everyone", () => {
  const base = { cards: 3, isLastBidder: false, otherBids: {} };
  assert.equal(bidError({ ...base, bid: 0 }), null);
  assert.equal(bidError({ ...base, bid: 3 }), null);
  assert.ok(bidError({ ...base, bid: -1 }));
  assert.ok(bidError({ ...base, bid: 4 }));
  assert.ok(bidError({ ...base, bid: 1.5 }));
});

test("bidError blocks only the banned value, and only for the last bidder", () => {
  const others = { 0:1, 1:1, 2:1 };           // 3 of 5 spoken for, so 2 is banned
  assert.ok(bidError({ cards: 5, bid: 2, isLastBidder: true, otherBids: others }));
  assert.equal(bidError({ cards: 5, bid: 3, isLastBidder: true, otherBids: others }), null);
  // the same bid is perfectly legal for anyone who is not last
  assert.equal(bidError({ cards: 5, bid: 2, isLastBidder: false, otherBids: others }), null);
});

test("sortHand puts trump first, then other suits, each high to low", () => {
  // hearts trump: the two hearts lead, ace-high within each suit
  assert.deepEqual(sortHand(["2C","AS","TH","KH","7D"], "H"), ["KH","TH","AS","7D","2C"]);
  // the same hand with spades trump reorders the front
  assert.deepEqual(sortHand(["2C","AS","TH","KH","7D"], "S"), ["AS","KH","TH","7D","2C"]);
  // every suit can be trump without the fixed suit order overwriting it
  for (const t of ["S","H","D","C"]) {
    const out = sortHand(["2C","AS","TH","KH","7D","9C"], t);
    const firstSuit = out[0][1];
    if (out.some(c => c[1] === t)) assert.equal(firstSuit, t, `${t} trump should lead`);
  }
  assert.equal(sortHand([], "H").length, 0);
});

test("the table size decides the hand size and the game length", () => {
  // one deck, so the most everyone can be dealt is floor(52 / players),
  // and the schedule is that count down to one and back up
  const shape = n => {
    const cards = maxDealable(n);
    return { cards, rounds: cardsPerRound(cards).length };
  };
  assert.deepEqual(shape(3), { cards: 17, rounds: 34 });
  assert.deepEqual(shape(4), { cards: 13, rounds: 26 });
  assert.deepEqual(shape(5), { cards: 10, rounds: 20 });
  assert.deepEqual(shape(6), { cards: 8,  rounds: 16 });
  assert.deepEqual(shape(7), { cards: 7,  rounds: 14 });
  assert.deepEqual(shape(8), { cards: 6,  rounds: 12 });

  // fewer players means a longer game, which is worth knowing before starting
  assert.ok(shape(3).rounds > shape(8).rounds);
  // and no deal ever needs more than the deck holds
  for (const n of [3,4,5,6,7,8]) assert.ok(shape(n).cards * n <= 52);
});
