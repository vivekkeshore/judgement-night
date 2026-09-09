/* Pure game rules and derived values. No DOM, no globals, no imports — this module is
   imported by the browser today and by the server later, so it must stay dependency-free.
   Every function takes the game state explicitly rather than closing over a global. */

export const PAL=["#6D28D9","#0E7490","#B45309","#047857","#9D174D","#0F766E","#7C2D12","#4338CA"];
export const NAVY="#1F2A5C";
export const TRUMPS=[["\u2665","Hearts","red","H"],["\u2660","Spades","blk","S"],["\u2666","Diamonds","red","D"],["\u2663","Clubs","blk","C"]];

export const colorFor=(name,i)=>/^\s*vivek\b/i.test(name)?NAVY:PAL[i%PAL.length];
export const pts=(b,ok)=>(10+b)*(ok?1:-1);
export const fmt=v=>v>0?"+"+v:String(v);

/* cards dealt per round: the maximum down to one, then back up */
export function cardsPerRound(m){const cards=[];for(let c=m;c>=1;c--)cards.push(c);for(let c=1;c<=m;c++)cards.push(c);return cards}

/* Only rounds flagged done[r] feed the aggregates. Bids are entered before the hand is played,
   so an un-flagged round is a prediction, not a score, and must not move any total. */
export function totals(G){return G.players.map((_,p)=>G.bids.reduce((t,row,r)=>(!G.done[r]||row[p]==null)?t:t+pts(row[p],G.res[r][p]!==0),0))}
export function cum(G,p){let t=0;return [0,...G.bids.map((row,r)=>{if(G.done[r]&&row[p]!=null)t+=pts(row[p],G.res[r][p]!==0);return t})]}
export function currentRound(G){for(let r=0;r<G.cards.length;r++){if(!G.done[r])return r}return -1}
export function lastCompleteRound(G){let n=0;for(let r=0;r<G.cards.length;r++){if(G.done[r])n=r+1;else break}return n} // contiguous prefix, for the chart/ticker x-axis
export function doneCount(G){return G.done.filter(Boolean).length}
export function ordered(G){const t=totals(G);return G.players.map((p,i)=>({...p,i,tot:t[i]})).sort((a,b)=>b.tot-a.tot||a.i-b.i)}

/* ------------------------------------------------------------------ cards ----
   A card is two characters: rank then suit, e.g. "AS", "TH", "2C".
   Ten is "T" so every card is the same width, which keeps sorting and
   comparison trivial on both the client and the server. */
export const SUITS = ["S", "H", "D", "C"];
export const RANKS = ["2","3","4","5","6","7","8","9","T","J","Q","K","A"];
export const DECK = SUITS.flatMap(s => RANKS.map(r => r + s));

export const suitOf = card => card[1];
export const rankOf = card => card[0];
export const rankValue = card => RANKS.indexOf(card[0]);   // ace high
export const trumpOf = round => TRUMPS[round % 4][3];

/* the most cards that can be dealt to everyone from one deck */
export const maxDealable = players => Math.floor(DECK.length / players);

/* ------------------------------------------------------------------ turns ----
   The first bidder moves one seat clockwise each round; the last bidder is the
   seat before them. */
export const firstBidder = (round, players) => round % players;
export const lastBidder  = (round, players) => (round % players + players - 1) % players;
export const nextSeat    = (seat, players) => (seat + 1) % players;

/* The one bid the final bidder may not make: the whole point of the rule is that
   the bids must never add up to the number of tricks available, so somebody is
   always going to be wrong. Returns null while other bids are still missing, and
   never returns a bid that was impossible anyway. */
export function bannedBid(cards, bidsSoFar) {
  const values = Object.values(bidsSoFar);
  if (values.some(v => v == null)) return null;
  const banned = cards - values.reduce((a, b) => a + b, 0);
  return banned >= 0 && banned <= cards ? banned : null;
}

/* Server-authoritative check; the client uses the same function to grey out a
   bid before it is sent. */
export function bidError({ cards, bid, isLastBidder, otherBids }) {
  if (!Number.isInteger(bid)) return "that is not a number";
  if (bid < 0 || bid > cards) return `bid between 0 and ${cards}`;
  if (isLastBidder) {
    const banned = bannedBid(cards, otherBids);
    if (banned !== null && bid === banned)
      return `not ${banned} — the bids may not add up to ${cards}`;
  }
  return null;
}

/* Hold them the way a player would: trump first, then the other suits, each
   high to low. The trump key must come LAST in the literal — writing it first
   lets the fixed S/H/D/C entries overwrite it. */
export function sortHand(hand, trump) {
  const order = { S: 1, H: 2, D: 3, C: 4, [trump]: 0 };
  return [...hand].sort((a, b) =>
    (order[suitOf(a)] - order[suitOf(b)]) || (rankValue(b) - rankValue(a)));
}
