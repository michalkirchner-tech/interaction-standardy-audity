// Výsledky auditů: přehledy podle značek a import auditů (admin)
import { supabase } from "./supabase.js?v=20261116h";

export const RESULT_BRANDS = [
  { id: "arval",      name: "Arval",      logo: "assets/logos/arval.png",      wide: true, form: "arval/" },
  { id: "stellantis", name: "Stellantis", logo: "assets/logos/stellantis.svg", wide: true, form: "stellantis/" },
  { id: "mitsubishi", name: "Mitsubishi", logo: "assets/logos/mitsubishi.svg", form: "mitsubishi/" },
];
export const WARN_DAYS = 60; // od kolika dní před termínem je audit „blíží se“

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const czDate = iso => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${+d}. ${+m}. ${y}`; };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysTo = iso => Math.round((new Date(iso + "T00:00:00") - today()) / 86400000);
const addMonths = (iso, m) => { const d = new Date(iso + "T00:00:00"); const day = d.getDate(); d.setMonth(d.getMonth() + m); if (d.getDate() < day) d.setDate(0); return d.toISOString().slice(0, 10); };

export function statusOf(nextIso) {
  if (!nextIso) return { key: "none", label: "", text: "", order: 3, n: null };
  const n = daysTo(nextIso);
  if (n < 0) return { key: "expired", label: "Propadlý", text: `propadl před ${-n} ${n === -1 ? "dnem" : "dny"}`, order: 0, n };
  if (n <= WARN_DAYS) return { key: "soon", label: "Blíží se", text: n === 0 ? "dnes" : `za ${n} ${n === 1 ? "den" : n < 5 ? "dny" : "dní"}`, order: 1, n };
  return { key: "ok", label: "Platný", text: `za ${n} dní`, order: 2, n };
}

// ---------- Načtení dat ----------
export async function loadAudits(brand) {
  const cols = "id,brand,partner,ic,audit_date,valid_months,next_audit_date,result,source,created_at"
    + (brand === "arval" ? ",meta:data->meta,checks:data->checks,esgChecks:data->esgChecks,esgRadio:data->esgRadio" : (brand === "stellantis" || brand === "mitsubishi") ? ",meta:data->meta" : "");
  let q = supabase.from("audits").select(cols).order("next_audit_date");
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
  const html = await fetch(new URL(`../${brand}/index.html`, import.meta.url), { cache: "no-store" }).then(r => r.text());
  let defs;
  if (brand === "mitsubishi") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const el = doc.getElementById("criteria-data");
    if (!el) throw new Error("Nepodařilo se načíst kritéria Mitsubishi – obnovte stránku (Ctrl+F5).");
    defs = JSON.parse(el.textContent);
  } else if (brand === "arval") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const j = id => { const el = doc.getElementById(id); if (!el) throw new Error("Nepodařilo se načíst definice kritérií Arval – obnovte stránku (Ctrl+F5)."); return JSON.parse(el.textContent); };
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

const ARVAL_LEVEL = n => (n ? `Úroveň ${n}` : "Neúspěšný audit");

// Rozpad výsledku Arval: úroveň každé hodnocené části + ESG, u externí karosárny/lakovny i dodavatel
export function arvalBreakdown(state, { CATEGORIES, ESG, NAHRADNI }) {
  const meta = state.meta || {};
  const cats = CATEGORIES.map(cat => {
    const items = cat.sharesNahradni ? cat.items.concat(NAHRADNI.items) : cat.items;
    const per = { 1: [0, 0], 2: [0, 0], 3: [0, 0] };
    for (const it of items) for (let n = it.level; n <= 3; n++) { per[n][1]++; if (state.checks?.[it.id]) per[n][0]++; }
    let level = 0; [1, 2, 3].forEach(n => { if (per[n][1] > 0 && per[n][0] === per[n][1]) level = n; });
    let ext = null;
    if (cat.id === "karoserie" && meta.karoserieExterni === "externi") ext = { name: meta.dodavatelKarosarna || "", ico: meta.dodavatelKarosarnaIco || "" };
    if (cat.id === "lakovna" && meta.lakovnaExterni === "externi") ext = { name: meta.dodavatelLakovna || "", ico: meta.dodavatelLakovnaIco || "" };
    return { id: cat.id, title: cat.title, level, label: ARVAL_LEVEL(level), ext };
  });
  let pts = 0, max = 0;
  for (const g of ESG.groups) for (const it of g.items) {
    if (it.type === "radio" || (!it.type && g.type === "radio")) { max += Math.max(...it.options.map(o => o.points)); const sel = state.esgRadio?.[it.id]; if (sel !== undefined && it.options[sel]) pts += it.options[sel].points; }
    else { max += it.points; if (state.esgChecks?.[it.id]) pts += it.points; }
  }
  let label = "Neúspěšný audit"; ESG.thresholds.forEach(t => { if (pts >= t.min && pts <= t.max) label = t.label; });
  const lvl = (label.match(/(\d)/) || [0, 0])[1] | 0;
  return { cats, esg: { title: "ESG a CSR", level: lvl, label, points: pts, max } };
}

function arvalResult(state, defs) {
  const b = arvalBreakdown(state, defs);
  const txt = c => `${c.title}${c.ext ? " (externí)" : ""}: ${c.label}`;
  return [...b.cats.map(txt), `ESG: ${b.esg.label}`].join(" · ");
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
  return `${unmet === 0 ? "Úspěšný audit" : "Neúspěšný audit"} | ${parts.join(" · ")}`;
}

// Mitsubishi: KO nesplněno => neúspěch; 4 a více nesplněných povinných => neúspěch
export function mitsubishiEval(state, defs) {
  const tot = { KO: [0, 0], P: [0, 0], D: [0, 0] }, per = [];
  let failKO = 0, failP = 0;
  for (const sec of defs.sections) {
    const s = { KO: [0, 0], P: [0, 0], D: [0, 0] };
    for (const it of sec.items) {
      s[it.type][1]++; tot[it.type][1]++;
      if (state.checks?.[it.id]) { s[it.type][0]++; tot[it.type][0]++; }
      else if (it.type === "KO") failKO++; else if (it.type === "P") failP++;
    }
    per.push({ id: sec.id, title: sec.title, ...s });
  }
  const ok = failKO < defs.rules.koFail && failP < defs.rules.povinneFailFrom;
  return { ok, per, tot, failKO, failP };
}
export function mitsubishiRecertEval(state, defs) {
  const rc = defs.recert, tot = { A: 0, C: 0, N: 0, empty: 0 };
  const count = (o, items) => items.forEach(it => { const v = o?.[it.id]; if (v) tot[v]++; else tot.empty++; });
  for (let z = 0; z < rc.orders; z++) count(state.recert?.zakazky?.[z]?.v, rc.orderItems);
  count(state.recert?.procesy, rc.procItems);
  return { ok: tot.N < rc.rules.neFail && tot.C < rc.rules.castFailFrom, tot };
}
function mitsubishiResult(state, defs) {
  if (state.meta?.typAuditu === "recert") {
    const r = mitsubishiRecertEval(state, defs);
    const head = !r.ok ? "Neúspěšný audit" : r.tot.empty ? "Nedokončený audit" : "Úspěšný audit";
    return `${head} | Re-certifikace · Ano ${r.tot.A} · Částečně ${r.tot.C} · Ne ${r.tot.N}`;
  }
  const r = mitsubishiEval(state, defs);
  return `${r.ok ? "Úspěšný audit" : "Neúspěšný audit"} | KO ${r.tot.KO[0]}/${r.tot.KO[1]} · Povinné ${r.tot.P[0]}/${r.tot.P[1]} · Doporučené ${r.tot.D[0]}/${r.tot.D[1]}`;
}

export function detectBrand(state) {
  if (state?.form === "mitsubishi") return "mitsubishi";
  if (state?.meta && "esgChecks" in state) return "arval";
  if (state?.meta && ("radky" in state || "brands" in state.meta)) return "stellantis";
  return null;
}

export async function prepareImport(state, brand) {
  const defs = await formDefs(brand);
  const meta = state.meta || {};
  if (!meta.partner) throw new Error("V souboru chybí název zákazníka (partner).");
  if (!meta.datumAuditu) throw new Error("V souboru chybí datum auditu.");
  const valid = brand === "arval" ? (parseInt(meta.platnostMesicu, 10) || 36) : brand === "mitsubishi" ? (defs.validMonths || 36) : null; // Stellantis: bez recertifikační lhůty
  const result = brand === "arval" ? arvalResult(state, defs) : brand === "mitsubishi" ? mitsubishiResult(state, defs) : stellantisResult(state, defs);
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

export async function arvalDefs() { return formDefs("arval"); }

function lvlBadge(level, label) { return `<span class="lvl lvl-${level}">${esc(label)}</span>`; }

function arvalCells(r, defs) {
  if (!r.checks && !r.meta) return defs.CATEGORIES.map(() => "<td>—</td>").join("") + "<td>—</td>";
  const b = arvalBreakdown({ meta: r.meta, checks: r.checks, esgChecks: r.esgChecks, esgRadio: r.esgRadio }, defs);
  return b.cats.map(c => `<td class="lvl-cell">${lvlBadge(c.level, c.label)}${c.ext ? `<span class="ext">Externí: ${esc(c.ext.name || "neuvedeno")}${c.ext.ico ? `, IČO ${esc(c.ext.ico)}` : ""}</span>` : ""}</td>`).join("")
    + `<td class="lvl-cell">${lvlBadge(b.esg.level, b.esg.label)}<span class="ext">${b.esg.points} / ${b.esg.max} bodů</span></td>`;
}

export function dashboardHtml(brand, rows, isAdmin, defs) {
  if (brand === "stellantis") return stellantisDashboardHtml(rows, isAdmin);
  const arv = brand === "arval" && defs;
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
      <div class="table-wrap"><table class="res-table${arv ? " res-arval" : ""}">
        <thead><tr><th>Stav</th><th>Zákazník</th>${arv ? defs.CATEGORIES.map(c => `<th class="th-lvl">${esc(c.title)}</th>`).join("") + `<th class="th-lvl">ESG a CSR</th>` : "<th>Výsledek</th>"}<th>Datum auditu</th><th>Příští audit</th>${isAdmin ? "<th></th>" : ""}</tr></thead>
        <tbody>
          ${list.map(r => `
          <tr class="st-${r.st.key}" data-q="${esc((r.partner + " " + (r.ic || "")).toLowerCase())}">
            <td><span class="st-badge st-${r.st.key}">${r.st.label}</span></td>
            <td><strong>${esc(r.partner)}</strong>${r.ic ? `<span class="muted">IČ ${esc(r.ic)}</span>` : ""}${r.older ? `<span class="muted">+ ${r.older} starší audit${r.older > 1 ? "y" : ""}</span>` : ""}${brand === "mitsubishi" ? mitExtNote(r.meta) : ""}</td>
            ${arv ? arvalCells(r, defs) : `<td class="res-col">${resultCell(r.result)}</td>`}
            <td class="td-date">${czDate(r.audit_date)}<span class="muted">platnost ${r.valid_months} měs.</span></td>
            <td class="td-date"><strong>${czDate(r.next_audit_date)}</strong><span class="muted">${r.st.text}</span></td>
            ${isAdmin ? `<td><button type="button" class="btn-del" data-del="${r.id}" data-name="${esc(r.partner)}" title="Smazat záznam">Smazat</button></td>` : ""}
          </tr>`).join("")}
        </tbody></table></div>` : `<div class="empty">Zatím zde nejsou žádné audity.${isAdmin ? " Nahrajte první audit tlačítkem výše." : ""}</div>`}
    </div>`;
}

function stellantisDashboardHtml(rows, isAdmin) {
  const list = latestPerCustomer(rows).sort((a, b) => b.audit_date.localeCompare(a.audit_date));
  const ok = r => /^Úspěšný/.test(r.result || "");
  const nOk = list.filter(ok).length;
  return `
    <div class="kpis kpis-3">
      <div class="kpi"><span class="kpi-n">${list.length}</span><span class="kpi-l">Auditovaných zákazníků</span></div>
      <div class="kpi kpi-ok"><span class="kpi-n">${nOk}</span><span class="kpi-l">Úspěšný audit</span></div>
      <div class="kpi kpi-expired"><span class="kpi-n">${list.length - nOk}</span><span class="kpi-l">Neúspěšný audit</span></div>
    </div>
    ${isAdmin ? importBoxHtml("stellantis") : ""}
    <div class="res-card">
      <div class="res-toolbar"><input type="search" id="resSearch" placeholder="Hledat zákazníka nebo IČ…"></div>
      ${list.length ? `
      <div class="table-wrap"><table class="res-table">
        <thead><tr><th>Zákazník</th><th>Výsledek</th><th>Hodnocení oblastí</th><th>Datum auditu</th>${isAdmin ? "<th></th>" : ""}</tr></thead>
        <tbody>
          ${list.map(r => { const [head, detail] = (r.result || "—").split(" | "); return `
          <tr data-q="${esc((r.partner + " " + (r.ic || "")).toLowerCase())}">
            <td><strong>${esc(r.partner)}</strong>${r.ic ? `<span class="muted">IČ ${esc(r.ic)}</span>` : ""}${r.older ? `<span class="muted">+ ${r.older} starší audit${r.older > 1 ? "y" : ""}</span>` : ""}${r.meta?.karosarnaExterni === "externi" ? `<span class="ext-note">Externí karosárna: ${esc(r.meta.ext?.nazev || "neuvedeno")}${r.meta.ext?.ic ? `, IČO ${esc(r.meta.ext.ic)}` : ""}</span>` : ""}</td>
            <td><span class="lvl ${ok(r) ? "lvl-3" : "lvl-0"}">${esc(head)}</span></td>
            <td class="muted-cell">${esc(detail || "")}</td>
            <td class="td-date">${czDate(r.audit_date)}</td>
            ${isAdmin ? `<td><button type="button" class="btn-del" data-del="${r.id}" data-name="${esc(r.partner)}" title="Smazat záznam">Smazat</button></td>` : ""}
          </tr>`; }).join("")}
        </tbody></table></div>` : `<div class="empty">Zatím zde nejsou žádné audity.</div>`}
    </div>`;
}

function mitExtNote(meta) {
  if (!meta) return "";
  return ["karosarna", "lakovna"].filter(k => meta[k + "Stejna"] === false && meta[k]?.nazev)
    .map(k => `<span class="ext-note">${k === "karosarna" ? "Karosárna" : "Lakovna"}: ${esc(meta[k].nazev)}${meta[k].ic ? `, IČO ${esc(meta[k].ic)}` : ""}</span>`).join("");
}

function importBoxHtml(brand) {
  return `
    <div class="import-box">
      <div><strong>Import auditu (admin)</strong><span class="muted">Soubor JSON uložený z formuláře tlačítkem „Uložit koncept“. Naskenované PDF audity převádí Claude – pošlete je v chatu.</span></div>
      <label class="btn-import">Vybrat soubor JSON<input type="file" id="importFile" accept=".json,application/json" multiple hidden></label>
      <div id="importOut" class="import-out"></div>
    </div>`;
}

export { esc, czDate, addMonths };
