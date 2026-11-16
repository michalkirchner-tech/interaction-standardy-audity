// Propojení formulářů (Arval, Stellantis) s databází: „Uložit koncept“ a „Načíst existující“
import { supabase } from "./supabase.js?v=20261116e";
import { prepareImport } from "./results.js?v=20261116e";

const BRAND = location.pathname.includes("/stellantis/") ? "stellantis" : location.pathname.includes("/mitsubishi/") ? "mitsubishi" : "arval";
const BRAND_NAME = { arval: "Arval", stellantis: "Stellantis", mitsubishi: "Mitsubishi" }[BRAND];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const czDate = iso => { if (!iso) return "—"; const [y, m, d] = iso.slice(0, 10).split("-"); return `${+d}. ${+m}. ${y}`; };
const czDateTime = ts => { const d = new Date(ts); return d.toLocaleDateString("cs-CZ") + " " + d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }); };
const norm = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

let currentId = null; // záznam, ze kterého byl formulář načten

// ---------- Okno (modal) ----------
const css = `
.iadb-back{position:fixed;inset:0;background:rgba(20,20,20,.55);z-index:2147483000;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px;font-family:"Open Sans",system-ui,sans-serif}
.iadb-modal{background:#fff;border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.35);width:min(920px,100%);max-height:86vh;display:flex;flex-direction:column;overflow:hidden;color:#1E1E1E}
.iadb-head{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:4px solid #E91929}
.iadb-head h3{margin:0;font:600 1.15rem Poppins,system-ui,sans-serif;flex:1}
.iadb-x{border:0;background:none;font-size:1.6rem;line-height:1;cursor:pointer;color:#777}
.iadb-body{padding:16px 20px;overflow:auto}
.iadb-body input[type=search]{width:100%;padding:10px 12px;border:1px solid #ccc;border-radius:9px;font:inherit;margin-bottom:12px}
.iadb-tbl{width:100%;border-collapse:collapse;font-size:.9rem}
.iadb-tbl th{text-align:left;font:600 .75rem Poppins,system-ui,sans-serif;text-transform:uppercase;color:#666;padding:7px 8px;border-bottom:2px solid #E2E2E2}
.iadb-tbl td{padding:9px 8px;border-bottom:1px solid #eee;vertical-align:top}
.iadb-tbl .mut{display:block;color:#777;font-size:.78rem}
.iadb-btn{border:0;border-radius:9px;padding:8px 14px;font:600 .9rem "Open Sans",system-ui,sans-serif;cursor:pointer;background:#0D4798;color:#fff;white-space:nowrap}
.iadb-btn.red{background:#E91929}.iadb-btn.ghost{background:#fff;color:#1E1E1E;border:1px solid #ccc}
.iadb-btn:disabled{opacity:.6;cursor:default}
.iadb-msg{padding:6px 0;color:#555}.iadb-err{color:#b0101d}
.iadb-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:16px}
.iadb-choice{border:1px solid #E2E2E2;border-radius:10px;padding:10px 12px;margin:8px 0;display:flex;align-items:center;gap:12px}
.iadb-choice>div{flex:1}
`;
function ensureCss() { if (!document.getElementById("iadb-css")) { const s = document.createElement("style"); s.id = "iadb-css"; s.textContent = css; document.head.appendChild(s); } }

function modal(title, html) {
  ensureCss();
  const back = document.createElement("div");
  back.className = "iadb-back no-print";
  back.innerHTML = `<div class="iadb-modal" role="dialog" aria-modal="true"><div class="iadb-head"><h3>${esc(title)}</h3><button class="iadb-x" type="button" aria-label="Zavřít">×</button></div><div class="iadb-body">${html}</div></div>`;
  const close = () => back.remove();
  back.querySelector(".iadb-x").onclick = close;
  back.addEventListener("mousedown", e => { if (e.target === back) close(); });
  document.addEventListener("keydown", function k(e) { if (e.key === "Escape") { close(); document.removeEventListener("keydown", k); } });
  document.body.appendChild(back);
  return { el: back.querySelector(".iadb-body"), close };
}

