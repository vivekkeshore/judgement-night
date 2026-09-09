/* Manual mode — the original single-device scorekeeper, unchanged in behaviour.
   One person types every bid and result; state is a single object in localStorage.
   This is the offline fallback for playing with physical cards. */
import {$} from "../dom.js";
import {G,setG,save,KEY} from "../state.js";
import {TRUMPS,totals,currentRound,lastCompleteRound,doneCount,ordered,colorFor,cardsPerRound,fmt,NAVY} from "../../shared/rules.js";
import {renderTable,renderRounds} from "../ui/table.js";
import {renderStrip} from "../ui/strip.js";
import {renderLeaderboard} from "../ui/leaderboard.js";
import {renderTicker,renderStock} from "../ui/ticker.js";
import {renderChart} from "../ui/chart.js";
import {renderPodium} from "../ui/podium.js";
import {syncSticky} from "../ui/sticky.js";
import {renderSetup,setSetup} from "../ui/setup.js";
import {playIntro} from "../ui/intro.js";

function showGame(){
  $("setup").hidden=true;$("game").hidden=false;$("actions").hidden=false;
  renderTable();renderAll();
}

export function renderAll(){
  const P=G.players,T=totals(G),cur=currentRound(G),done=lastCompleteRound(G),scored=doneCount(G),N=G.cards.length;
  renderRounds(T,cur);
  const ord=ordered(G),first=ord[0],last=ord[ord.length-1];
  renderStrip(T,scored,first,last);
  renderLeaderboard(ord,scored);
  // status + meta
  const finished=cur===-1;
  $("meta").innerHTML=`${P.length} players · ${N} rounds<br>Round <b>${finished?N:cur+1} / ${N}</b> · Trump <b>${TRUMPS[(finished?N-1:cur)%4][0]} ${TRUMPS[(finished?N-1:cur)%4][1]}</b>`;
  const stEl=$("status");
  if(finished){stEl.className="panel status done";stEl.innerHTML=`<p class="big">🏆 Game over</p><b>${first.n}</b> is Sultan-e-Hind with ${fmt(first.tot)}. <b>${last.n}</b> takes the Gaddar slipper at ${fmt(last.tot)}.`;renderPodium(ord)}
  else{const t=TRUMPS[cur%4];stEl.className="panel status";const fb=P[cur%P.length],lb=P[(cur+P.length-1)%P.length];stEl.innerHTML=`<p class="big">Round ${cur+1} · ${t[0]} ${t[1]}</p>${G.cards[cur]} card${G.cards[cur]>1?"s":""} each. <b>${fb.n}</b> opens the bidding, <b>${lb.n}</b> bids last. Enter every bid, play the hand, flip ✓ to ✗ for anyone who missed, then hit <b>Score it</b> in the Status column. Nothing counts until a round is scored. <br><br><b>${scored}</b> of ${N} rounds scored.`;$("podium").hidden=true}
  renderTicker(ord,finished);renderStock(done);renderChart();syncSticky();save();
}

/* called by the setup screen once the seat names and card count validate */
export function startGame(names,m){
  const cards=cardsPerRound(m);
  const keep=G&&G.players.length===names.length&&G.cards.length===cards.length; // editing names mid-game
  setG({players:names.map((n,i)=>({n,c:colorFor(n,i),navy:colorFor(n,i)===NAVY})),cards,
     bids:keep?G.bids:cards.map(()=>names.map(()=>null)),res:keep?G.res:cards.map(()=>names.map(()=>null)),
     done:keep&&Array.isArray(G.done)?G.done:cards.map(()=>false)});
  save();if(keep)showGame();else playIntro(showGame);
}

export function initManual(){
$("table").addEventListener("input",e=>{
  if(e.target.tagName!=="INPUT")return;
  const r=+e.target.dataset.r,p=+e.target.dataset.p,max=G.cards[r];
  let v=e.target.value.trim();
  if(v===""){G.bids[r][p]=null;G.res[r][p]=null;G.done[r]=false} // an incomplete round can't stay scored
  else{let n=Math.floor(+v);if(isNaN(n))return;n=Math.max(0,Math.min(max,n));G.bids[r][p]=n;if(G.res[r][p]==null)G.res[r][p]=1;if(String(n)!==v)e.target.value=n}
  renderAll();
});
$("table").addEventListener("keydown",e=>{ // Enter moves to next bid box
  if(e.key==="Enter"&&e.target.tagName==="INPUT"){const all=[...$("table").querySelectorAll("input:not(:disabled)")];const i=all.indexOf(e.target);if(all[i+1]){all[i+1].focus();all[i+1].select()}}
});
$("table").addEventListener("click",e=>{
  const d=e.target.closest(".donebtn");
  if(d){if(!d.disabled){const r=+d.dataset.r;G.done[r]=!G.done[r];renderAll()}return}
  const b=e.target.closest(".res");if(!b||b.disabled)return;
  const r=+b.dataset.r,p=+b.dataset.p;G.res[r][p]=G.res[r][p]===0?1:0;renderAll();
});
/* ---------- top actions ---------- */
$("btnNew").onclick=()=>{if(!confirm("Start a new game? The current scores will be cleared."))return;setG(null);try{localStorage.removeItem(KEY)}catch(e){}delete $("maxc").dataset.touched;$("maxc").value=10;$("game").hidden=true;$("actions").hidden=true;$("setup").hidden=false;$("meta").textContent="Set the table to begin";renderTicker();renderSetup()};
$("btnEdit").onclick=()=>{setSetup(G.players.length,G.players.map(p=>p.n));$("maxc").value=G.cards[0];$("maxc").dataset.touched=1;$("game").hidden=true;$("setup").hidden=false;renderSetup()};
}

export {showGame};
