// Ochrana podstránek: bez přihlášení přesměruje na úvodní (přihlašovací) stránku.
import { supabase } from "./supabase.js?v=20261120x";
import { registerSW } from "./pwa.js?v=20261120x";
registerSW();

const { data: { session } } = await supabase.auth.getSession();
if (!session) {
  const here = location.pathname.split("/").filter(Boolean).pop() || "";
  location.replace("../?next=" + encodeURIComponent(here + "/"));
} else {
  document.documentElement.classList.remove("ia-guard");
}
