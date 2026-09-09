/* Pure game rules and derived values. No DOM, no globals, no imports — this module is
   imported by the browser today and by the server later, so it must stay dependency-free.
   Every function takes the game state explicitly rather than closing over a global. */

export const PAL=["#6D28D9","#0E7490","#B45309","#047857","#9D174D","#0F766E","#7C2D12","#4338CA"];
export const NAVY="#1F2A5C";
export const TRUMPS=[["\u2665","Hearts","red"],["\u2660","Spades","blk"],["\u2666","Diamonds","red"],["\u2663","Clubs","blk"]];

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
