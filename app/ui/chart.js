import {$} from "../dom.js";
import {G} from "../state.js";
import {cum,ordered,lastCompleteRound,fmt} from "../../shared/rules.js";

/* ---------- chart ---------- */
function renderChart(){
  const N=G.cards.length,W=1000,H=380,ml=50,mr=120,mt=16,mb=36;
  const series=G.players.map((p,i)=>({...p,c2:cum(G,i)}));
  const upto=lastCompleteRound(G);
  const all=series.flatMap(s=>s.c2.slice(0,upto+1));const lo=Math.min(...all,0),hi=Math.max(...all,10);
  const step=hi-lo>150?50:25;const y0=Math.floor(lo/step)*step,y1=Math.ceil(hi/step)*step||step;
  const x=r=>ml+(r/N)*(W-ml-mr),y=v=>mt+(1-(v-y0)/(y1-y0))*(H-mt-mb);
  let g="";
  for(let v=y0;v<=y1;v+=step)g+=`<line x1="${ml}" x2="${W-mr}" y1="${y(v)}" y2="${y(v)}" stroke="${v===0?'#161514':'#ECE9E0'}" stroke-width="${v===0?1.5:1}"/><text x="${ml-8}" y="${y(v)+4}" text-anchor="end" font-family="IBM Plex Mono,monospace" font-size="11" fill="#7C7A74">${v}</text>`;
  const tick=N>20?4:2;for(let r=0;r<=N;r+=tick)g+=`<text x="${x(r)}" y="${H-12}" text-anchor="middle" font-family="IBM Plex Mono,monospace" font-size="11" fill="#7C7A74">${r===0?'start':'R'+r}</text>`;
  if(upto===0){g+=`<text x="${(ml+W-mr)/2}" y="${H/2}" text-anchor="middle" font-family="Libre Franklin,sans-serif" font-size="15" fill="#7C7A74">Lines appear once the first round is scored</text>`;}
  const ord=ordered(G),topTot=ord[0].tot;
  series.forEach(s=>{if(upto===0)return;const d=s.c2.slice(0,upto+1).map((v,i)=>`${i?'L':'M'}${x(i)},${y(v)}`).join(" ");
    g+=`<path d="${d}" fill="none" stroke="${s.c}" stroke-width="${s.c2[upto]===topTot?3.5:2.2}" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(upto)}" cy="${y(s.c2[upto])}" r="4.5" fill="${s.c}" stroke="#FBFAF6" stroke-width="2"/>`;});
  if(upto>0){const ends=series.map(s=>({s,yy:y(s.c2[upto])})).sort((a,b)=>a.yy-b.yy);for(let i=1;i<ends.length;i++)if(ends[i].yy-ends[i-1].yy<15)ends[i].yy=ends[i-1].yy+15;
    ends.forEach(e=>{g+=`<text x="${x(upto)+10}" y="${e.yy+4}" font-family="Libre Franklin,sans-serif" font-size="12.5" font-weight="600" fill="${e.s.c}">${e.s.n} <tspan font-family="IBM Plex Mono,monospace" font-weight="500">${fmt(e.s.c2[upto])}</tspan></text>`;});}
  $("chart").innerHTML=g;
  $("legend").innerHTML=series.map(s=>`<span><i style="background:${s.c}"></i>${s.n}</span>`).join("")+`<span style="margin-left:auto">Thick line = current leader</span>`;
  // the loser's clip rides the end of the lowest line, in the chart's own coordinates
  const lowest=ord[ord.length-1];
  placeUdta(upto>0&&ord[0].tot!==lowest.tot ? {x:x(upto),y:y(cum(G,lowest.i)[upto]),H} : null);
}

/* ---------- udta hi firu — pinned to the end of the last-placed line ---------- */
/* Muted and paused on its poster until hovered, so the clip itself is not fetched until
   someone actually asks for it. Sound needs a user gesture: hover alone does not grant one,
   but any earlier click on the page (scoring a round, say) usually does. If the browser still
   refuses, we retry muted so at least the picture plays. */

function placeUdta(at){
  const wrap=$("chartwrap");if(!wrap)return;
  let el=wrap.querySelector(".udta");
  if(!at){if(el)el.remove();return}
  if(!el){
    el=document.createElement("div");el.className="udta";
    el.title="Hover to play with sound";
    el.innerHTML=`<span class="hint">♪ hover</span>`
      +`<video src="static/udta_hi_firu.mp4" poster="static/udta_poster.jpg" muted loop playsinline preload="none" disablepictureinpicture></video>`;
    const v=el.querySelector("video");
    const start=()=>{el.classList.add("on");v.muted=false;v.currentTime=0;
      v.play().catch(()=>{v.muted=true;v.play().catch(()=>{})})};
    const stop=()=>{el.classList.remove("on");v.pause();v.currentTime=0;v.muted=true};
    // mouseover/out bubble from the pill and the clip, so moving between the two does not stop it
    el.addEventListener("mouseover",start);
    el.addEventListener("mouseout",e=>{if(!el.contains(e.relatedTarget))stop()});
    el.addEventListener("click",()=>{v.paused?start():stop()});   // touch screens have no hover
    wrap.appendChild(el);
  }
  /* Always hang below the line end: the space under the last-placed line is empty, whereas
     everything above it is other players' lines and their end labels. When the line sits too
     low to fit, slide up only as far as the chart's bottom edge rather than flipping over. */
  // convert the card's pixel height into chart units so the clamp stays honest at any size
  const svgH=$("chart").getBoundingClientRect().height||1;
  const hUnits=el.offsetHeight/svgH*at.H;
  const top=Math.min(at.y+8,at.H-hUnits);
  el.style.left=(at.x/1000*100)+"%";
  el.style.top=(top/at.H*100)+"%";
  el.style.transform="translateX(-50%)";
}

export {renderChart};
