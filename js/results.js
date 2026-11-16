// Výsledky auditů: přehledy podle značek a import auditů (admin)
import { supabase } from "./supabase.js";

export const RESULT_BRANDS = [
  { id: "arval",      name: "Arval",      logo: "assets/logos/arval.png",      wide: true, form: "arval/" },
  { id: "stellantis", name: "Stellantis", logo: "assets/logos/stellantis.svg", wide: true, form: "stellantis/" },
  { id: "mitsubishi", name: "Mitsubishi", logo: "assets/logos/mitsubishi.svg" },
];
export const WARN_DAYS = 60; // od kolika dní před termínem je audit „blíží se“

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const czDate = iso => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${+d}. ${+m}. ${y}`; };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysTo = iso => Math.round((new Date(iso + "T00:00:00") - today()) / 86400000);
const addMonths = (iso, m) => { const d = new Date(iso + "T00:00:00"); const day = d.getDate(); d.setMonth(d.getMonth() + m); if (d.getDate() < day) d.setDate(0); return d.toISOString().slice(0, 10); };

export function statusOf(nextIso) {
  const n = daysTo(nextIso);
  if (n < 0) return { key: "expired", label: "Propadlý", text: `propadl před ${-n} ${n === -1 ? "dnem" : "dny"}`, order: 0, n };
  if (n <= WARN_DAYS) return { key: "soon", label: "Blíží se", text: n === 0 ? "dnes" : `za ${n} ${n === 1 ? "den" : n < 5 ? "dny" : "dní"}`, order: 1, n };
  return { key: "ok", label: "Platný", text: `za ${n} dní`, order: 2, n };
}

// ---------- Načtení dat ----------
export async function loadAudits(brand) {
  let q = supabase.from("audits").select("id,brand,partner,ic,audit_date,valid_months,next_audit_date,result,source,created_at").order("next_audit_date");
  if (brand) q = q.eq("brand", brand);
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

// Pro přehled: u každého zákazníka (IČ, jinak název) jen jeho nejnovější audit
export function latestPerCustomer(rows) {
  const map = new Map();
  for (const r of rows) {
    const k = r.brand + "|" + (r.ic || r.partner.toLowerCase().trim());
    const cur = map.get(k);
    if (!cur || r.audit_date > cur.audit_date) map.set(k, { ...r, older: (cur ? (cur.older || 0) + 1 : 0) });
    else cur.older = (cur.older || 0) + 1;
  }
  return [...map.values()];
}

// ---------- Výpočet výsledku z JSON formuláře ----------
let defsCache = {};
async function formDefs(brand) {
  if (defsCache[brand]) return defsCache[brand];
  const html = await fetch(`${brand}/index.html`, { cache: "no-store" }).then(r => r.text());
  let defs;
  if (brand === "arval") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const j = id => JSON.parse(doc.getElementById(id).textContent);
    defs = { CATEGORIES: j("categories-data"), ESG: j("esg-data"), NAHRADNI: j("nahradni-data") };
  } else {
    const m = html.match(/var AREAS = (\{[\s\S]*?\n\});/);
    const ra = html.match(/var RESULT_AREAS = (\[[\s\S]*?\]);/);
    const zb = html.match(/var ZINC_BRANDS = (\[[^\]]*\]);/);
    const br = html.match(/var BRANDS = (\[[^\n]*\]);/);
    if (!m || !ra || !zb || !br) throw new Error("Nepodařilo se načíst definice kritérií Stellantis.");
    defs = { AREAS: Function("return " + m[1])(), RESULT_AREAS: Function("return " + ra[1])(), ZINC_BRANDS: Function("return " + zb[1])(), BRANDS: Function("return " + br[1])() };
  }
  return (defsCache[brand] = defs);
}

function arvalResult(state, { CATEGORIES, ESG, NAHRADNI }) {
  const parts = [];
  const levels = [];
  for (const cat of CATEGORIES) {
    if (cat.id === "karoserie" && state.meta?.karoserieExterni === "externi") continue;
    if (cat.id === "lakovna" && state.meta?.lakovnaExterni === "externi") continue;
    const items = cat.sharesNahradni ? cat.items.concat(NAHRADNI.items) : cat.items;
    const per = { 1: [0, 0], 2: [0, 0], 3: [0, 0] };
    for (const it of items) for (let n = it.level; n <= 3; n++) { per[n][1]++; if (state.checks?.[it.id]) per[n][0]++; }
    let lvl = 0; [1, 2, 3].forEach(n => { if (per[n][1] > 0 && per[n][0] === per[n][1]) lvl = n; });
    levels.push(lvl);
    parts.push(`${cat.title}: ${lvl ? "úroveň " + lvl : "nesplněno"}`);
  }
  let pts = 0;
  for (const g of ESG.groups) for (const it of g.items) {
    if (it.type === "radio" || (!it.type && g.type === "radio")) { const sel = state.esgRadio?.[it.id]; if (sel !== undefined && it.options[sel]) pts += it.options[sel].points; }
    else if (state.esgChecks?.[it.id]) pts += it.points;
  }
  let esg = "Neúspěšný audit"; ESG.thresholds.forEach(t => { if (pts >= t.min && pts <= t.max) esg = t.label; });
  const names = parts.filter(p => p.endsWith("nesplněno")).map(p => p.split(":")[0]);
  const head = names.length ? `Nesplněno: ${names.join(", ")}` : `Nejnižší dosažená úroveň ${Math.min(...levels)}`;
  return `${head} · ESG: ${esg} | ${parts.join(" · ")}`;
}

function stellantisResult(state, { AREAS, RESULT_AREAS, ZINC_BRANDS, BRANDS }) {
  const sel = BRANDS.some(b => state.meta?.brands?.[b[0]]);
  const zinc = !sel || ZINC_BRANDS.some(k => state.meta?.brands?.[k]);
  const met = id => !!state.checks?.[id] || (id === "2.2" && !zinc);
  let unmet = 0;
  const parts = RESULT_AREAS.map(r => {
    let d = 0, m = 0; r.ids.forEach(a => AREAS[a].items.forEach(it => { m++; if (met(it[0])) d++; else unmet++; }));
    return `${r.label}: ${d}/${m}`;
  });
  return `${unmet === 0 ? "Splněno ve všech oblastech" : `Nutná náprava (${unmet} nesplněných)`} | ${parts.join(" · ")}`;
}

export function detectBrand(state) {
  if (state?.meta && "esgChecks" in state) return "arval";
  if (state?.meta && ("radky" in state || "brands" in state.meta)) return "stellantis";
  return null;
}

export async function prepareImport(state, brand) {
  const defs = await formDefs(brand);
  const meta = state.meta || {};
  if (!meta.partner) throw new Error("V souboru chybí název zákazníka (partner).");
  if (!meta.datumAuditu) throw new Error("V souboru chybí datum auditu.");
  const valid = brand === "arval" ? (parseInt(meta.platnostMesicu, 10) || 36) : 12;
  const result = brand === "arval" ? arvalResult(state, defs) : stellantisResult(state, defs);
  return { brand, partner: meta.partner.trim(), ic: (meta.ic || "").replace(/\s/g, "") || null, audit_date: meta.datumAuditu, valid_months: valid, result, data: state, source: "import-json" };
}

export async function saveAudit(rec) {
  // stejný zákazník + stejné datum auditu = přepsat existující záznam
  let q = supabase.from("audits").select("id").eq("brand", rec.brand).eq("audit_date", rec.audit_date);
  q = rec.ic ? q.eq("ic", rec.ic) : q.eq("partner", rec.partner);
  const { data: ex, error: e1 } = await q;
  if (e1) throw e1;
  if (ex?.length) {
    const { error } = await supabase.from("audits").update(rec).eq("id", ex[0].id);
    if (error) throw error;
    return "updated";
  }
  const { error } = await supabase.from("audits").insert(rec);
  if (error) throw error;
  return "inserted";
}

export async function deleteAudit(id) {
  const { error } = await supabase.from("audits").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Vykreslení ----------
export function resultCell(result) {
  if (!result) return "—";
  const [head, detail] = result.split(" | ");
  const cls = /Neúspěš|náprava|Nesplněno/i.test(head) ? "res-bad" : "res-ok";
  return `<span class="res-head ${cls}">${esc(head)}</span>${detail ? `<span class="res-detail">${esc(detail)}</span>` : ""}`;
}

export function dashboardHtml(brand, rows, isAdmin) {
  const list = latestPerCustomer(rows).map(r => ({ ...r, st: statusOf(r.next_audit_date) }))
    .sort((a, b) => a.st.order - b.st.order || a.next_audit_date.localeCompare(b.next_audit_date));
  const cnt = k => list.filter(r => r.st.key === k).length;
  return `
    <div class="kpis">
      <div class="kpi"><span class="kpi-n">${list.length}</span><span class="kpi-l">Auditovaných zákazníků</span></div>
      <div class="kpi kpi-expired"><span class="kpi-n">${cnt("expired")}</span><span class="kpi-l">Propadlé audity</span></div>
      <div class="kpi kpi-soon"><span class="kpi-n">${cnt("soon")}</span><span class="kpi-l">Blíží se (do ${WARN_DAYS} dní)</span></div>
      <div class="kpi kpi-ok"><span class="kpi-n">${cnt("ok")}</span><span class="kpi-l">Platné</span></div>
    </div>
    ${isAdmin ? importBoxHtml(brand) : ""}
    <div class="res-card">
      <div class="res-toolbar"><input type="search" id="resSearch" placeholder="Hledat zákazníka nebo IČ…"></div>
      ${list.length ? `
      <div class="table-wrap"><table class="res-table">
        <thead><tr><th>Stav</th><th>Zákazník</th><th>Výsledek</th><th>Datum auditu</th><th>Příští audit</th>${isAdmin ? "<th></th>" : ""}</tr></thead>
        <tbody>
          ${list.map(r => `
          <tr class="st-${r.st.key}" data-q="${esc((r.partner + " " + (r.ic || "")).toLowerCase())}">
            <td><span class="st-badge st-${r.st.key}">${r.st.label}</span></td>
            <td><strong>${esc(r.partner)}</strong>${r.ic ? `<span class="muted">IČ ${esc(r.ic)}</span>` : ""}${r.older ? `<span class="muted">+ ${r.older} starší audit${r.older > 1 ? "y" : ""}</span>` : ""}</td>
            <td class="res-col">${resultCell(r.result)}</td>
            <td>${czDate(r.audit_date)}<span class="muted">platnost ${r.valid_months} měs.</span></td>
            <td><strong>${czDate(r.next_audit_date)}</strong><span class="muted">${r.st.text}</span></td>
            ${isAdmin ? `<td><button type="button" class="btn-del" data-del="${r.id}" data-name="${esc(r.partner)}" title="Smazat záznam">Smazat</button></td>` : ""}
          </tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">Zatím zde nejsou žádné audity.${brand === "mitsubishi" ? " Import auditů Mitsubishi z PDF/XLS doplníme, až dodáte ukázkový soubor." : isAdmin ? " Nahrajte první audit tlačítkem výše." : ""}</div>`}
    </div>`;
}

function importBoxHtml(brand) {
  if (brand === "mitsubishi") return `<div class="import-box"><strong>Import (admin):</strong> pro Mitsubishi zatím není k dispozici – připravíme podle ukázkového PDF/XLS.</div>`;
  return `
    <div class="import-box">
      <div><strong>Import auditu (admin)</strong><span class="muted">Soubor JSON uložený z formuláře tlačítkem „Uložit koncept“. Import z PDF/XLS doplníme v dalším kroku.</span></div>
      <label class="btn-import">Vybrat soubor JSON<input type="file" id="importFile" accept=".json,application/json" multiple hidden></label>
      <div id="importOut" class="import-out"></div>
    </div>`;
}

export { esc, czDate, addMonths };
