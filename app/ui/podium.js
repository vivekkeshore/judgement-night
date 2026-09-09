import {$} from "../dom.js";
import {G} from "../state.js";
import {fmt} from "../../shared/rules.js";

/* ---------- podium ---------- */
function renderPodium(ord){
  const win=ord[0],lose=ord[ord.length-1];
  const stat=p=>{let hits=0,best=0,cur=0;G.bids.forEach((row,r)=>{if(!G.done[r]||row[p.i]==null)return;if(G.res[r][p.i]!==0){hits++;cur++;best=Math.max(best,cur)}else cur=0});return{hits,best}};
  const ws=stat(win),ls=stat(lose),N=G.cards.length;
  const crown=`<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M12 72 L8 32 L30 50 L50 20 L70 50 L92 32 L88 72 Z" fill="#D9A441" stroke="#A8761F" stroke-width="3" stroke-linejoin="round"/><rect x="12" y="72" width="76" height="12" rx="2" fill="#A8761F"/><circle cx="50" cy="20" r="5" fill="#B3202E"/><circle cx="8" cy="32" r="4" fill="#1F2A5C"/><circle cx="92" cy="32" r="4" fill="#1F2A5C"/><circle cx="50" cy="60" r="5" fill="#1F7B4E"/></svg>`;
  const slip=`<svg viewBox="0 0 100 100" aria-hidden="true"><path d="M20 30 C15 55 22 82 45 88 C70 94 86 74 84 48 C82 28 70 12 52 10 C36 8 24 16 20 30 Z" fill="#B3202E" stroke="#7A1420" stroke-width="3"/><path d="M52 12 C40 30 34 44 36 58 M52 12 C64 28 70 40 66 56" fill="none" stroke="#7A1420" stroke-width="5" stroke-linecap="round"/><circle cx="52" cy="12" r="5" fill="#161514"/></svg>`;
  $("podium").hidden=false;
  $("podium").innerHTML=`<article class="pcard win">${crown}<div class="tag">Winner · highest total</div><h2 class="title">Sultan-e-Hind</h2><p class="name ${win.navy?'navy':''}">${win.n}</p><div class="big ${win.navy?'navy':''}">${fmt(win.tot)}</div><div class="sub">${ws.hits} of ${N} calls landed · longest run ${ws.best} · finished ${win.tot-ord[1].tot} clear of ${ord[1].n}.</div></article>
  <article class="pcard lose">${slip}<div class="tag">Last place · lowest total</div><h2 class="title">Gaddar</h2><p class="name ${lose.navy?'navy':''}">${lose.n}</p><div class="big ${lose.navy?'navy':''}">${fmt(lose.tot)}</div><div class="sub">${ls.hits} of ${N} calls landed · longest run ${ls.best} · ${Math.abs(lose.tot-ord[ord.length-2].tot)} behind ${ord[ord.length-2].n}.</div></article>`;
}

export {renderPodium};
