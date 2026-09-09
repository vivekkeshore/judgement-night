/* The Supabase client, vendored into app/vendor/ so the game depends on no
   third-party CDN at runtime. It is imported lazily, so a player who only ever
   uses the manual scorekeeper never downloads it. */
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "../config.js";

const VENDORED = "../vendor/supabase-js.js";

let _client = null;

export async function client() {
  if (_client) return _client;
  if (!isConfigured()) throw new Error("Supabase is not configured yet — fill in app/config.js");
  let createClient;
  try {
    ({ createClient } = await import(VENDORED));
  } catch {
    /* deliberately no CDN fallback: vendoring exists so that a third party
       being down cannot break the game. Fail with something actionable. */
    throw new Error("supabase-js is not vendored yet — run: npm run vendor");
  }
  _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
    realtime: { params: { eventsPerSecond: 10 } },
  });
  return _client;
}

/* Anonymous auth gives each browser a durable identity with nothing to sign up
   for. The session is persisted, so a refresh re-binds to the same seat — which
   is exactly what rejoining a room needs. */
export async function signIn() {
  const sb = await client();
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user) return session.user;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error) throw new Error(`could not sign in: ${error.message}`);
  return data.user;
}

export async function currentUserId() {
  const sb = await client();
  const { data: { session } } = await sb.auth.getSession();
  return session?.user?.id ?? null;
}
