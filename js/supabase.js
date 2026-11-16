// Připojení k databázi Supabase (veřejný klíč – smí být v prohlížeči, data chrání pravidla v databázi)
// Knihovna Supabase je uložená přímo v aplikaci (js/vendor) a načítá se jako klasický skript.
async function loadLib() {
  if (window.supabase?.createClient) return window.supabase;
  const src = new URL("./vendor/supabase-2.119.0.js", import.meta.url).href;
  await new Promise((ok, fail) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
  return window.supabase;
}
const { createClient } = await loadLib();

export const SUPABASE_URL = "https://riushizxtpdbedoeicss.supabase.co";
export const SUPABASE_KEY = "sb_publishable_59o4aqSuNo1OCTJ-2UcuDA_Li10_DNW";

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: "ia-standardy-audity-auth" },
});

export async function getProfile() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  const { data } = await supabase.from("profiles").select("id,email,full_name,role").eq("id", session.user.id).single();
  return data || { id: session.user.id, email: session.user.email, full_name: "", role: "user" };
}
