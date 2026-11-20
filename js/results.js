// Výsledky auditů: přehledy podle značek a import auditů (admin)
import { supabase } from "./supabase.js?v=20261120r";

export const RESULT_BRANDS = [
  { id: "arval",      name: "Arval",      logo: "assets/logos/arval.png",      wide: true, form: "arval/" },
  { id: "stellantis", name: "Stellantis", logo: "assets/logos/stellantis.svg", wide: true, form: "stellantis/" },
  { id: "mitsubishi", name: "Mitsubishi", logo: "assets/logos/mitsubishi.svg", form: "mitsubishi/" },
];
export const NO_VALIDITY = new Set(["stellantis", "volvo"]); // značky bez recertifikační lhůty (jen úspěšný / neúspěšný)
export const WARN_DAYS = 60; // od kolika dní před termínem je audit „blíží se“

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const czDate = iso => { if (!iso) return "—"; const [y, m, d] = iso.split("-"); return `${+d}. ${+m}. ${y}`; };
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const daysTo = iso => Math.round((new Date(iso + "T00:00:00") - today()) / 86400000);
const addMonths = (iso, m) => { const d = new Date(iso + "T00:00:00"); const day = d.getDate(); d.setMonth(d.getMonth() + m); if (d.getDate() < day) d.setDate(0); return d.toISOString().slice(0, 10); };

// Nultý audit je jednorázový – nemá termín příštího auditu
export const NULTY_ST = { key: "none", label: "Nultý audit", text: "jednorázový audit, neopakuje se", order: 3, n: null };
const inactiveSt = r => ({ key: "inactive", label: "Neaktivní", text: `neaktivní od ${czDate(r.inactive.slice(0, 10))}`, order: 9, n: null });
export const stOf = r => (r.inactive ? inactiveSt(r) : r.audit_kind === "nulty" ? NULTY_ST : statusOf(r.next_audit_date));

// Neaktivní zákazníci: audity zůstávají, jen nevyskakují v termínech (klíč = IČ, jinak název)
export async function loadInactive() {
  const { data, error } = await supabase.from("inactive_customers").select("brand,cust_key,since");
  if (error) throw error;
  return new Map(data.map(x => [x.brand + "|" + x.cust_key, x.since]));
}
export function markInactive(rows, map) {
  for (const r of rows) r.inactive = map.get(r.brand + "|" + custKey(r)) || null;
  return rows;
}
export async function setInactive(brand, r, inactive) {
  const key = custKey(r);
  const q = inactive
    ? supabase.from("inactive_customers").upsert({ brand, cust_key: key, partner: r.partner })
    : supabase.from("inactive_customers").delete().eq("brand", brand).eq("cust_key", key);
  const { error } = await q;
  if (error) throw error;
}
export const custKey = r => r.ic || r.partner.toLowerCase().trim();
const byStatus = (a, b) => a.st.order - b.st.order || (a.next_audit_date || "9999").localeCompare(b.next_audit_date || "9999") || b.audit_date.localeCompare(a.audit_date);

export function statusOf(nextIso) {
  if (!nextIso) return { key: "none", label: "", text: "", order: 3, n: null };
  const n = daysTo(nextIso);
  if (n < 0) return { key: "expired", label: "Propadlý", text: `propadl před ${-n} ${n === -1 ? "dnem" : "dny"}`, order: 0, n };
  if (n <= WARN_DAYS) return { key: "soon", label: "Blíží se", text: n === 0 ? "dnes" : `za ${n} ${n === 1 ? "den" : n < 5 ? "dny" : "dní"}`, order: 1, n };
  return { key: "ok", label: "Platný", text: `za ${n} dní`, order: 2, n };
}

