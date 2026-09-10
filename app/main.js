import {$} from "./dom.js";
import {G,load} from "./state.js";
import {renderSetup,initSetup} from "./ui/setup.js";
import {renderTicker} from "./ui/ticker.js";
import {initLeaderboard} from "./ui/leaderboard.js";
import {syncSticky} from "./ui/sticky.js";
import {placeFigures} from "./ui/strip.js";
import {showGame,startGame,initManual} from "./modes/manual.js";
import {startOnline} from "./modes/online.js";
import {startDeclare} from "./modes/declare.js";
import {roomGame} from "./net/room.js";

addEventListener("resize",()=>{syncSticky();placeFigures()});
if(document.fonts)document.fonts.ready.then(syncSticky); // display font changes header height

initLeaderboard();
initSetup(startGame);
initManual();

/* ---------- which game, then how ---------- */
function chooseManual(){
  $("modepick").hidden=true;$("judgepick").hidden=true;$("lobby").hidden=true;$("setup").hidden=false;renderSetup();
}
$("pickJudgement").onclick=()=>{$("modepick").hidden=true;$("judgepick").hidden=false};
$("pickDeclare").onclick=()=>startDeclare();
$("backToGames").onclick=()=>{$("judgepick").hidden=true;$("modepick").hidden=false};
$("modeManual").onclick=chooseManual;
$("modeOnline").onclick=()=>startOnline();

/* A shared #CODE link says which table but not which game. Rather than growing
   the link format — and breaking every code already handed out — ask the server
   what that room is playing and open the matching client. */
async function openRoom(code){
  try{
    if(await roomGame(code)==="declare")return startDeclare();
  }catch{/* fall through to Judgement, which is what every old room is */}
  return startOnline();
}

/* ---------- boot ---------- */
load();renderTicker();$("stock").innerHTML='<span class="hd">JDG · market opens when the first round is dealt</span><span class="hd">JDG · market opens when the first round is dealt</span>';delete $("maxc").dataset.touched;$("maxc").value=10;
/* an unfinished manual game still wins, exactly as before; a shared #CODE link
   goes straight to that table; otherwise ask what they want to play */
if(G&&G.players&&G.cards){showGame()}
else if(/^#[A-Za-z0-9]{4}$/.test(location.hash)){openRoom(location.hash.slice(1).toUpperCase())}
else{$("modepick").hidden=false}
