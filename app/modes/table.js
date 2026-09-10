/* The parts of an online table that have nothing to do with which game is being
   played: the room code in the URL, the turn clock, the presence heartbeat, and
   the gate that stops a snapshot landing in the middle of an animation.

   This was lifted out of modes/online.js when Declare arrived rather than copied
   into it — two hand-maintained copies of a nudge stagger is exactly the kind of
   thing that drifts and then only misbehaves on somebody else's screen. */
import { $ } from "../dom.js";

export const hashCode = () =>
  (location.hash.match(/^#([A-Za-z0-9]{4})$/) || [])[1]?.toUpperCase() || "";

/* Shown when app/config.js has never been filled in — otherwise the lobby just
   sits there failing to connect to nothing. */
export function notConfigured(firstMigration = "0001_rooms.sql") {
  $("lobbyBody").innerHTML = `
    <p class="lede">Online play needs a Supabase project — it is free, and nothing here works without it.</p>
    <div class="plan" style="display:block;line-height:1.9">
      <b>1.</b> Create a project at supabase.com<br>
      <b>2.</b> Run <b>supabase/migrations/${firstMigration}</b> in the SQL editor<br>
      <b>3.</b> Enable <b>anonymous sign-ins</b> under Authentication → Providers<br>
      <b>4.</b> Paste the Project URL and anon key into <b>app/config.js</b>
    </div>
    <div class="err">app/config.js is empty, so there is nothing to connect to.</div>`;
}

/* The clock is redrawn every second in place rather than by re-rendering the
   view, which would reset hover, focus and card selection mid-turn. When it runs
   out, whoever notices tells the server; the server re-checks the deadline
   itself, so this cannot be used to hurry anyone. The stagger keeps several
   browsers from all firing the same nudge at the same instant.

   The three getters are read fresh on every tick rather than captured, because
   the mode they belong to reassigns them as the table moves. */
export function makeClock({ code, snap, seat, nudge, heartbeat }) {
  let ticker = null, beat = null, nudging = false;

  function stop() {
    clearInterval(ticker); ticker = null;
    clearInterval(beat);   beat = null;
  }

  function start() {
    stop();
    beat = setInterval(() => { const c = code(); if (c) heartbeat(c); }, 15000);
    ticker = setInterval(async () => {
      const el = document.getElementById("clock");
      const s = snap();
      if (!s || !s.room.deadline || s.room.phase === "game_over") {
        if (el) el.textContent = "";
        return;
      }
      const left = Math.ceil((new Date(s.room.deadline) - Date.now()) / 1000);
      if (el) {
        el.textContent = left > 0 ? `${left}s` : "time";
        el.classList.toggle("urgent", left <= 10);
      }
      if (left > 0 || nudging) return;

      await new Promise(r => setTimeout(r, 250 * (seat() ?? 0)));   // stagger
      if (nudging) return;
      nudging = true;
      try { await nudge(code()); } catch { /* someone else got there first */ }
      finally { nudging = false; }
    }, 1000);
  }

  return { start, stop };
}

/* Animations run against the table as it currently stands, before the new
   snapshot replaces it. Snapshots that arrive mid-animation are held rather than
   dropped, so the table always settles on the latest state rather than on
   whichever one happened to be in flight. */
export function makeGate() {
  let busy = false, held = null;
  return {
    get busy() { return busy; },
    hold(next) { held = next; },
    /* Run `body` with the gate shut, then hand `settle` whichever snapshot is
       newest — the one we started with, or one that arrived while we were busy. */
    async run(next, body, settle) {
      busy = true;
      try { await body(); }
      finally {
        busy = false;
        const latest = held || next;
        held = null;
        settle(latest);
      }
    },
    reset() { busy = false; held = null; },
  };
}
