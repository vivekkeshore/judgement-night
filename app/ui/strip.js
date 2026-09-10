import {$} from "../dom.js";
import {G} from "../state.js";
import {fmtFor} from "../../shared/rules.js";

export function renderStrip(T,scored,first,last){
  const P=G.players;
  const stripEl=$("strip");
  stripEl.style.setProperty("--n",P.length);
  const cards=P.map((p,i)=>`<div class="pp ${scored>0&&i===first.i?"lead":""} ${i===fallenSeat?"fell":""}" style="--pc:${p.c}"><div class="n">${T[i]===first.tot&&scored>0?"👑 ":""}${p.n}${T[i]===last.tot&&last.tot!==first.tot&&scored>0?" 🩴":""}</div><div class="v ${T[i]<0?'neg':''} ${p.navy?'navy':''}">${fmtFor(G,T[i])}</div></div>`).join("");
  // replace only the player cards — the apsara is a sibling and must survive the re-render,
  // or her dance restarts on every keystroke
  stripEl.querySelectorAll(".pp").forEach(n=>n.remove());
  stripEl.insertAdjacentHTML("afterbegin",cards);
  renderApsara(scored>0?first.i:null);
}

/* ---------- figures on the strip ---------- */
/* The apsara stands on the leading player's card. When the lead changes, the seat she leaves
   is the dethroned king, and the Bahubali clips start burning on that card instead — playing
   one after the other on a loop until the next lead change moves them on.
   Both are persistent DOM nodes: renderAll swaps the .pp cards around them, so their playback
   is never restarted by a keystroke. */
const APSARA_HTML=`<div class="niche"><img src="static/apsara_dance.webp" alt=""></div><div class="base"></div>`;
const FALLEN_HTML=`<div class="niche"></div><div class="base"></div>`;
const FALLEN_CLIPS=["static/bahubali1.mp4","static/bahubali2.mp4"];
// read the crossing time off --apflight so the CSS stays the single source of truth
const FLIGHT=(parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--apflight"))||2.6)*1000;
let apsaraSeat=null, fallenSeat=null, flightT=null, fallT=null;
const prefersReduced=()=>matchMedia("(prefers-reduced-motion: reduce)").matches;

// re-measure a figure's spot: card widths move with the window and with the player count
function placeFigure(el,seat){
  if(!el||seat==null)return;
  const c=$("strip").querySelectorAll(".pp")[seat];if(!c)return;
  el.style.setProperty("--as",Math.min(1,Math.max(.5,c.offsetWidth/150)).toFixed(2));
  el.style.setProperty("--ax",(c.offsetLeft+c.offsetWidth/2-el.offsetWidth/2)+"px"); // offsetWidth ignores the scale, which is what we want
}
function placeFigures(){
  const strip=$("strip");
  placeFigure(strip.querySelector(".apsara"),apsaraSeat);
  placeFigure(strip.querySelector(".fallen"),fallenSeat);
}

// shared arrival/glide plumbing for both figures
function moveFigure(el,from,to,onArrive){
  const strip=$("strip"),cards=strip.querySelectorAll(".pp");
  const moving=from!=null&&from!==to&&cards[from];
  if(moving&&!prefersReduced()){
    el.style.setProperty("--lean",(cards[to].offsetLeft>cards[from].offsetLeft?5:-5)+"deg");
    el.classList.remove("flying");void el.offsetWidth;el.classList.add("flying"); // restart the glide
    return setTimeout(()=>{el.classList.remove("flying");if(onArrive)onArrive()},FLIGHT);
  }
  return null;
}

function renderApsara(seat){
  const strip=$("strip");let a=strip.querySelector(".apsara");
  if(seat==null){if(a)a.remove();apsaraSeat=null;renderFallen(null);return} // nothing scored yet — no one to dance for
  const cards=strip.querySelectorAll(".pp");if(!cards[seat])return;
  const arriving=!a;
  if(arriving){a=document.createElement("div");a.className="fig apsara noanim";a.setAttribute("aria-hidden","true");
    a.innerHTML=`<div class="lift">${APSARA_HTML}</div>`;strip.appendChild(a)}
  const dethroned=!arriving&&apsaraSeat!=null&&apsaraSeat!==seat?apsaraSeat:null;
  if(dethroned!=null){
    clearTimeout(flightT);
    flightT=moveFigure(a,apsaraSeat,seat,()=>{
      const t=$("strip").querySelectorAll(".pp")[seat];if(t&&apsaraSeat===seat)t.classList.add("blessed")});
  }
  apsaraSeat=seat;
  placeFigure(a,seat);
  // she takes her first spot outright — without this she glides in from the strip's left edge
  if(arriving){void a.offsetWidth;a.classList.remove("noanim")}
  if(dethroned!=null)renderFallen(dethroned);   // the seat she left is the fallen king
}

/* the dethroned player's card. Only ever set by renderApsara, because who fell is a fact about
   history — the current standings alone cannot tell you who used to be on top. */
function renderFallen(seat){
  const strip=$("strip");let f=strip.querySelector(".fallen");
  if(seat==null){if(f)f.remove();fallenSeat=null;return}
  const cards=strip.querySelectorAll(".pp");if(!cards[seat])return;
  const arriving=!f;
  if(arriving){f=document.createElement("div");f.className="fig fallen noanim";f.setAttribute("aria-hidden","true");
    f.innerHTML=`<div class="lift">${FALLEN_HTML}</div>`;strip.appendChild(f)}
  const changed=arriving||fallenSeat!==seat;
  if(!arriving){clearTimeout(fallT);fallT=moveFigure(f,fallenSeat,seat)}
  fallenSeat=seat;
  // the cards were built from the previous fallenSeat, so clear the old ring before marking
  cards.forEach(c=>c.classList.remove("fell"));
  cards[seat].classList.add("fell");
  placeFigure(f,seat);
  if(arriving){void f.offsetWidth;f.classList.remove("noanim")}
  if(changed)playFallenClips(f);   // a fresh dethroning restarts the sequence at bahubali1
}
/* bahubali1 then bahubali2 then round again. The <video> carries no loop attribute, so "ended"
   fires and we advance; rebuilding the element each time avoids stacking listeners. */
function playFallenClips(el){
  const niche=el.querySelector(".niche");
  niche.innerHTML=`<video muted playsinline preload="auto" disablepictureinpicture></video>`;
  const v=niche.querySelector("video");
  let i=0;
  const next=()=>{v.src=FALLEN_CLIPS[i++%FALLEN_CLIPS.length];v.play().catch(()=>{})};
  v.addEventListener("ended",next);
  v.muted=true;                     // the property, not just the attribute — autoplay is refused without it
  next();
}

export {renderApsara,renderFallen,placeFigures};