// ---------- Načíst existující ----------
async function openList(apply) {
  const m = modal("Uložené audity v databázi", `<div class="iadb-msg">Načítám…</div>`);
  const { data, error } = await supabase.from("audits")
    .select("id,partner,ic,audit_date,result,updated_at").eq("brand", BRAND).order("updated_at", { ascending: false });
  if (error) { m.el.innerHTML = `<div class="iadb-err">Seznam se nepodařilo načíst: ${esc(error.message)}</div>`; return; }
  if (!data.length) { m.el.innerHTML = `<div class="iadb-msg">V databázi zatím nejsou žádné uložené audity ${BRAND_NAME}.</div>`; return; }
  m.el.innerHTML = `
    <input type="search" placeholder="Hledat zákazníka nebo IČ…" class="iadb-q">
    <table class="iadb-tbl"><thead><tr><th>Zákazník</th><th>Datum auditu</th><th>Naposledy uloženo</th><th></th></tr></thead><tbody>
    ${data.map(r => `<tr data-q="${esc(norm(r.partner + " " + (r.ic || "")))}">
      <td><strong>${esc(r.partner)}</strong><span class="mut">${r.ic ? "IČ " + esc(r.ic) : ""}</span></td>
      <td>${czDate(r.audit_date)}</td><td>${czDateTime(r.updated_at)}</td>
      <td><button type="button" class="iadb-btn" data-id="${r.id}">Načíst</button></td></tr>`).join("")}
    </tbody></table>
    <p class="iadb-msg">Načtením se nahradí obsah právě otevřeného formuláře.</p>`;
  const q = m.el.querySelector(".iadb-q");
  q.oninput = () => { const v = norm(q.value); m.el.querySelectorAll("tbody tr").forEach(tr => tr.hidden = v && !tr.dataset.q.includes(v)); };
  q.focus();
  m.el.querySelectorAll("[data-id]").forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = "Načítám…";
    const { data: rec, error: e2 } = await supabase.from("audits").select("id,data").eq("id", b.dataset.id).single();
    if (e2) { b.textContent = "Chyba"; alert("Audit se nepodařilo načíst: " + e2.message); return; }
    apply(rec.data);
    currentId = rec.id;
    m.close();
  });
}

// ---------- Uložit koncept ----------
async function writeRecord(rec, overwriteId) {
  if (overwriteId) {
    const { data, error } = await supabase.from("audits").update(rec).eq("id", overwriteId).select("id");
    if (error) throw error;
    if (!data?.length) throw new Error("Tento audit uložil jiný uživatel – přepsat ho může jen on nebo admin. Uložte ho jako nový.");
    return overwriteId;
  }
  const { data, error } = await supabase.from("audits").insert(rec).select("id").single();
  if (error) throw error;
  return data.id;
}

async function save(stateJson, note) {
  let state;
  try { state = JSON.parse(stateJson); } catch { alert("Formulář se nepodařilo přečíst."); return; }
  if (!state.meta?.partner?.trim()) { alert("Nejdřív vyplňte název zákazníka (partnera) v Základních údajích."); return; }
  if (!state.meta?.datumAuditu) { alert("Vyplňte datum auditu."); return; }
  let rec;
  try { rec = await prepareImport(state, BRAND); } catch (e) { alert("Audit nelze uložit: " + e.message); return; }
  rec.source = "form";
  const { data: same, error } = await supabase.from("audits").select("id,partner,ic,audit_date,updated_at").eq("brand", BRAND).order("updated_at", { ascending: false });
  if (error) { alert("Databáze není dostupná: " + error.message); return; }
  const matches = same.filter(r => norm(r.partner) === norm(rec.partner));
  const done = id => { currentId = id; note && note("Uloženo do databáze ✓"); };

  if (!matches.length) {
    try { done(await writeRecord(rec)); } catch (e) { alert("Uložení se nepodařilo: " + e.message); }
    return;
  }
  const m = modal("Zákazník už v databázi existuje", `
    <p>Pro zákazníka <strong>${esc(rec.partner)}</strong> je v databázi už uložený audit. Chcete ho přepsat, nebo uložit tento jako nový?</p>
    ${matches.map(r => `<div class="iadb-choice"><div><strong>${esc(r.partner)}</strong>${r.id === currentId ? " <em>(právě otevřený)</em>" : ""}<span class="iadb-msg" style="display:block;padding:0">Datum auditu ${czDate(r.audit_date)} · naposledy uloženo ${czDateTime(r.updated_at)}</span></div>
      <button type="button" class="iadb-btn red" data-over="${r.id}">Přepsat tento</button></div>`).join("")}
    <div class="iadb-actions"><button type="button" class="iadb-btn" data-new>Uložit jako nový audit</button><button type="button" class="iadb-btn ghost" data-cancel>Zrušit</button></div>
    <div class="iadb-err" data-err></div>`);
  const run = async (id, btn) => {
    m.el.querySelectorAll("button").forEach(b => b.disabled = true); btn.textContent = "Ukládám…";
    try { done(await writeRecord(rec, id)); m.close(); }
    catch (e) { m.el.querySelector("[data-err]").textContent = "Uložení se nepodařilo: " + e.message; m.el.querySelectorAll("button").forEach(b => b.disabled = false); btn.textContent = id ? "Přepsat tento" : "Uložit jako nový audit"; }
  };
  m.el.querySelectorAll("[data-over]").forEach(b => b.onclick = () => run(b.dataset.over, b));
  m.el.querySelector("[data-new]").onclick = e => run(null, e.currentTarget);
  m.el.querySelector("[data-cancel]").onclick = m.close;
}

// Stav připojení OneDrive už se nepoužívá – skrýt
{ const s = document.createElement("style"); s.textContent = "#folderStatus{display:none!important}"; document.head.appendChild(s); }

window.IA_DB = { open: openList, save };
