import {$} from "../dom.js";
import {G} from "../state.js";
import {TRUMPS,pts,fmt} from "../../shared/rules.js";

function renderTable(){
  const P=G.players;
  let h=`<thead><tr><th rowspan="2" class="rd">Rd</th><th rowspan="2" class="trp">Trump</th><th rowspan="2">Cards</th>${P.map(p=>`<th colspan="3" class="p" style="--pc:${p.c}">${p.n}</th>`).join("")}<th rowspan="2" class="st">Status</th></tr><tr>${P.map(()=>`<th>Bid</th><th>Result</th><th>Pts</th>`).join("")}</tr></thead><tbody>`;
  G.cards.forEach((c,r)=>{const t=TRUMPS[r%4];
    h+=`<tr data-r="${r}"><td class="rnd">${r+1}</td><td class="trump ${t[2]}">${t[0]} ${t[1]}</td><td class="cards">${c}</td>`;
    P.forEach((p,i)=>{h+=`<td class="bid"><input type="number" inputmode="numeric" min="0" max="${c}" data-r="${r}" data-p="${i}" aria-label="${p.n} bid round ${r+1}"></td><td><button class="res" data-r="${r}" data-p="${i}" aria-label="${p.n} result round ${r+1}">–</button></td><td class="pts ${p.navy?'navy':''}"></td>`;});
    h+=`<td class="done"><button class="donebtn" data-r="${r}" aria-label="Mark round ${r+1} complete">–</button></td></tr>`;});
  h+=`</tbody><tfoot><tr><td colspan="3">Total</td>${P.map(p=>`<td colspan="3" class="tot ${p.navy?'navy':''}"></td>`).join("")}<td></td></tr></tfoot>`;
  $("table").innerHTML=h;
}

/* the per-round cells, mutated in place rather than rebuilt, so the focused input and the
   sticky Rd/Trump columns survive every keystroke */
export function renderRounds(T,cur){
  const P=G.players;
  G.cards.forEach((c,r)=>{
    const tr=$("table").querySelector(`tr[data-r="${r}"]`);
    const locked=false; // every round stays editable, like the spreadsheet
    tr.classList.toggle("cur",r===cur);tr.classList.toggle("locked",false);
    let sum=0,n=0;
    P.forEach((p,i)=>{
      const b=G.bids[r][i],inp=tr.querySelector(`input[data-p="${i}"]`),btn=tr.querySelector(`.res[data-p="${i}"]`),pt=tr.children[3+i*3+2];
      if(document.activeElement!==inp)inp.value=b==null?"":b;
      inp.disabled=locked;
      const wrong=G.res[r][i]===0;
      btn.disabled=b==null;btn.className="res "+(b==null?"":wrong?"no":"ok");btn.textContent=b==null?"–":wrong?"✗":"✓";
      btn.title=b==null?"Enter a bid first":wrong?"Marked wrong. Click to mark correct":"Correct. Click to mark wrong";
      pt.className="pts "+(b==null?"":wrong?"no":"ok")+(p.navy?" navy":"");pt.textContent=b==null?"":fmt(pts(b,!wrong));
      if(b!=null){sum+=b;n++}
    });
    // bidding order: first bidder moves one seat clockwise each round; last bidder is the seat before
    const firstB=r%P.length,lastB=(firstB+P.length-1)%P.length;
    const others=G.bids[r].reduce((t,v,i)=>i===lastB?t:(v==null?t:t+v),0);
    const othersDone=G.bids[r].every((v,i)=>i===lastB||v!=null);
    const banned=othersDone?c-others:null;   // the one bid the last player may not make
    const lastBid=G.bids[r][lastB];
    P.forEach((p,i)=>{const td=tr.children[3+i*3];td.classList.toggle("starts",i===firstB);td.classList.toggle("lastb",i===lastB);td.classList.toggle("bad",i===lastB&&banned!=null&&banned>=0&&lastBid===banned)});
    // status toggle: a round can only be completed once every bid is in
    const bad=banned!=null&&banned>=0&&lastBid===banned;
    const full=n===P.length,on=!!G.done[r];
    const dn=tr.querySelector(".donebtn");
    dn.disabled=!full;
    dn.className="donebtn"+(on?" on":full?" ready":"");
    dn.textContent=on?"✓ Scored":full?"Score it":"–";
    dn.setAttribute("aria-pressed",on?"true":"false");
    dn.title=!full?`All ${P.length} bids needed before round ${r+1} can be scored — ${n} of ${P.length} in.`
      :on?`Round ${r+1} is counted in every total. Click to reopen it and pull it back out.`
      :`Bids total ${sum} / ${c}. Click to score round ${r+1} and add it to the totals.`+(bad?` Warning: ${P[lastB].n}'s bid makes the total equal the cards dealt, which is not allowed.`:"");
    tr.classList.toggle("pending",!on);
  });
  P.forEach((p,i)=>{const td=$("table").querySelectorAll("tfoot .tot")[i];td.textContent=fmt(T[i]);td.classList.toggle("neg",T[i]<0)});
}

export {renderTable};
