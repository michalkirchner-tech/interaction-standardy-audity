// Náhled kompletní výsledkové listiny auditu (jen ke čtení) + export do PDF (tisk prohlížeče)
import { supabase } from "./supabase.js?v=20261120l";
import { formDefs, arvalBreakdown, mitsubishiEval, mitsubishiRecertEval, stOf, czDate, esc } from "./results.js?v=20261120l";

const BRAND_NAME = { arval: "Arval", stellantis: "Stellantis", mitsubishi: "Mitsubishi" };
const OK = '<span class="pv-ok" title="Splněno">✓</span>', NOK = '<span class="pv-nok" title="Nesplněno">✗</span>';
const mark = v => (v ? OK : NOK);
const tri = v => (v === "A" ? '<span class="pv-ok">Ano</span>' : v === "C" ? '<span class="pv-part">Částečně</span>' : v === "N" ? '<span class="pv-nok">Ne</span>' : '<span class="pv-empty">—</span>');
const lvl = (n, label) => `<span class="pv-lvl pv-l${n}">${esc(label)}</span>`;
const kv = rows => `<div class="pv-kv">${rows.filter(r => r[1]).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>`;
const addr = (u, p) => [u, p].filter(Boolean).join(", ");

export async function openPreview(brand, id) {
  const box = document.createElement("div");
  box.className = "pv-back";
  box.innerHTML = `<div class="pv-box" role="dialog" aria-modal="true"><div class="pv-bar no-print-pv">
      <strong>Výsledková listina – ${esc(BRAND_NAME[brand] || brand)}</strong>
      <label class="pv-only"><input type="checkbox" data-only> Jen nesplněná kritéria</label>
      <span class="pv-btns"><button type="button" data-pdf class="pv-pdf">Export do PDF</button><button type="button" data-x class="pv-close">Zavřít</button></span></div>
    <div class="pv-doc"><p class="pv-msg">Načítám audit…</p></div></div>`;
  document.body.appendChild(box);
  document.body.classList.add("pv-open");
  const close = () => { box.remove(); document.body.classList.remove("pv-open"); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  box.querySelector("[data-x]").onclick = close;
  box.addEventListener("mousedown", e => { if (e.target === box) close(); });
  const doc = box.querySelector(".pv-doc");
  box.querySelector("[data-only]").onchange = e => doc.classList.toggle("pv-only-bad", e.target.checked);

  let rec, defs;
  try {
    const { data, error } = await supabase.from("audits").select("id,brand,partner,ic,audit_date,valid_months,next_audit_date,result,audit_kind,kraj,data").eq("id", id).single();
    if (error) throw error;
    rec = data; defs = await formDefs(brand);
  } catch (e) { doc.innerHTML = `<p class="pv-msg pv-err">Audit se nepodařilo načíst: ${esc(e.message)}</p>`; return; }
  const s = rec.data || {};
  let body;
  try { body = brand === "arval" ? arvalDoc(s, defs) : brand === "stellantis" ? stellantisDoc(s, defs) : mitsubishiDoc(s, defs); }
  catch (e) { body = `<p class="pv-msg pv-err">Listinu se nepodařilo sestavit: ${esc(e.message)}</p>`; }
  const st = stOf(rec);
  doc.innerHTML = `
    <div class="pv-head"><img src="assets/interaction-logo.png" alt=""><div><h1>Výsledková listina auditu ${esc(BRAND_NAME[brand] || brand)}</h1>
      <p>${esc(rec.partner)}${rec.ic ? ` · IČ ${esc(rec.ic)}` : ""}</p></div></div>
    ${kv([
      ["Druh auditu", rec.audit_kind === "nulty" ? "Nultý audit" : "Ostrý audit"],
      ["Datum auditu", czDate(rec.audit_date)],
      ["Příští audit", rec.next_audit_date ? `${czDate(rec.next_audit_date)} (${st.text})` : ""],
      ["Platnost", rec.valid_months ? `${rec.valid_months} měsíců` : ""],
      ["Kraj", rec.kraj || ""],
      ["Sídlo", addr(s.meta?.ulice, [s.meta?.psc, s.meta?.mesto].filter(Boolean).join(" "))],
      ["Auditor", s.meta?.auditor || s.kontakty?.auditorJmeno || ""],
    ])}
    ${body}
    <p class="pv-foot">Vytištěno ${new Date().toLocaleDateString("cs-CZ")} z aplikace Standardy a audity · INTERACTION</p>`;
  const prevTitle = document.title;
  box.querySelector("[data-pdf]").onclick = () => {
    document.body.classList.add("pv-printing");
    document.title = `Výsledková listina ${BRAND_NAME[brand]} – ${rec.partner} – ${czDate(rec.audit_date)}`;
    const done = () => { document.body.classList.remove("pv-printing"); document.title = prevTitle; window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    setTimeout(() => window.print(), 50);
    setTimeout(done, 20000);
  };
}

// ---------- Arval ----------
function arvalDoc(s, defs) {
  const b = arvalBreakdown(s, defs), m = s.meta || {};
  const ext = (on, n, ico) => (on === "externi" ? `${n || "neuvedeno"}${ico ? `, IČ ${ico}` : ""}` : "");
  const loc = o => (o?.jinde ? addr(o.ulice, [o.psc, o.mesto].filter(Boolean).join(" ")) : "");
  let h = `<h2>Výsledek</h2><table class="pv-sum"><tbody>
    ${b.cats.map(c => `<tr><td>${esc(c.title)}${c.ext ? ` <i>(externí: ${esc(c.ext.name || "neuvedeno")})</i>` : ""}</td><td>${lvl(c.level, c.label)}</td></tr>`).join("")}
    <tr><td>ESG a CSR (${b.esg.points} / ${b.esg.max} bodů)</td><td>${lvl(b.esg.level, b.esg.label)}</td></tr></tbody></table>`;
  h += kv([
    ["Příjem do servisu", loc(m.mistoPrijmu)], ["Mechanická dílna", loc(m.mistoDilny)],
    ["Počet mechaniků / karosářů / lakýrníků", [m.pocetMechaniku, m.pocetKaroseru, m.pocetLakyrniku].map(x => x || "–").join(" / ")],
    ["Externí karosárna", ext(m.karoserieExterni, m.dodavatelKarosarna, m.dodavatelKarosarnaIco)],
    ["Externí lakovna", ext(m.lakovnaExterni, m.dodavatelLakovna, m.dodavatelLakovnaIco)],
    ["Lakovací materiál", m.lakovnaZnackaMaterialu], ["Náhradní vozidla", [m.nahradniPocet && `počet ${m.nahradniPocet}`, m.nahradniStari && `stáří ${m.nahradniStari}`, m.nahradniVlastnik && `vlastník ${m.nahradniVlastnik}`].filter(Boolean).join(", ")],
  ]);
  const rows = items => items.map(it => { const ok = !!s.checks?.[it.id]; return `<tr class="${ok ? "" : "pv-bad"}"><td class="pv-m">${mark(ok)}</td><td class="pv-lv">Úr. ${it.level}</td><td><b>${esc(it.group)}</b>${it.desc ? ` – ${esc(it.desc)}` : ""}</td></tr>`; }).join("");
  h += `<h2>Náhradní vozidla</h2><table class="pv-tbl"><tbody>${rows(defs.NAHRADNI.items)}</tbody></table>`;
  for (const c of defs.CATEGORIES) {
    const lv = b.cats.find(x => x.id === c.id);
    h += `<h2>${esc(c.title)} ${lv ? lvl(lv.level, lv.label) : ""}</h2><table class="pv-tbl"><tbody>${rows(c.items)}</tbody></table>`;
  }
  h += `<h2>ESG a CSR ${lvl(b.esg.level, b.esg.label)}</h2><table class="pv-tbl"><tbody>`;
  for (const g of defs.ESG.groups) {
    h += `<tr class="pv-grp"><td colspan="3">${esc(g.title)}</td></tr>`;
    for (const it of g.items) {
      if (it.type === "radio" || (!it.type && g.type === "radio")) {
        const sel = s.esgRadio?.[it.id], o = it.options[sel];
        h += `<tr class="${o && o.points ? "" : "pv-bad"}"><td class="pv-m">${o ? "◉" : NOK}</td><td class="pv-lv">${o ? o.points : 0} b.</td><td><b>${esc(it.desc)}:</b> ${o ? esc(o.label) : "nevyplněno"}</td></tr>`;
      } else { const ok = !!s.esgChecks?.[it.id]; h += `<tr class="${ok ? "" : "pv-bad"}"><td class="pv-m">${mark(ok)}</td><td class="pv-lv">${it.points} b.</td><td>${esc(it.desc)}</td></tr>`; }
    }
  }
  h += `</tbody></table>`;
  if (s.doporuceni) h += `<h2>Doporučení</h2><p class="pv-pre">${esc(s.doporuceni)}</p>`;
  const k = s.kontakty || {};
  h += `<h2>Kontakty</h2>` + kv([["Auditor", [k.auditorJmeno, k.auditorTel, k.auditorEmail].filter(Boolean).join(", ")], ["Odpovědná osoba", [k.odpovednaJmeno, k.odpovednaTel, k.odpovednaEmail].filter(Boolean).join(", ")], ["Místo a datum", [k.misto, k.datumPodpisu && czDate(k.datumPodpisu)].filter(Boolean).join(", ")]]);
  if (s.importInfo) h += `<p class="pv-note">${esc(s.importInfo)}</p>`;
  return h;
}

// ---------- Stellantis ----------
function stellantisDoc(s, { AREAS, RESULT_AREAS, ZINC_BRANDS, BRANDS }) {
  const sel = BRANDS.some(b => s.meta?.brands?.[b[0]]);
  const zinc = !sel || ZINC_BRANDS.some(k => s.meta?.brands?.[k]);
  const met = id => !!s.checks?.[id] || (id === "2.2" && !zinc);
  let unmet = 0;
  const sum = RESULT_AREAS.map(r => { let d = 0, m = 0; r.ids.forEach(a => AREAS[a].items.forEach(it => { m++; if (met(it[0])) d++; else unmet++; })); return [r.label, d, m]; });
  const brands = BRANDS.filter(b => s.meta?.brands?.[b[0]]).map(b => b[1] || b[0]).join(", ");
  let h = `<h2>Výsledek ${lvl(unmet ? 0 : 3, unmet ? "Neúspěšný audit" : "Úspěšný audit")}</h2>
    <table class="pv-sum"><tbody>${sum.map(([l, d, m]) => `<tr><td>${esc(l)}</td><td>${lvl(d === m ? 3 : 0, `${d} / ${m}`)}</td></tr>`).join("")}</tbody></table>`;
  if (brands) h += kv([["Značky", brands]]);
  for (const a of Object.values(AREAS)) {
    h += `<h2>${esc(a.title)}</h2><table class="pv-tbl"><tbody>${a.items.map(it => { const ok = met(it[0]); return `<tr class="${ok ? "" : "pv-bad"}"><td class="pv-m">${mark(ok)}</td><td class="pv-lv">${esc(it[0])}</td><td><b>${esc(it[1])}</b>${it[2] ? ` – ${esc(it[2])}` : ""}${it[0] === "2.2" && !zinc ? " <i>(pro zvolené značky se nehodnotí)</i>" : ""}</td></tr>`; }).join("")}</tbody></table>`;
  }
  return h + extras(s);
}

// ---------- Mitsubishi ----------
function mitsubishiDoc(s, defs) {
  const m = s.meta || {}, place = o => (o?.nazev || o?.ulice ? [o.nazev, addr(o.ulice, [o.psc, o.mesto].filter(Boolean).join(" ")), o.ic && `IČ ${o.ic}`].filter(Boolean).join(", ") : "");
  let h = kv([["Příjem vozidel", place(m.prijem)], ["Karosárna", m.karosarnaStejna ? "" : place(m.karosarna)], ["Lakovna", m.lakovnaStejna ? "" : place(m.lakovna)]]);
  if (s.meta?.typAuditu === "recert") {
    const r = mitsubishiRecertEval(s, defs), rc = defs.recert;
    const head = !r.ok ? "Neúspěšný audit" : r.tot.empty ? "Nedokončený audit" : "Úspěšný audit";
    h += `<h2>Výsledek – re-certifikační audit ${lvl(r.ok && !r.tot.empty ? 3 : 0, head)}</h2>${kv([["Ano / Částečně / Ne", `${r.tot.A} / ${r.tot.C} / ${r.tot.N}`]])}`;
    h += `<h2>Procesy</h2><table class="pv-tbl"><tbody>${rc.procItems.map(it => { const v = s.recert?.procesy?.[it.id]; return `<tr class="${v === "A" ? "" : "pv-bad"}"><td class="pv-m pv-w">${tri(v)}</td><td>${esc(it.text)}</td></tr>`; }).join("")}</tbody></table>`;
    for (let z = 0; z < rc.orders; z++) {
      const o = s.recert?.zakazky?.[z] || {};
      h += `<h2>Zakázka ${z + 1}${o.cislo ? ` – ${esc(o.cislo)}` : ""}</h2><table class="pv-tbl"><tbody>${rc.orderItems.map(it => { const v = o.v?.[it.id]; return `<tr class="${v === "A" ? "" : "pv-bad"}"><td class="pv-m pv-w">${tri(v)}</td><td>${esc(it.text)}</td></tr>`; }).join("")}</tbody></table>`;
    }
  } else {
    const r = mitsubishiEval(s, defs), T = { KO: "KO", P: "Povinné", D: "Doporučené" };
    h += `<h2>Výsledek – certifikační audit ${lvl(r.ok ? 3 : 0, r.ok ? "Úspěšný audit" : "Neúspěšný audit")}</h2>
      <table class="pv-sum"><tbody>${["KO", "P", "D"].map(t => `<tr><td>${T[t]}</td><td>${lvl(r.tot[t][0] === r.tot[t][1] ? 3 : t === "D" ? 2 : 0, `${r.tot[t][0]} / ${r.tot[t][1]}`)}</td></tr>`).join("")}</tbody></table>`;
    for (const sec of defs.sections) h += `<h2>${esc(sec.title)}</h2><table class="pv-tbl"><tbody>${sec.items.map(it => { const ok = !!s.checks?.[it.id]; return `<tr class="${ok ? "" : "pv-bad"}"><td class="pv-m">${mark(ok)}</td><td class="pv-lv">${esc(it.n)}. <span class="pv-t pv-t${it.type}">${T[it.type]}</span></td><td>${esc(it.text)}</td></tr>`; }).join("")}</tbody></table>`;
  }
  return h + extras(s);
}

function extras(s) {
  let h = "";
  const radky = (s.radky || []).filter(r => Object.values(r).some(v => String(v || "").trim()));
  if (radky.length) h += `<h2>Nedostatky a nápravná opatření</h2><table class="pv-tbl pv-rad"><thead><tr><th>Kritérium</th><th>Nedostatek</th><th>Opatření</th><th>Termín</th><th>Odpovědná osoba</th></tr></thead><tbody>${radky.map(r => `<tr><td>${esc(r.kriterium)}</td><td>${esc(r.nedostatek)}</td><td>${esc(r.opatreni)}</td><td>${esc(r.termin)}</td><td>${esc(r.osoba)}</td></tr>`).join("")}</tbody></table>`;
  if (String(s.poznamky || "").trim()) h += `<h2>Poznámky</h2><p class="pv-pre">${esc(s.poznamky)}</p>`;
  return h;
}

const css = `
.pv-back{position:fixed;inset:0;background:rgba(20,20,20,.6);z-index:2147482000;display:flex;justify-content:center;padding:14px;overflow:auto}
.pv-box{background:#fff;border-radius:14px;width:min(1000px,100%);display:flex;flex-direction:column;max-height:calc(100vh - 28px);overflow:hidden;color:#1e1e1e}
.pv-bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:12px 16px;border-bottom:3px solid #E21F25}
.pv-bar strong{flex:1 1 auto}.pv-only{font-size:.88rem;display:flex;gap:6px;align-items:center;cursor:pointer}
.pv-btns{display:flex;gap:8px}.pv-btns button{border:0;border-radius:9px;padding:8px 14px;font:600 .9rem inherit;cursor:pointer}
.pv-pdf{background:#1e1e1e;color:#fff}.pv-close{background:#fff;border:1px solid #ccc!important}
.pv-doc{overflow:auto;padding:18px 22px 26px;font-size:.88rem;line-height:1.4}
.pv-head{display:flex;gap:14px;align-items:center;margin-bottom:12px}.pv-head img{height:34px}.pv-head h1{font-size:1.15rem;margin:0}.pv-head p{margin:2px 0 0;font-weight:600}
.pv-doc h2{font-size:1rem;margin:20px 0 6px;padding-bottom:4px;border-bottom:1px solid #ddd;display:flex;align-items:center;gap:10px;flex-wrap:wrap;break-after:avoid}
.pv-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px 18px;margin:8px 0}.pv-kv div{display:flex;flex-direction:column}.pv-kv span{font-size:.75rem;color:#777}
.pv-tbl,.pv-sum{width:100%;border-collapse:collapse}.pv-tbl td,.pv-tbl th,.pv-sum td{border-bottom:1px solid #eee;padding:5px 6px;vertical-align:top;text-align:left}
.pv-sum{max-width:520px}.pv-sum td:last-child{text-align:right}
.pv-m{width:28px;text-align:center!important;font-weight:700}.pv-w{width:70px}.pv-lv{width:64px;white-space:nowrap;color:#666;font-size:.8rem}
.pv-ok{color:#2e7d4f;font-weight:700}.pv-nok{color:#E21F25;font-weight:700}.pv-part{color:#c47f00;font-weight:700}.pv-empty{color:#999}
tr.pv-bad{background:#fdf0f0}.pv-grp td{font-weight:700;background:#f4f4f4}
.pv-lvl{display:inline-block;padding:2px 9px;border-radius:999px;font-size:.78rem;font-weight:700;background:#eee}
.pv-l3{background:#e2f4e9;color:#2e7d4f}.pv-l2{background:#eef6e4;color:#4f7d2e}.pv-l1{background:#fff3d6;color:#9a6b00}.pv-l0{background:#fde3e3;color:#b0101d}
.pv-t{display:inline-block;font-size:.7rem;padding:0 5px;border-radius:4px;background:#eee}.pv-tKO{background:#fde3e3;color:#b0101d}.pv-tP{background:#fff3d6}
.pv-pre{white-space:pre-wrap;margin:6px 0}.pv-note{font-size:.78rem;color:#777;margin-top:16px}.pv-foot{font-size:.72rem;color:#999;margin-top:22px}
.pv-msg{padding:20px;text-align:center;color:#666}.pv-err{color:#b0101d}
.pv-only-bad tr:not(.pv-bad):not(.pv-grp) {display:none}.pv-only-bad .pv-sum tr{display:table-row}.pv-only-bad .pv-rad tr{display:table-row}
body.pv-open{overflow:hidden}
@media print{
  body.pv-printing > *:not(.pv-back){display:none!important}
  body.pv-printing .pv-back{position:static;background:none;padding:0;display:block;overflow:visible}
  body.pv-printing .pv-box{max-height:none;width:100%;border-radius:0;overflow:visible;display:block}
  body.pv-printing .pv-bar{display:none}
  body.pv-printing .pv-doc{overflow:visible;padding:0;font-size:9.5pt}
  body.pv-printing tr{break-inside:avoid}
  body.pv-printing tr.pv-bad{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body.pv-printing .pv-lvl{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{size:A4 portrait;margin:12mm}
}`;
{ const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st); }
