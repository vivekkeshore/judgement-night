/* Declare (Least Count), as this table plays it. Pure rules — no DOM, no globals,
   no imports beyond the card vocabulary in rules.js — because this file is
   mirrored by plpgsql in supabase/migrations/0008_declare.sql. The SQL copy is
   the authoritative one; this one greys out illegal moves in the browser.
   tests/declare.test.js is the reference for both.

   The game in one paragraph: everyone holds five cards. On your turn you throw
   away one card, a set of equal ranks, or a run of three or more in one suit —
   and then pick one card up, off the stock or out of the group the player
   before you threw. Throwing a group is how a hand shrinks, and a small hand is
   the whole point: at the start of your turn, before you throw, if your cards
   add up to ten or less you may declare. Lowest total after the last round
   wins. */

import { SUITS, RANKS, suitOf, rankOf } from "./rules.js";

/* Card value is the face value, and the ace is worth one.

   This is NOT rankValue() from rules.js, and the two must never be confused:
   that one is an ace-high ordinal for deciding which card beats which, whereas
   this one is a quantity that gets added up. Judgement never adds card values
   and Declare never compares them, so neither function has any business in the
   other game. */
const VALUE = { A: 1, T: 10, J: 11, Q: 12, K: 13 };
export const cardValue = card => VALUE[rankOf(card)] ?? Number(rankOf(card));

/* What a hand is worth — the number the whole game is played against. */
export const handCount = cards => cards.reduce((t, c) => t + cardValue(c), 0);

export const HAND_SIZE = 5;          // dealt to everyone at the start of a round
export const DECLARE_AT = 10;        // declare only at this count or below
export const PENALTY = 20;           // per player who turned out to be lower
export const DEFAULT_ROUNDS = 8;
export const MIN_ROUNDS = 3;
export const MAX_ROUNDS = 20;

/* ------------------------------------------------------------- throwing ----
   A throw is one card, a set, or a run. Sets and runs are what make a hand
   shrink, so they are the only way a count comes down quickly. */

const uniq = cards => new Set(cards).size === cards.length;

/* Two or more of the same rank, any suits. */
export function isSet(cards) {
  if (cards.length < 2 || !uniq(cards)) return false;
  return cards.every(c => rankOf(c) === rankOf(cards[0]));
}

/* Three or more consecutive cards in one suit. The ace is low here and only
   low — A-2-3 is a run, Q-K-A is not — because the ace is worth one, and a
   sequence that wraps round the top of the deck would be worth 1 + 12 + 13. */
export function isRun(cards) {
  if (cards.length < 3 || !uniq(cards)) return false;
  if (!cards.every(c => suitOf(c) === suitOf(cards[0]))) return false;
  const vals = cards.map(cardValue).sort((a, b) => a - b);
  return vals.every((v, i) => i === 0 || v === vals[i - 1] + 1);
}

export const legalDiscard = cards =>
  Array.isArray(cards) && cards.length > 0 && uniq(cards) &&
  (cards.length === 1 || isSet(cards) || isRun(cards));

/* Why a throw is not allowed, in words, or null if it is fine. The hand size
   check matters: throwing everything would leave a count of zero and an
   automatic win, so one card always stays behind. */
export function discardError(hand, cards) {
  if (!Array.isArray(cards) || !cards.length) return "pick at least one card";
  if (!uniq(cards)) return "that card is only in your hand once";
  const held = new Set(hand);
  if (!cards.every(c => held.has(c))) return "you do not hold all of those";
  if (cards.length >= hand.length) return "you have to keep at least one card";
  if (!legalDiscard(cards)) return cards.length === 2
    ? "two cards have to be a pair"
    : "that is not a set or a run of three or more in one suit";
  return null;
}

/* ------------------------------------------------------------ declaring ----
   Declaring is a bet that nobody is lower than you. Get it right and you score
   nothing; get it wrong and every player who was lower costs you twenty. */

export const canDeclare = hand => handCount(hand) <= DECLARE_AT;

export const declareError = hand =>
  canDeclare(hand) ? null
    : `your hand comes to ${handCount(hand)} — declare at ${DECLARE_AT} or less`;

/* The round's points, given every seat's count and who declared.

     * anyone strictly lower than the declarer scores nothing
     * the declarer scores nothing if nobody is lower, and otherwise
       twenty for each player who was, plus their own cards on top
     * everyone else scores their own cards

   Strictly lower is the load-bearing word. A player level with the declarer has
   not beaten them, so they neither escape their own count nor cost the declarer
   a penalty.

   `counts` maps seat -> count; the return maps seat -> points. */
export function scoreDeclare({ counts, declarer }) {
  const seats = Object.keys(counts).map(Number);
  const mine = counts[declarer];
  if (mine === undefined) throw new Error(`no count for the declaring seat ${declarer}`);

  const lower = seats.filter(s => counts[s] < mine);
  const points = {};
  for (const s of seats) {
    if (s === declarer) points[s] = lower.length ? PENALTY * lower.length + mine : 0;
    else points[s] = counts[s] < mine ? 0 : counts[s];
  }
  return points;
}

/* ------------------------------------------------------------- the deal ----
   One deck: five each, one card turned up to start the discard pile, the rest
   face down as the stock. Eight players is forty cards dealt plus one turned up,
   which one deck covers with eleven to spare. */
export const dealFits = players => players * HAND_SIZE + 1 <= SUITS.length * RANKS.length;

/* ------------------------------------------------------------ auto-play ----
   What the server does for someone whose clock ran out. Mirrored by auto_move()
   in migration 0009, and deliberately unhelpful — it keeps the table moving
   rather than playing an absent player's hand well for them. Never declares,
   because declaring is a bet and nobody should have one placed for them. */

/* Throw the single most expensive card. Not the best move — a set would shrink
   the hand — but it is the one that needs no judgement. */
export function autoDiscard(hand) {
  if (hand.length <= 1) return null;    // one card always stays
  return hand.reduce((worst, c) => (cardValue(c) > cardValue(worst) ? c : worst));
}

/* And then take the stock rather than the pile: picking off the pile is a
   read of what the table is collecting, which an absent player cannot make. */
export const autoPick = () => "stock";

/* ------------------------------------------------------------- display ----
   Hold them grouped by suit, low to high, so a run is visible at a glance and
   the pairs sit next to each other. */
const SUIT_ORDER = { S: 0, H: 1, D: 2, C: 3 };
export function sortDeclareHand(hand) {
  return [...hand].sort((a, b) =>
    (SUIT_ORDER[suitOf(a)] - SUIT_ORDER[suitOf(b)]) || (cardValue(a) - cardValue(b)));
}
