import {$} from "../dom.js";
import {G} from "../state.js";
import {totals,pts,fmt} from "../../shared/rules.js";

/* ---------- ticker ---------- */
function renderTicker(ord,finished){
  const base=["Judgement · call your hands before the first card falls","Correct call banks <b>10 + bid</b>","Wrong call costs <b>10 + bid</b> · no mercy","Trump rotates <b>♥ Hearts → ♠ Spades → ♦ Diamonds → ♣ Clubs</b>","Highest total is crowned <b>Sultan-e-Hind</b>","Lowest total wears the <b>Gaddar</b> slipper"];
  if(ord){base.push(`${finished?"Tonight's":"Current"} Sultan-e-Hind: <b>${ord[0].n} · ${fmt(ord[0].tot)}</b>`,`${finished?"Tonight's":"Current"} Gaddar: <b>${ord[ord.length-1].n} · ${fmt(ord[ord.length-1].tot)}</b>`)}
  const s=base.map(x=>`<span>${x}</span>`).join("");$("ticker").innerHTML=s+s;
}

/* ---------- bottom stock ticker ---------- */
function renderStock(done){
  const T=totals(G);
  const items=G.players.map((p,i)=>{
    const r=done-1;const b=r>=0?G.bids[r][i]:null;const chg=b==null?0:pts(b,G.res[r][i]!==0);
    const prev=T[i]-chg;const pct=prev!==0?Math.round(chg/Math.abs(prev)*100):null;
    const cls=chg>0?"up":chg<0?"dn":"flat";const arrow=chg>0?"▲":chg<0?"▼":"■";
    return `<span class="q ${cls}"><span class="sym">${p.n}</span><span class="px">${fmt(T[i])}</span><span class="chg">${arrow} ${chg>0?"+":""}${chg}${pct!=null&&done>0?` (${pct>0?"+":""}${pct}%)`:""}</span><span class="lbl">${done>0?`R${done}`:"pre-game"}</span></span>`;
  }).join("");
  const hd=`<span class="hd">JDG · ${done>0?`after round ${done}`:"market open"}</span>`;
  $("stock").innerHTML=hd+items+hd+items;
}

export {renderTicker,renderStock};
