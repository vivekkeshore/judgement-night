export const KEY="judgement-table-v1";

/* G is an ES live binding: importers always read the current value, but only this module
   may rebind it — hence setG. Property writes (G.bids[r][p]=…) work from anywhere. */
export let G=null; // {players:[{n,c,navy}], cards:[...], bids:[[..]], res:[[..]]}  res: null|1|0
export function setG(v){G=v}

function load(){try{const s=localStorage.getItem(KEY);if(s)G=JSON.parse(s)}catch(e){G=null}
  // saves from before the round toggle existed: a fully-bid round was already counted, so treat it as scored
  if(G&&G.cards&&G.bids&&!Array.isArray(G.done))G.done=G.cards.map((_,r)=>Array.isArray(G.bids[r])&&G.bids[r].every(v=>v!=null));
}
function save(){try{localStorage.setItem(KEY,JSON.stringify(G))}catch(e){}}

export {load,save};
