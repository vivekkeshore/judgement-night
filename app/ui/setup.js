import {$} from "../dom.js";
import {G} from "../state.js";
import {colorFor} from "../../shared/rules.js";
import {syncSticky} from "./sticky.js";

export let setupCount=5, setupNames=["Nivesh","Vivek","Shruti","Prathmesh","Parth"];
export function setSetup(count,names){setupCount=count;setupNames=names}

function renderSetup(){
  $("cnt").value=setupCount;
  const maxc=Math.min(10,Math.floor(52/setupCount));
  $("maxc").max=Math.floor(52/setupCount);
  if(+$("maxc").value>Math.floor(52/setupCount)||!$("maxc").dataset.touched)$("maxc").value=maxc;
  $("maxHint").textContent=`Up to ${Math.floor(52/setupCount)} with ${setupCount} players and one deck.`;
  $("names").innerHTML=Array.from({length:setupCount},(_,i)=>`<div class="nm"><i style="background:${colorFor(setupNames[i]||"",i)}"></i><input type="text" placeholder="Player ${i+1}" value="${(setupNames[i]||"").replace(/"/g,"&quot;")}" data-i="${i}" maxlength="18" aria-label="Player ${i+1} name"></div>`).join("");
  const m=+$("maxc").value;
  $("plan").innerHTML=`<span>Rounds <b>${m*2}</b></span><span>Cards <b>${m} → 1 → ${m}</b></span><span>Trump <b>♥ ♠ ♦ ♣</b> repeating</span>`;
  syncSticky(); // the masthead is pinned on this screen too
}

/* onStart receives the validated seat names and the max cards; the mode module owns what
   happens next, which keeps this file free of any dependency on game state */
export function initSetup(onStart){
$("dec").onclick=()=>{setupCount=Math.max(3,setupCount-1);renderSetup()};
$("inc").onclick=()=>{setupCount=Math.min(8,setupCount+1);renderSetup()};
$("maxc").oninput=e=>{e.target.dataset.touched=1;renderSetup()};
$("names").addEventListener("input",e=>{const i=+e.target.dataset.i;setupNames[i]=e.target.value;e.target.previousElementSibling.style.background=colorFor(e.target.value,i)});
  $("start").onclick=()=>{
  const names=Array.from({length:setupCount},(_,i)=>(setupNames[i]||"").trim());
  if(names.some(n=>!n)){$("err").textContent="Every seat needs a name.";return}
  if(new Set(names.map(n=>n.toLowerCase())).size!==names.length){$("err").textContent="Two players share a name. Make them different.";return}
  const m=Math.max(1,Math.min(+$("maxc").value||1,Math.floor(52/setupCount)));
    onStart(names,m);
  };
}

export {renderSetup};