// ---------- Načtení dat ----------
export async function loadAudits(brand) {
  const cols = "id,brand,partner,ic,audit_date,valid_months,next_audit_date,result,source,created_at,audit_kind,kraj,photo_count"
    + (brand === "arval" ? ",meta:data->meta,checks:data->checks,esgChecks:data->esgChecks,esgRadio:data->esgRadio" : (brand === "stellantis" || brand === "mitsubishi" || brand === "volvo") ? ",meta:data->meta" : "");
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
    const k = r.brand + "|" + (r.audit_kind || "ostry") + "|" + (r.ic || r.partner.toLowerCase().trim());
    const cur = map.get(k);
    if (!cur || r.audit_date > cur.audit_date) map.set(k, { ...r, older: (cur ? (cur.older || 0) + 1 : 0) });
    else cur.older = (cur.older || 0) + 1;
  }
  return [...map.values()];
}

// ---------- Filtry přehledu ----------
export const KRAJE = ["Hlavní město Praha", "Středočeský kraj", "Jihočeský kraj", "Plzeňský kraj", "Karlovarský kraj", "Ústecký kraj", "Liberecký kraj", "Královéhradecký kraj", "Pardubický kraj", "Kraj Vysočina", "Jihomoravský kraj", "Olomoucký kraj", "Zlínský kraj", "Moravskoslezský kraj"];
export const KINDS = { ostry: "Ostrý audit", nulty: "Nultý audit" };
export const PERIODS = { "": "Všechny termíny", "1": "Do 1 měsíce", "3": "Do kvartálu (3 měsíce)", "6": "Do půl roku", "12": "Do roku" };
export const NO_KRAJ = "(kraj neuveden)";
export const defaultFilter = () => ({ kind: "ostry", period: "", kraje: [], q: "" });
const todayIso = () => { const d = today(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

// Řádky podle filtru (typ auditu, kraj) → u každého zákazníka nejnovější → termín v období → hledání
export function filterList(brand, rows, f = defaultFilter()) {
  let r = rows;
  if (f.kind) r = r.filter(x => (x.audit_kind || "ostry") === f.kind);
  if (f.kraje?.length) r = r.filter(x => f.kraje.includes(x.kraj || NO_KRAJ));
  let list = latestPerCustomer(r);
  if (f.period && !NO_VALIDITY.has(brand) && f.kind !== "nulty") {
    const lim = addMonths(todayIso(), +f.period); // už propadlé + ty, kterým termín skončí do zvoleného data
    list = list.filter(x => !x.inactive && x.next_audit_date && x.next_audit_date <= lim);
  }
  if (f.q) { const q = f.q.toLowerCase().trim(); list = list.filter(x => (x.partner + " " + (x.ic || "")).toLowerCase().includes(q)); }
  return list;
}

function filtersHtml(brand, rows, f) {
  const has = k => rows.some(x => (x.kraj || NO_KRAJ) === k);
  const opts = [...KRAJE, NO_KRAJ].filter(k => KRAJE.includes(k) || has(k));
  const cnt = k => new Set(rows.filter(x => (x.kraj || NO_KRAJ) === k && (!f.kind || (x.audit_kind || "ostry") === f.kind)).map(x => x.ic || x.partner)).size;
  const krajLabel = !f.kraje.length ? "Všechny kraje" : f.kraje.length === 1 ? f.kraje[0] : `Vybráno krajů: ${f.kraje.length}`;
  return `
    <div class="res-filters">
      <label class="f-field"><span>Typ auditu</span><select id="fKind">
        ${[["ostry", "Ostré audity"], ["nulty", "Nulté audity"], ["", "Ostré i nulté audity"]].map(([v, t]) => `<option value="${v}"${f.kind === v ? " selected" : ""}>${t}</option>`).join("")}
      </select></label>
      ${NO_VALIDITY.has(brand) || f.kind === "nulty" ? "" : `<label class="f-field"><span>Termín příštího auditu</span><select id="fPeriod">
        ${Object.entries(PERIODS).map(([v, t]) => `<option value="${v}"${f.period === v ? " selected" : ""}>${t}</option>`).join("")}
      </select></label>`}
      <div class="f-field"><span>Kraj</span><details class="f-kraj" id="fKraj"><summary>${esc(krajLabel)}</summary>
        <div class="f-kraj-list">
          ${opts.map(k => { const n = cnt(k); return `<label class="${n ? "" : "f-empty"}"><input type="checkbox" value="${esc(k)}"${f.kraje.includes(k) ? " checked" : ""}> <span>${esc(k)}</span> <em>${n}</em></label>`; }).join("")}
          <div class="f-kraj-act"><button type="button" class="btn-exp" data-kraj-clear>Všechny kraje</button></div>
        </div></details></div>
    </div>
    ${f.kind === "nulty" ? `<p class="f-note">Nultý audit je jednorázový – nemá platnost ani termín příštího auditu.</p>` : ""}
    ${f.period && !NO_VALIDITY.has(brand) && f.kind !== "nulty" ? `<p class="f-note">Zobrazeny jsou servisy, kterým termín příštího auditu skončí ${PERIODS[f.period].toLowerCase()} (do ${czDate(addMonths(todayIso(), +f.period))}), včetně těch, které už propadly.</p>` : ""}`;
}
function emptyHtml(total, isAdmin) {
  return total ? `<div class="empty">Zvoleným filtrům neodpovídá žádný audit.</div>` : `<div class="empty">Zatím zde nejsou žádné audity.${isAdmin ? " Nahrajte první audit tlačítkem výše." : ""}</div>`;
}
function rowExtra(r, f) {
  return `${r.kraj ? `<span class="muted">${esc(r.kraj)}</span>` : ""}${!f.kind && (r.audit_kind || "ostry") === "nulty" ? `<span class="kind-badge">Nultý audit</span>` : ""}`;
}

// Kraj sídla firmy podle IČ z ARES (když ARES neodpoví, vrátí null)
export async function krajFromIc(ic) {
  if (!ic) return null;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch(`https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${String(ic).replace(/\s/g, "").padStart(8, "0")}`, { headers: { Accept: "application/json" }, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    return (await r.json())?.sidlo?.nazevKraje || null;
  } catch { return null; }
}

// Kraj podle adresy (ARES – standardizace adres z RÚIAN). Nejdřív celá adresa, pak jen PSČ + obec.
export async function krajFromAddress(a) {
  if (!a) return null;
  const ask = async (textovaAdresa, typ) => {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch("https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/standardizovane-adresy/vyhledat", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ textovaAdresa, typStandardizaceAdresy: typ, pocet: 1 }) });
      clearTimeout(t);
      if (!r.ok) return null;
      return (await r.json())?.standardizovaneAdresy?.[0]?.nazevKraje || null;
    } catch { return null; }
  };
  const psc = String(a.psc || "").replace(/\s/g, ""), mesto = String(a.mesto || "").trim(), ulice = String(a.ulice || "").trim();
  if (!mesto && !psc) return null;
  return (ulice && await ask(`${ulice}, ${psc} ${mesto}`.trim(), "VYHOVUJICI_ADRESY")) || await ask(`${psc} ${mesto}`.trim(), "UPLNA_STANDARDIZACE");
}

