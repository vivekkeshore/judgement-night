import {$} from "./dom.js";
import {G,load} from "./state.js";
import {renderSetup,initSetup} from "./ui/setup.js";
import {renderTicker} from "./ui/ticker.js";
import {initLeaderboard} from "./ui/leaderboard.js";
import {syncSticky} from "./ui/sticky.js";
import {placeFigures} from "./ui/strip.js";
import {showGame,startGame,initManual} from "./modes/manual.js";
import {startOnline} from "./modes/online.js";

addEventListener("resize",()=>{syncSticky();placeFigures()});
if(document.fonts)document.fonts.ready.then(syncSticky); // display font changes header height

initLeaderboard();
initSetup(startGame);
initManual();

function chooseManual(){
  $("modepick").hidden=true;$("lobby").hidden=true;$("setup").hidden=false;renderSetup();
}
$("modeManual").onclick=chooseManual;
$("modeOnline").onclick=()=>startOnline();

/* ---------- boot ---------- */
load();renderTicker();$("stock").innerHTML='<span class="hd">JDG · market opens when the first round is dealt</span><span class="hd">JDG · market opens when the first round is dealt</span>';delete $("maxc").dataset.touched;$("maxc").value=10;
/* an unfinished manual game still wins, exactly as before; a shared #CODE link
   goes straight to that table; otherwise ask how they want to play */
if(G&&G.players&&G.cards){showGame()}
else if(/^#[A-Za-z0-9]{4}$/.test(location.hash)){startOnline()}
else{$("modepick").hidden=false}
