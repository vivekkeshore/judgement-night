import {$} from "../dom.js";

/* ---------- roulette intro ---------- */
const WHEEL=[0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const REDS=new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
function rouletteSVG(){
  const n=WHEEL.length,R=240,cx=250,cy=250;let segs="",nums="";
  WHEEL.forEach((v,i)=>{const a0=(i/n)*2*Math.PI-Math.PI/2,a1=((i+1)/n)*2*Math.PI-Math.PI/2;
    const x0=cx+R*Math.cos(a0),y0=cy+R*Math.sin(a0),x1=cx+R*Math.cos(a1),y1=cy+R*Math.sin(a1);
    const ri=150,xi0=cx+ri*Math.cos(a0),yi0=cy+ri*Math.sin(a0),xi1=cx+ri*Math.cos(a1),yi1=cy+ri*Math.sin(a1);
    const col=v===0?"#1E7B4E":REDS.has(v)?"#B3202E":"#161514";
    segs+=`<path d="M${x0},${y0} A${R},${R} 0 0 1 ${x1},${y1} L${xi1},${yi1} A${ri},${ri} 0 0 0 ${xi0},${yi0} Z" fill="${col}" stroke="#D9A441" stroke-width="1.2"/>`;
    const am=(a0+a1)/2,tx=cx+205*Math.cos(am),ty=cy+205*Math.sin(am);
    nums+=`<text x="${tx}" y="${ty}" fill="#F7EBD0" font-family="IBM Plex Mono,monospace" font-size="15" font-weight="600" text-anchor="middle" dominant-baseline="middle" transform="rotate(${am*180/Math.PI+90} ${tx} ${ty})">${v}</text>`;});
  return `<svg viewBox="0 0 500 500" aria-hidden="true">
    <circle cx="250" cy="250" r="248" fill="#5A2A0E"/><circle cx="250" cy="250" r="242" fill="none" stroke="#D9A441" stroke-width="3"/>
    <g class="disc">${segs}${nums}
      <circle cx="250" cy="250" r="150" fill="#3A1608" stroke="#D9A441" stroke-width="3"/>
      <circle cx="250" cy="250" r="118" fill="url(#hub)"/>
      ${[0,45,90,135].map(d=>`<rect x="246" y="132" width="8" height="236" rx="4" fill="#D9A441" transform="rotate(${d} 250 250)"/>`).join("")}
      <circle cx="250" cy="250" r="26" fill="#D9A441" stroke="#7A4C10" stroke-width="3"/>
      <text x="250" y="256" text-anchor="middle" font-family="Bodoni Moda,serif" font-size="22" font-weight="900" fill="#3A1608">J</text>
    </g>
    <g class="ball"><circle cx="250" cy="72" r="11" fill="#FBFAF6" stroke="#B8B5AD" stroke-width="2"/><circle cx="246" cy="68" r="3.5" fill="#fff"/></g>
    <defs><radialGradient id="hub"><stop offset="0" stop-color="#7A4C10"/><stop offset=".7" stop-color="#3A1608"/><stop offset="1" stop-color="#1A0507"/></radialGradient></defs>
  </svg>`;
}
function playIntro(then){
  const el=$("intro");el.className="intro";el.hidden=false;
  el.innerHTML=`<div><div class="wheel"><div class="rail"></div>${rouletteSVG()}</div><div class="cap">Setting the table<small>Shakuni is shuffling…</small></div></div>`;
  const reduced=matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(()=>{el.classList.add("out");then();$("game").classList.add("reveal");
    setTimeout(()=>{el.hidden=true;el.innerHTML="";$("game").classList.remove("reveal")},1000)},reduced?1200:3200);
}

export {playIntro};
