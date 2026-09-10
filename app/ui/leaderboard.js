import {$} from "../dom.js";
import {G} from "../state.js";
import {fmtFor} from "../../shared/rules.js";

export function renderLeaderboard(ord,scored){
  /* the gif is 4.4MB, so the row shows a 7KB still until hover swaps in the animation */
  const KATT=`<span class="pic k"><span class="pop"><span class="frame"><img src="static/kattappa_still.jpg" data-still="static/kattappa_still.jpg" data-gif="static/kattappa.gif" alt=""></span></span></span>`;
  const CRY=`<span class="pic c"><span class="pop"><span class="frame"><img src="static/crying.jpg" alt=""></span><b class="cap">Jai Beam, Jai Pillar</b></span></span>`;
  $("lb").innerHTML=ord.map((p,k)=>{
    const pic=scored===0?"":k===1?KATT:k===ord.length-1?CRY:"";   // nothing to rank before a round is scored
    return `<li class="${k===0?'first':''} ${k===ord.length-1?'last':''} ${pic?'haspic':''}"><span class="rk">${k===0?'👑 Sultan-e-Hind':k===ord.length-1?'🩴 Gaddar':['','2nd','3rd','4th','5th','6th','7th','8th'][k]}</span><span class="nm ${p.navy?'navy':''}">${p.n}</span>${pic}<span class="sc ${p.tot<0?'neg':''} ${p.navy?'navy':''}">${fmtFor(G,p.tot)}</span></li>`;
  }).join("");
}

export function initLeaderboard(){
/* delegated, because renderAll rebuilds the leaderboard: swap the still for the gif on hover */
$("lb").addEventListener("mouseover",e=>{const i=e.target.closest("img[data-gif]");
  if(i&&!i.dataset.on){i.dataset.on="1";i.src=i.dataset.gif}});
$("lb").addEventListener("mouseout",e=>{const i=e.target.closest("img[data-gif]");
  if(i&&i.dataset.on){delete i.dataset.on;i.src=i.dataset.still}});
}
