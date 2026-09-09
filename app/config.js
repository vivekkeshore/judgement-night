/* Paste these two values from your Supabase project:
   Dashboard → Project Settings → API → Project URL and anon/public key.

   The anon key is safe to commit — it only ever grants what Row Level Security
   allows, and this schema gives clients no write access at all. */
export const SUPABASE_URL = "";
export const SUPABASE_ANON_KEY = "";

export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
