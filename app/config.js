/* Paste these two values from your Supabase project:
   Dashboard → Project Settings → API → Project URL and anon/public key.

   The anon key is safe to commit — it only ever grants what Row Level Security
   allows, and this schema gives clients no write access at all. */
export const SUPABASE_URL = "https://vuarglqseyaohlaxedlw.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ1YXJnbHFzZXlhb2hsYXhlZGx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5Njc1ODMsImV4cCI6MjEwNDU0MzU4M30.TygXlyqrqEj6VSFWdAc0Iib4EAwlW8mX6USEcnCDiuU";

export const isConfigured = () => Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
