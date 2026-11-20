// Správa uživatelů (jen admin): seznam registrovaných a odstranění uživatele
import { supabase } from "./supabase.js?v=20261120z";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = ts => { if (!ts) return "—"; const d = new Date(ts); return d.toLocaleDateString("cs-CZ") + " " + d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }); };

export async function renderUsers(app, me) {
  document.title = "Uživatelé | INTERACTION";
  app.innerHTML = `
    <section class="brand-page wide-page">
      <a class="back" href="#">← Zpět na úvod</a>
      <div class="brand-head brand-head-plain"><div><h2>Registrovaní uživatelé</h2><p>Kdo má přístup do aplikace. Odstraněný uživatel se už nepřihlásí; audity, které uložil, v databázi zůstanou.</p></div></div>
      <div class="res-card" id="usersBox"><div class="empty">Načítám…</div></div>
    </section>`;
  const box = document.getElementById("usersBox");
  const load = async () => {
    const { data, error } = await supabase.rpc("admin_list_users");
    if (error) { box.innerHTML = `<div class="empty">Seznam se nepodařilo načíst: ${esc(error.message)}</div>`; return; }
    const { data: profs } = await supabase.from("profiles").select("*");
    const aud = new Map((profs || []).map(p => [p.id, p.is_auditor]));
    const hasAud = (profs || []).some(p => "is_auditor" in p);
    box.innerHTML = `
      <p class="f-note">Ostré audity mohou ukládat a přepisovat jen auditoři (a admin), nulté audity kdokoli. Celkem ${data.length} uživatel${data.length === 1 ? "" : data.length < 5 ? "é" : "ů"}.</p>
      <div class="table-wrap"><table class="res-table">
        <thead><tr><th>Jméno</th><th>E-mail</th><th>Role</th>${hasAud ? `<th title="Může ukládat a přepisovat ostré audity">Auditor</th>` : ""}<th>Registrace</th><th>Poslední přihlášení</th><th>Uložené audity</th><th></th></tr></thead>
        <tbody>${data.map(u => `<tr>
          <td><strong>${esc(u.full_name || "—")}</strong></td>
          <td>${esc(u.email)}</td>
          <td>${u.role === "admin" ? `<span class="badge-admin">Admin</span>` : "Uživatel"}</td>
          ${hasAud ? `<td>${u.role === "admin" ? `<span class="muted">ano (admin)</span>` : `<label class="aud-tg"><input type="checkbox" data-aud="${u.id}"${aud.get(u.id) ? " checked" : ""}> ${aud.get(u.id) ? "ano" : "ne"}</label>`}</td>` : ""}
          <td class="td-date">${fmt(u.registered_at)}</td>
          <td class="td-date">${fmt(u.last_sign_in_at)}</td>
          <td>${u.audits}</td>
          <td>${u.id === me.id ? `<span class="muted">to jste vy</span>` : `<button type="button" class="btn-del" data-uid="${u.id}" data-name="${esc(u.full_name || u.email)}" data-mail="${esc(u.email)}">Odstranit</button>`}</td>
        </tr>`).join("")}</tbody></table></div>`;
    box.querySelectorAll("[data-aud]").forEach(c => c.onchange = async () => {
      c.disabled = true;
      const { data: r, error: e } = await supabase.from("profiles").update({ is_auditor: c.checked }).eq("id", c.dataset.aud).select("id");
      if (e || !r?.length) { alert("Změna se nepodařila" + (e ? ": " + e.message : ".")); c.checked = !c.checked; }
      c.disabled = false; c.parentElement.lastChild.textContent = c.checked ? " ano" : " ne";
    });
    box.querySelectorAll("[data-uid]").forEach(b => b.onclick = async () => {
      if (!confirm(`Opravdu odstranit uživatele ${b.dataset.name} (${b.dataset.mail})?\n\nUž se do aplikace nepřihlásí. Audity, které uložil, zůstanou v databázi. Pokud bude přístup znovu potřebovat, musí se zaregistrovat znovu.`)) return;
      b.disabled = true; b.textContent = "Odstraňuji…";
      const { error: e } = await supabase.rpc("admin_delete_user", { p_user: b.dataset.uid });
      if (e) { alert("Odstranění se nepodařilo: " + e.message); b.disabled = false; b.textContent = "Odstranit"; return; }
      load();
    });
  };
  load();
}
