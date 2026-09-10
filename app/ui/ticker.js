import {$} from "../dom.js";
import {G} from "../state.js";
import {totals,roundDelta,fmtFor,gameOf} from "../../shared/rules.js";

/* ---------- ticker ---------- */
/* The rules crawl at the top of the page. Which rules depends on which game is
   on the table, so the lines come off the descriptor rather than being written
   into this file twice. */
const LINES={
  judgement:["Judgement · call your hands before the first card falls","Correct call banks <b>10 + bid</b>","Wrong call costs <b>10 + bid</b> · no mercy","Trump rotates <b>♥ Hearts → ♠ Spades → ♦ Diamonds → ♣ Clubs</b>","Highest total is crowned <b>Sultan-e-Hind</b>","Lowest total wears the <b>Gaddar</b> slipper"],
  declare:["Declare · throw one card, a set, or a run of three — then pick one up","Ace <b>1</b> · jack <b>11</b> · queen <b>12</b> · king <b>13</b>","Pick up the stock, or what the player before you threw","Declare only when your hand comes to <b>10 or less</b>","Anyone lower than the declarer scores <b>nothing</b>","Called it wrong? <b>20 a head</b>, plus your own cards","<b>Lowest</b> total is crowned <b>Sultan-e-Hind</b>"],
};
function renderTicker(ord,finished){
  const base=[...(LINES[gameOf(G).id]||LINES.judgement)];
  if(ord)base.push(`${finished?"Tonight's":"Current"} Sultan-e-Hind: <b>${ord[0].n} · ${fmtFor(G,ord[0].tot)}</b>`,`${finished?"Tonight's":"Current"} Gaddar: <b>${ord[ord.length-1].n} · ${fmtFor(G,ord[ord.length-1].tot)}</b>`);
  const s=base.map(x=>`<span>${x}</span>`).join("");$("ticker").innerHTML=s+s;
}

/* ---------- bottom stock ticker ---------- */
/* A market tape. The arrow follows the number — up is up — but the colour
   follows your fortunes, which is the opposite thing in Declare: a total that
   climbed is a round that hurt, so it goes up in red. */
function renderStock(done){
  const T=totals(G),bad=gameOf(G).pointsAreBad;
  const items=G.players.map((p,i)=>{
    const r=done-1;const chg=r>=0?roundDelta(G,r,i):0;
    const prev=T[i]-chg;const pct=prev!==0?Math.round(chg/Math.abs(prev)*100):null;
    const good=bad?-chg:chg;
    const cls=good>0?"up":good<0?"dn":"flat";const arrow=chg>0?"▲":chg<0?"▼":"■";
    return `<span class="q ${cls}"><span class="sym">${p.n}</span><span class="px">${fmtFor(G,T[i])}</span><span class="chg">${arrow} ${fmtFor(G,chg)}${pct!=null&&done>0?` (${pct>0?"+":""}${pct}%)`:""}</span><span class="lbl">${done>0?`R${done}`:"pre-game"}</span></span>`;
  }).join("");
  const tag=gameOf(G).id==="declare"?"DCL":"JDG";
  const hd=`<span class="hd">${tag} · ${done>0?`after round ${done}`:"market open"}</span>`;
  $("stock").innerHTML=hd+items+hd+items;
}

export {renderTicker,renderStock};
