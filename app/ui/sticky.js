import {$} from "../dom.js";

/* keep the sticky offsets honest — every pinned band changes height (reduced motion wraps
   the ticker, the masthead wraps when narrow, player count changes the strip, fonts load late) */
function syncSticky(){
  const rs=document.documentElement.style;
  const th=Math.round(document.querySelector(".ticker").getBoundingClientRect().height);
  rs.setProperty("--tickerh",th+"px");
  const mh=Math.round(document.querySelector(".mast").getBoundingClientRect().height);
  rs.setProperty("--mastbottom",(th+mh)+"px");
  const sh=Math.round($("strip").getBoundingClientRect().height);
  rs.setProperty("--stripbottom",(th+mh+sh)+"px");
  // th.p spans only the first header row, so its height is that row's height
  const h1=$("table").querySelector("thead th.p");
  if(h1)rs.setProperty("--hdr1",Math.round(h1.getBoundingClientRect().height)+"px");
  // floor the Rd width so Trump overlaps it a hair rather than leaving a scrolling gap
  const c1=$("table").querySelector("thead th.rd");
  if(c1)rs.setProperty("--col1",Math.floor(c1.getBoundingClientRect().width)+"px");
}

export {syncSticky};
