/* The round-by-round score table for online play: read-only, since the server
   owns every number here. It deliberately reuses the manual table's classes so
   it inherits the sticky Rd/Trump columns, the player colours and the footer
   styling rather than growing a parallel set. */
import { $ } from "../dom.js";
import { TRUMPS, fmt, colorFor } from "../../shared/rules.js";

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));

export function renderScoreTable(snap, mountId = "scoretable") {
  const { seats, rounds, allBids = [], results = [], room } = snap;
  if (!rounds.length) { $(mountId).innerHTML = ""; return; }

  const bidAt = new Map(allBids.map(b => [`${b.round}:${b.seat}`, b.bid]));
  const resAt = new Map(results.map(r => [`${r.round}:${r.seat}`, r]));
  const totals = seats.map(s =>
    results.filter(r => r.seat === s.seat).reduce((a, r) => a + r.points, 0));

  let h = `<thead><tr>
      <th rowspan="2" class="rd">Rd</th>
      <th rowspan="2" class="trp">Trump</th>
      <th rowspan="2">Cards</th>
      ${seats.map(s => `<th colspan="3" class="p" style="--pc:${colorFor(s.name, s.seat)}">${esc(s.name)}</th>`).join("")}
    </tr><tr>${seats.map(() => `<th>Bid</th><th>Won</th><th>Pts</th>`).join("")}</tr></thead><tbody>`;

  for (const r of rounds) {
    const t = TRUMPS.find(x => x[3] === r.trump) || TRUMPS[0];
    const isNow = r.round === room.round && room.phase !== "game_over";
    const scored = seats.some(s => resAt.has(`${r.round}:${s.seat}`));
    h += `<tr class="${isNow ? "cur" : ""} ${scored ? "" : "pending"}">
      <td class="rnd">${r.round + 1}</td>
      <td class="trump ${t[2]}">${t[0]} ${t[1]}</td>
      <td class="cards">${r.cards}</td>`;
    for (const s of seats) {
      const bid = bidAt.get(`${r.round}:${s.seat}`);
      const res = resAt.get(`${r.round}:${s.seat}`);
      const hit = res && res.tricks_won === bid;
      h += `<td>${bid === undefined ? "" : bid}</td>
            <td class="${res ? (hit ? "won" : "missed") : ""}">${res ? res.tricks_won : ""}</td>
            <td class="pts ${res ? (hit ? "ok" : "no") : ""}">${res ? fmt(res.points) : ""}</td>`;
    }
    h += `</tr>`;
  }

  h += `</tbody><tfoot><tr><td colspan="3">Total</td>${
    seats.map((s, i) => `<td colspan="3" class="tot ${totals[i] < 0 ? "neg" : ""}">${fmt(totals[i])}</td>`).join("")
  }</tr></tfoot>`;

  $(mountId).innerHTML = h;
}