// ---------- Výpočet výsledku z JSON formuláře ----------
let defsCache = {};
export async function formDefs(brand) {
  if (defsCache[brand]) return defsCache[brand];
  const html = await fetch(new URL(`../${brand}/index.html`, import.meta.url), { cache: "no-store" }).then(r => r.text());
  let defs;
  if (brand === "mitsubishi" || brand === "hyundai" || brand === "volvo") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const el = doc.getElementById("criteria-data");
    if (!el) throw new Error("Nepodařilo se načíst kritéria formuláře – obnovte stránku (Ctrl+F5).");
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

// Hyundai: v každé oblasti všechna N a alespoň minimum P
export function hyundaiEval(state, defs) {
  let ok = true;
  const per = defs.sections.map(sec => {
    const c = { N: [0, 0], P: [0, 0], D: [0, 0] };
    for (const it of sec.items) { c[it.type][1]++; if (state.checks?.[it.id]) c[it.type][0]++; }
    const sOk = c.N[0] === c.N[1] && c.P[0] >= sec.minP;
    if (!sOk) ok = false;
    return { title: sec.title, ok: sOk, ...c, minP: sec.minP };
  });
  return { ok, per };
}
function hyundaiResult(state, defs) {
  const r = hyundaiEval(state, defs);
  return `${r.ok ? "Úspěšný audit" : "Neúspěšný audit"} | ${r.per.map(s => `${s.title} ${s.ok ? "✔" : "✘"}`).join(" · ")}`;
}

// Volvo: každá část (standardy, vybavení karosárny, vybavení lakovny) min. 90 %; splněno +1, nesplněno −váha
export function volvoEval(state, defs) {
  const per = defs.parts.map(p => {
    let pts = 0, cnt = 0;
    for (const s of p.sections) for (const it of s.items) { if (!it.w) continue; cnt++; pts += state.checks?.[it.id] ? 1 : -it.w; }
    const pct = cnt ? pts / cnt * 100 : 0;
    return { id: p.id, title: p.title, pct, ok: pct >= defs.min };
  });
  return { ok: per.every(p => p.ok), per };
}
function volvoResult(state, defs) {
  const r = volvoEval(state, defs), short = { std: "Standardy", kar: "Karosárna", lak: "Lakovna" };
  return `${r.ok ? "Úspěšný audit" : "Neúspěšný audit"} | ${r.per.map(p => `${short[p.id] || p.title} ${(Math.round(p.pct * 10) / 10).toFixed(1).replace(".", ",")} %`).join(" · ")}`;
}

export function detectBrand(state) {
  if (state?.form === "volvo") return "volvo";
  if (state?.form === "mitsubishi") return "mitsubishi";
  if (state?.form === "hyundai") return "hyundai";
  if (state?.meta && "esgChecks" in state) return "arval";
  if (state?.meta && ("radky" in state || "brands" in state.meta)) return "stellantis";
  return null;
}

export async function prepareImport(state, brand) {
  const defs = await formDefs(brand);
  const meta = state.meta || {};
  if (!meta.partner) throw new Error("V souboru chybí název zákazníka (partner).");
  if (!meta.datumAuditu) throw new Error("V souboru chybí datum auditu.");
  const valid = brand === "arval" ? (parseInt(meta.platnostMesicu, 10) || 36) : brand === "mitsubishi" ? (defs.validMonths || 36) : null; // Stellantis, Volvo: bez recertifikační lhůty
  const result = brand === "arval" ? arvalResult(state, defs) : brand === "mitsubishi" ? mitsubishiResult(state, defs) : brand === "hyundai" ? hyundaiResult(state, defs) : brand === "volvo" ? volvoResult(state, defs) : stellantisResult(state, defs);
  return { brand, partner: meta.partner.trim(), ic: (meta.ic || "").replace(/\s/g, "") || null, audit_date: meta.datumAuditu, valid_months: valid, result, data: state, source: "import-json" };
}

export async function saveAudit(rec) {
  if (!rec.kraj) {
    const mp = rec.data?.meta?.mistoPrijmu;
    const k = (mp?.jinde && (mp.mesto || mp.psc) ? (mp.kraj || await krajFromAddress(mp)) : null) || (rec.ic ? await krajFromIc(rec.ic) : null);
    if (k) rec.kraj = k;
  }
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

// Názvy kritérií pro galerii fotek: id kritéria → { label, order }
export async function criteriaLabels(brand) {
  const d = await formDefs(brand), map = {};
  let i = 0;
  const add = (id, label) => { map[id] = { label, order: i++ }; };
  if (brand === "arval") {
    for (const c of d.CATEGORIES) for (const it of c.items) add(it.id, `${c.title} – ${it.group}${it.desc ? ": " + it.desc : ""}`);
    for (const it of d.NAHRADNI.items || []) add(it.id, `Náhradní vozidla – ${it.group || ""}${it.desc ? ": " + it.desc : ""}`);
  } else if (brand === "volvo") {
    for (const p of d.parts) for (const s of p.sections) for (const it of s.items) add(it.id, `${p.title} – ${it.n} ${it.title}`);
  } else if (brand === "stellantis") {
    for (const a of Object.values(d.AREAS)) for (const it of a.items) add(it[0], `${a.title} – ${it[0]} ${it[1]}`);
  } else {
    for (const sec of d.sections || []) for (const it of sec.items) add(it.id, `${sec.title} – ${it.n}. ${it.text}`);
  }
  return map;
}

function lvlBadge(level, label) { return `<span class="lvl lvl-${level}">${esc(label)}</span>`; }

function arvalCells(r, defs) {
  if (!r.checks && !r.meta) return defs.CATEGORIES.map(() => "<td>—</td>").join("") + "<td>—</td>";
  const b = arvalBreakdown({ meta: r.meta, checks: r.checks, esgChecks: r.esgChecks, esgRadio: r.esgRadio }, defs);
  return b.cats.map(c => `<td class="lvl-cell">${lvlBadge(c.level, c.label)}${c.ext ? `<span class="ext">Externí: ${esc(c.ext.name || "neuvedeno")}${c.ext.ico ? `, IČO ${esc(c.ext.ico)}` : ""}</span>` : ""}</td>`).join("")
    + `<td class="lvl-cell">${lvlBadge(b.esg.level, b.esg.label)}<span class="ext">${b.esg.points} / ${b.esg.max} bodů</span></td>`;
}

export function dashboardHtml(brand, rows, isAdmin, defs, f = defaultFilter()) {
  if (NO_VALIDITY.has(brand)) return stellantisDashboardHtml(rows, isAdmin, f, brand);
  const arv = brand === "arval" && defs;
  const list = filterList(brand, rows, { ...f, q: "" }).map(r => ({ ...r, st: stOf(r) })).sort(byStatus);
  const cnt = k => list.filter(r => r.st.key === k).length;
  return `
    ${f.kind === "nulty" ? `<div class="kpis kpis-1"><div class="kpi"><span class="kpi-n">${list.length}</span><span class="kpi-l">Zákazníků s nultým auditem${inactNote(list)}</span></div></div>` : `
    <div class="kpis">
      <div class="kpi"><span class="kpi-n">${list.length}</span><span class="kpi-l">Auditovaných zákazníků${inactNote(list)}</span></div>
      <div class="kpi kpi-expired"><span class="kpi-n">${cnt("expired")}</span><span class="kpi-l">Propadlé audity</span></div>
      <div class="kpi kpi-soon"><span class="kpi-n">${cnt("soon")}</span><span class="kpi-l">Blíží se (do ${WARN_DAYS} dní)</span></div>
      <div class="kpi kpi-ok"><span class="kpi-n">${cnt("ok")}</span><span class="kpi-l">Platné</span></div>
    </div>`}
    ${isAdmin ? importBoxHtml(brand) : ""}
    <div class="res-card">
      ${filtersHtml(brand, rows, f)}
      <div class="res-toolbar"><input type="search" id="resSearch" placeholder="Hledat zákazníka nebo IČ…" value="${esc(f.q)}"><span class="res-exp">${list.length ? `<button type="button" class="btn-exp" data-export="pdf">Export do PDF</button><button type="button" class="btn-exp" data-export="xlsx">Export do Excelu</button>` : ""}</span></div>
      ${list.length ? `
      <div class="table-wrap"><table class="res-table${arv ? " res-arval" : ""}">
        <thead><tr><th>Stav</th><th>Zákazník</th>${arv ? defs.CATEGORIES.map(c => `<th class="th-lvl">${esc(c.title)}</th>`).join("") + `<th class="th-lvl">ESG a CSR</th>` : "<th>Výsledek</th>"}<th>Datum auditu</th><th>Příští audit</th></tr></thead>
        <tbody>
          ${list.map(r => `
          <tr class="st-${r.st.key}" data-q="${esc((r.partner + " " + (r.ic || "")).toLowerCase())}">
            <td><span class="st-badge st-${r.st.key}">${r.st.label}</span></td>
            <td><button type="button" class="pv-name" data-pv="${esc(r.id)}" title="Zobrazit výsledkovou listinu">${esc(r.partner)}</button>${r.ic ? `<span class="muted">IČ ${esc(r.ic)}</span>` : ""}${r.older ? `<span class="muted">+ ${r.older} starší audit${r.older > 1 ? "y" : ""}</span>` : ""}${rowExtra(r, f)}${brand === "mitsubishi" ? mitExtNote(r.meta) : ""}<span class="row-btns"><button type="button" class="btn-pv" data-pv="${esc(r.id)}" title="Zobrazit kompletní výsledkovou listinu (všechna kritéria)">📄 Listina</button>${photoBtn(r, rows)}${isAdmin ? delBtn(r) : ""}</span></td>
            ${arv ? arvalCells(r, defs) : `<td class="res-col">${resultCell(r.result)}</td>`}
            <td class="td-date">${czDate(r.audit_date)}${r.valid_months && r.audit_kind !== "nulty" ? `<span class="muted">platnost ${r.valid_months} měs.</span>` : ""}</td>
            <td class="td-date"><strong>${czDate(r.next_audit_date)}</strong><span class="muted">${r.st.text}</span></td>
          </tr>`).join("")}
        </tbody></table></div>` : emptyHtml(rows.length, isAdmin)}
    </div>`;
}

function stellantisDashboardHtml(rows, isAdmin, f, brand = "stellantis") {
  const list = filterList(brand, rows, { ...f, q: "" }).sort((a, b) => (!!a.inactive - !!b.inactive) || b.audit_date.localeCompare(a.audit_date));
  const ok = r => /^Úspěšný/.test(r.result || "");
  const act = list.filter(r => !r.inactive), nOk = act.filter(ok).length;
  return `
    <div class="kpis kpis-3">
      <div class="kpi"><span class="kpi-n">${list.length}</span><span class="kpi-l">Auditovaných zákazníků${inactNote(list)}</span></div>
      <div class="kpi kpi-ok"><span class="kpi-n">${nOk}</span><span class="kpi-l">Úspěšný audit</span></div>
      <div class="kpi kpi-expired"><span class="kpi-n">${act.length - nOk}</span><span class="kpi-l">Neúspěšný audit</span></div>
    </div>
    ${isAdmin ? importBoxHtml(brand) : ""}
    <div class="res-card">
      ${filtersHtml(brand, rows, f)}
      <div class="res-toolbar"><input type="search" id="resSearch" placeholder="Hledat zákazníka nebo IČ…" value="${esc(f.q)}"><span class="res-exp">${list.length ? `<button type="button" class="btn-exp" data-export="pdf">Export do PDF</button><button type="button" class="btn-exp" data-export="xlsx">Export do Excelu</button>` : ""}</span></div>
      ${list.length ? `
      <div class="table-wrap"><table class="res-table">
        <thead><tr><th>Zákazník</th><th>Výsledek</th><th>Hodnocení oblastí</th><th>Datum auditu</th></tr></thead>
        <tbody>
          ${list.map(r => { const [head, detail] = (r.result || "—").split(" | "); return `
          <tr class="${r.inactive ? "st-inactive" : ""}" data-q="${esc((r.partner + " " + (r.ic || "")).toLowerCase())}">
            <td>${r.inactive ? `<span class="st-badge st-inactive">Neaktivní</span><span class="muted">${stOf(r).text}</span>` : ""}<button type="button" class="pv-name" data-pv="${esc(r.id)}" title="Zobrazit výsledkovou listinu">${esc(r.partner)}</button>${r.ic ? `<span class="muted">IČ ${esc(r.ic)}</span>` : ""}${r.older ? `<span class="muted">+ ${r.older} starší audit${r.older > 1 ? "y" : ""}</span>` : ""}${rowExtra(r, f)}${r.meta?.karosarnaExterni === "externi" ? `<span class="ext-note">Externí karosárna: ${esc(r.meta.ext?.nazev || "neuvedeno")}${r.meta.ext?.ic ? `, IČO ${esc(r.meta.ext.ic)}` : ""}</span>` : ""}${brand === "volvo" && extText(r.meta, brand)[0] ? `<span class="ext-note">Smluvní opravna: ${esc(extText(r.meta, brand)[0])}</span>` : ""}<span class="row-btns"><button type="button" class="btn-pv" data-pv="${esc(r.id)}" title="Zobrazit kompletní výsledkovou listinu (všechna kritéria)">📄 Listina</button>${photoBtn(r, rows)}${isAdmin ? delBtn(r) : ""}</span></td>
            <td><span class="lvl ${ok(r) ? "lvl-3" : "lvl-0"}">${esc(head)}</span></td>
            <td class="muted-cell">${esc(detail || "")}</td>
            <td class="td-date">${czDate(r.audit_date)}</td>
          </tr>`; }).join("")}
        </tbody></table></div>` : emptyHtml(rows.length, false)}
    </div>`;
}

// Tlačítko galerie: počet fotek ze všech auditů zákazníka u této značky
function photoBtn(r, rows) {
  const k = custKey(r), n = rows.filter(x => custKey(x) === k).reduce((a, x) => a + (x.photo_count || 0), 0);
  return n ? `<button type="button" class="btn-photos" data-gal="${esc(k)}" data-name="${esc(r.partner)}" title="Otevřít galerii fotek z auditů">📷 Fotky (${n})</button>` : "";
}

function delBtn(r) {
  return r.inactive
    ? `<button type="button" class="btn-actcust" data-act-cust="${esc(custKey(r))}" data-name="${esc(r.partner)}" title="Zákazník se znovu zobrazí v termínech a přehledech">Aktivovat</button>`
    : `<button type="button" class="btn-delcust" data-inact-cust="${esc(custKey(r))}" data-name="${esc(r.partner)}" title="Zákazník už není partnerem – audity zůstanou, jen nebude hlásit termíny">Neaktivní</button>`;
}
function inactNote(list) {
  const n = list.filter(r => r.inactive).length;
  return n ? `<small class="kpi-sub">z toho ${n} neaktivní${n === 1 ? "" : n < 5 ? "" : "ch"}</small>` : "";
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

// ---------- Export přehledu (PDF / Excel) ----------
function sortedList(brand, rows, f) {
  const list = filterList(brand, rows, f);
  if (NO_VALIDITY.has(brand)) return list.sort((a, b) => (!!a.inactive - !!b.inactive) || b.audit_date.localeCompare(a.audit_date));
  return list.map(r => ({ ...r, st: stOf(r) })).sort(byStatus);
}
function extText(meta, brand) {
  if (!meta) return ["", ""];
  if (brand === "mitsubishi") return ["karosarna", "lakovna"].map(k => meta[k + "Stejna"] === false && meta[k]?.nazev ? `${meta[k].nazev}${meta[k].ic ? `, IČO ${meta[k].ic}` : ""}` : "");
  if (brand === "volvo") return [meta.opravnaSmluvni && meta.opravna?.nazev ? `${meta.opravna.nazev}${meta.opravna.ic ? `, IČO ${meta.opravna.ic}` : ""}` : ""];
  if (brand === "stellantis") return [meta.karosarnaExterni === "externi" ? `${meta.ext?.nazev || "neuvedeno"}${meta.ext?.ic ? `, IČO ${meta.ext.ic}` : ""}` : ""];
  return [];
}
export function exportTable(brand, rows, defs, f = defaultFilter()) {
  const list = sortedList(brand, rows, f), q = (f.q || "").trim();
  const fdesc = [f.kind ? KINDS[f.kind] : "ostré i nulté audity", f.period && !NO_VALIDITY.has(brand) && f.kind !== "nulty" ? `termín ${PERIODS[f.period].toLowerCase()}` : "", f.kraje.length ? f.kraje.join(", ") : ""].filter(Boolean).join(" · ");
  const name = { arval: "Arval", stellantis: "Stellantis", mitsubishi: "Mitsubishi", volvo: "Volvo" }[brand] || brand;
  const today = new Date();
  const subtitle = `Stav k ${today.getDate()}. ${today.getMonth() + 1}. ${today.getFullYear()} · ${list.length} zákazník${list.length === 1 ? "" : list.length < 5 && list.length ? "y" : "ů"}${fdesc ? ` · ${fdesc}` : ""}${q ? ` · hledání „${q}“` : ""}`;
  const head = [], body = [], rowClass = [];
  const split = r => { const [h, d] = (r.result || "—").split(" | "); return [h, d || ""]; };
  if (brand === "arval") {
    head.push("Stav", "Zákazník", "IČ", "Kraj", ...defs.CATEGORIES.map(c => c.title), "ESG a CSR", "Datum auditu", "Příští audit");
    for (const r of list) {
      const b = (r.checks || r.meta) ? arvalBreakdown({ meta: r.meta, checks: r.checks, esgChecks: r.esgChecks, esgRadio: r.esgRadio }, defs) : null;
      const cats = b ? b.cats.map(c => c.label + (c.ext ? `\nExterní: ${c.ext.name || "neuvedeno"}${c.ext.ico ? `, IČO ${c.ext.ico}` : ""}` : "")) : defs.CATEGORIES.map(() => "—");
      body.push([r.st.label, r.partner, r.ic || "", r.kraj || "", ...cats, b ? `${b.esg.label} (${b.esg.points}/${b.esg.max} b.)` : "—", czDate(r.audit_date), `${czDate(r.next_audit_date)}\n${r.st.text}`]);
      rowClass.push("st-" + r.st.key);
    }
  } else if (brand === "mitsubishi") {
    head.push("Stav", "Zákazník", "IČ", "Kraj", "Výsledek", "Hodnocení", "Externí karosárna", "Externí lakovna", "Datum auditu", "Příští audit");
    for (const r of list) {
      const [h, d] = split(r), [ek, el] = extText(r.meta, brand);
      body.push([r.st.label, r.partner, r.ic || "", r.kraj || "", h, d, ek, el, czDate(r.audit_date), `${czDate(r.next_audit_date)}\n${r.st.text}`]);
      rowClass.push("st-" + r.st.key);
    }
  } else {
    head.push("Zákazník", "IČ", "Kraj", "Výsledek", "Hodnocení oblastí", brand === "volvo" ? "Smluvní opravna" : "Externí karosárna", "Datum auditu");
    for (const r of list) {
      const [h, d] = split(r), [ek] = extText(r.meta, brand);
      body.push([r.partner + (r.inactive ? "\n(neaktivní)" : ""), r.ic || "", r.kraj || "", h, d, ek, czDate(r.audit_date)]);
      rowClass.push(r.inactive ? "st-inactive" : /^Úspěšný/.test(h) ? "st-ok" : "st-expired");
    }
  }
  const stamp = today.toISOString().slice(0, 10);
  return { title: `Výsledky auditů – ${name}`, subtitle, sheet: name, head, rows: body, rowClass, file: `vysledky_auditu_${brand}_${stamp}` };
}

export { esc, czDate, addMonths };
