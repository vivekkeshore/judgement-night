/* The Supabase client, loaded from a CDN so the project keeps its no-build-step
   promise. Nothing here is imported until online mode is actually chosen, so a
   player who only ever uses the manual scorekeeper never fetches it. */
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigured } from "../config.js";

const CDN = "https://esm.sh/@supabase/supabase-js@2";

let _client = null;

export async function client() {
  if (_client) return _client;
  if (!isConfigured()) throw new Error("Supabase is not configured yet — fill in app/config.js");
  const { createClient } = await import(/* @vite-ignore */ CDN);
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
