/* Declare's round-by-round table: read-only, since the server owns every number.
   It reuses the manual table's classes so it inherits the sticky first column,
   the player colours and the footer styling rather than growing a parallel set.

   Two numbers per player per round: the count they were caught with, and what
   that cost them. They are not the same — a player lower than the declarer is
   caught with cards and still scores nothing — and showing only the points
   would hide the reason. A ✋ marks whoever declared. */
import { $ } from "../dom.js";
import { colorFor } from "../../shared/rules.js";

const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));

export function renderDeclareScores(snap, mountId = "scoretable") {
  const { seats, rounds, results = [], room } = snap;
  if (!rounds.length) { $(mountId).innerHTML = ""; return; }

  const at = new Map(results.map(r => [`${r.round}:${r.seat}`, r]));
  const totals = seats.map(s =>
    results.filter(r => r.seat === s.seat).reduce((a, r) => a + r.points, 0));
  const best = totals.length ? Math.min(...totals) : 0;

  let h = `<thead><tr>
      <th rowspan="2" class="rd">Rd</th>
      <th rowspan="2" class="trp">Declared</th>
      ${seats.map(s => `<th colspan="2" class="p" style="--pc:${colorFor(s.name, s.seat)}">${esc(s.name)}</th>`).join("")}
    </tr><tr>${seats.map(() => `<th>Count</th><th>Pts</th>`).join("")}</tr></thead><tbody>`;

  for (const r of rounds) {
    const isNow = r.round === room.round && room.phase !== "game_over";
    const declarer = seats.find(s => at.get(`${r.round}:${s.seat}`)?.declared);
    const scored = seats.some(s => at.has(`${r.round}:${s.seat}`));
    h += `<tr class="${isNow ? "cur" : ""} ${scored ? "" : "pending"}">
      <td class="rnd">${r.round + 1}</td>
      <td class="trump">${declarer ? esc(declarer.name) : (isNow ? "in play" : "")}</td>`;
    for (const s of seats) {
      const res = at.get(`${r.round}:${s.seat}`);
      /* "clean" is a round that cost nothing: either you declared and got away
         with it, or you were lower than whoever did. */
      const clean = res && res.points === 0;
      h += `<td>${res ? res.hand_count : ""}${res && res.declared ? ' <span title="declared this round">✋</span>' : ""}</td>
            <td class="pts ${res ? (clean ? "ok" : "no") : ""}">${res ? res.points : ""}</td>`;
    }
    h += `</tr>`;
  }

  h += `</tbody><tfoot><tr><td colspan="2">Total · lowest wins</td>${
    seats.map((s, i) => `<td colspan="2" class="tot ${totals[i] === best ? "won" : ""}">${totals[i]}</td>`).join("")
  }</tr></tfoot>`;

  $(mountId).innerHTML = h;
}
