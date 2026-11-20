// Náhled kompletní výsledkové listiny auditu (jen ke čtení) + export do PDF (tisk prohlížeče)
import { supabase } from "./supabase.js?v=20261121c";
import { formDefs, prepareImport, arvalBreakdown, mitsubishiEval, mitsubishiRecertEval, stOf, czDate, esc } from "./results.js?v=20261121c";

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
      <span class="pv-btns"><button type="button" data-share class="pv-share">Sdílet PDF</button><button type="button" data-pdf class="pv-pdf">Export do PDF</button><button type="button" data-x class="pv-close">Zavřít</button></span></div>
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
  doc.innerHTML = docHtml(brand, rec, defs);
  const prevTitle = document.title;
  box.querySelector("[data-pdf]").onclick = () => {
    document.body.classList.add("pv-printing");
    document.title = `Výsledková listina ${BRAND_NAME[brand]} – ${rec.partner} – ${czDate(rec.audit_date)}`;
    const done = () => { document.body.classList.remove("pv-printing"); document.title = prevTitle; window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    setTimeout(() => window.print(), 50);
    setTimeout(done, 20000);
  };
  const btn = box.querySelector("[data-share]");
  btn.onclick = () => shareClick(btn, () => makePdf(doc), names(brand, rec));
}

const LOGO_URL = new URL("../assets/interaction-logo.png", import.meta.url).href;
const SIG_LBL = { auditor: "Auditor", odpovedna: "Odpovědná osoba", vedeni: "Vedení servisu" };
function sigBlock(s) {
  const sg = s.sig || {}, keys = Object.keys(sg).filter(k => sg[k]);
  if (!keys.length) return "";
  return `<h2>Podpisy</h2><div class="pv-sigs">${keys.map(k => {
    const v = sg[k];
    const k2 = s.kontakty || {}, jm = k === "auditor" ? k2.auditorJmeno : k === "odpovedna" ? k2.odpovednaJmeno : "";
    const dt = k2.datumPodpisu || s.meta?.datumAuditu;
    const inner = typeof v === "string" && v.startsWith("data:image") ? `<img src="${v}" alt="">${jm ? `<b>${esc(jm)}</b>` : ""}<span>Digitálně podepsáno${dt ? ` ${czDate(dt)}` : ""}</span>`
      : typeof v === "object" ? `<b>${esc(v.jmeno || "")}</b><span>Digitálně podepsáno${v.datum ? ` ${czDate(v.datum)}` : ""}</span>` : "";
    return inner ? `<div class="pv-sig"><span class="pv-sigl">${esc(SIG_LBL[k] || k)}</span>${inner}</div>` : "";
  }).join("")}</div>`;
}
function docHtml(brand, rec, defs) {
  const s = rec.data || {};
  let body;
  try { body = brand === "arval" ? arvalDoc(s, defs) : brand === "stellantis" ? stellantisDoc(s, defs) : mitsubishiDoc(s, defs); body += sigBlock(s); }
  catch (e) { body = `<p class="pv-msg pv-err">Listinu se nepodařilo sestavit: ${esc(e.message)}</p>`; }
  const st = rec.next_audit_date ? stOf(rec) : null;
  return `
    <div class="pv-head"><img src="${LOGO_URL}" alt=""><div><h1>Výsledková listina auditu ${esc(BRAND_NAME[brand] || brand)}</h1>
      <p>${esc(rec.partner)}${rec.ic ? ` · IČ ${esc(rec.ic)}` : ""}</p></div></div>
    ${kv([
      ["Druh auditu", rec.audit_kind ? (rec.audit_kind === "nulty" ? "Nultý audit" : "Ostrý audit") : ""],
      ["Datum auditu", czDate(rec.audit_date)],
      ["Příští audit", rec.next_audit_date ? `${czDate(rec.next_audit_date)}${st && rec.audit_kind ? ` (${st.text})` : ""}` : ""],
      ["Platnost", rec.valid_months ? `${rec.valid_months} měsíců` : ""],
      ["Kraj", rec.kraj || ""],
      ["Sídlo", addr(s.meta?.ulice, [s.meta?.psc, s.meta?.mesto].filter(Boolean).join(" "))],
      ["Auditor", s.meta?.auditor || s.kontakty?.auditorJmeno || ""],
    ])}
    ${body}
    <p class="pv-foot">Vytvořeno ${new Date().toLocaleDateString("cs-CZ")} z aplikace Standardy a audity · INTERACTION</p>`;
}
function names(brand, rec) {
  const b = BRAND_NAME[brand] || brand;
  return {
    fname: `Vysledkova_listina_${b}_${rec.partner}_${rec.audit_date || ""}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/_+/g, "_") + ".pdf",
    subject: `Výsledková listina auditu ${b} – ${rec.partner} (${czDate(rec.audit_date)})`,
  };
}

// Sdílet PDF přímo z formuláře (Arval, Stellantis, Mitsubishi) – z aktuálně vyplněných údajů
// Sdílet PDF přímo z formuláře (Arval, Stellantis, Mitsubishi): PDF 1:1 jako „Exportovat do PDF“ (tisková podoba formuláře)
export async function shareFormPdf(brand, state, btn) {
  if (!state?.meta?.partner?.trim()) { alert("Nejdřív vyplňte název zákazníka (partnera) v Základních údajích."); return; }
  if (!state.meta.datumAuditu) { alert("Vyplňte datum auditu."); return; }
  const b = BRAND_NAME[brand] || brand, typ = brand === "mitsubishi" && state.meta.typAuditu === "recert" ? "re-certifikační audit" : "certifikační audit";
  btn._pvNames = {
    fname: `${b}_${typ}_${state.meta.partner}_${state.meta.datumAuditu}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/_+/g, "_") + ".pdf",
    subject: `${b} ${typ} – ${state.meta.partner.trim()} (${czDate(state.meta.datumAuditu)})`,
  };
  return shareClick(btn, printLikePdf, btn._pvNames);
}

// ---------- PDF stejné jako tisk („Exportovat do PDF“) ----------
// Stránka se zkopíruje do skrytého rámu široké jako tisková plocha A4, použijí se její tiskové styly (@media print),
// vyfotí se a rozdělí na strany A4 tak, aby se nepřetrhly řádky a karty (podle pravidel stránkování v tiskových stylech).
const vendor = f => new URL("../assets/vendor/" + f + "?v=20261121c", import.meta.url).href;
const loaded = {};
function loadScript(f, test) {
  if (test()) return Promise.resolve();
  return loaded[f] ||= new Promise((ok, fail) => {
    const sc = document.createElement("script"); sc.src = vendor(f);
    sc.onload = ok; sc.onerror = () => { delete loaded[f]; fail(new Error("Nepodařilo se načíst nástroj pro PDF (jste online?).")); };
    document.head.appendChild(sc);
  });
}
const toMm = v => { const m = String(v || "").trim().match(/^([\d.]+)(mm|cm|in|px|pt)?$/); if (!m) return null; const n = +m[1]; return { cm: n * 10, in: n * 25.4, px: n * 25.4 / 96, pt: n * 25.4 / 72 }[m[2]] ?? n; };

function printCss() {
  let css = "", margin = null;
  const walk = (rules, inPrint) => {
    for (const r of rules) {
      if (r instanceof CSSPageRule) {
        const p = [r.style.marginTop, r.style.marginRight, r.style.marginBottom, r.style.marginLeft].map(toMm);
        if (p.every(x => x != null)) margin = p;
        else if (r.style.margin) { const q = r.style.margin.split(/\s+/).map(toMm); if (q.every(x => x != null)) margin = [q[0], q[1] ?? q[0], q[2] ?? q[0], q[3] ?? q[1] ?? q[0]]; }
        continue;
      }
      if (r instanceof CSSMediaRule) { if (/\bprint\b/.test(r.media.mediaText) || inPrint) walk(r.cssRules, true); continue; }
      if (inPrint) css += r.cssText + "\n";
    }
  };
  for (const sh of document.styleSheets) { try { walk(sh.cssRules, false); } catch { /* cizí styly */ } }
  return { css, margin: margin || [10, 10, 10, 10] };
}

function snapshotHtml() {
  // aktuální hodnoty polí se přepíšou do atributů, aby se přenesly do kopie
  const live = document.documentElement, copy = live.cloneNode(true);
  const lf = live.querySelectorAll("input,textarea,select"), cf = copy.querySelectorAll("input,textarea,select");
  lf.forEach((el, i) => {
    const c = cf[i]; if (!c) return;
    if (el.tagName === "TEXTAREA") c.textContent = el.value;
    else if (el.tagName === "SELECT") [...c.options].forEach((o, j) => { if (el.options[j]?.selected) o.setAttribute("selected", ""); else o.removeAttribute("selected"); });
    else if (el.type === "checkbox" || el.type === "radio") { if (el.checked) c.setAttribute("checked", ""); else c.removeAttribute("checked"); }
    else if (el.type !== "file") c.setAttribute("value", el.value);
  });
  copy.querySelectorAll("script,.pv-back,[data-ia-cover]").forEach(n => n.remove());
  const head = copy.querySelector("head"), base = document.createElement("base"); base.href = document.baseURI; head.prepend(base);
  return "<!DOCTYPE html>" + copy.outerHTML;
}

async function printLikePdf() {
  await loadScript("html2canvas.min.js", () => window.html2canvas);
  await loadScript("jspdf.umd.min.js", () => window.jspdf);
  const { css, margin: [mt, mr, mb, ml] } = printCss();
  const W = Math.round((210 - ml - mr) / 25.4 * 96), H = Math.floor((297 - mt - mb) / 25.4 * 96);
  const fr = document.createElement("iframe");
  fr.setAttribute("aria-hidden", "true");
  fr.style.cssText = `position:fixed;left:-${W + 100}px;top:0;width:${W}px;height:${H}px;border:0;visibility:hidden`;
  document.body.appendChild(fr);
  try {
    await new Promise(ok => { fr.onload = ok; fr.srcdoc = snapshotHtml(); });
    const d = fr.contentDocument;
    // pravidla jen pro obrazovku (@media screen …) se při tisku nepoužijí – odebrat
    const dropScreen = list => { for (let i = list.cssRules.length - 1; i >= 0; i--) { const r = list.cssRules[i]; if (r.type === 4 && r.media) { const m = r.media.mediaText; if (/\bscreen\b/.test(m) && !/\bprint\b/.test(m) && !/not\s+screen/.test(m)) list.deleteRule(i); else dropScreen(r); } } };
    // (úpravy se zapíšou zpět jako text stylu, protože fotografování stránky styly kopíruje z textu)
    for (const sh of [...d.styleSheets]) {
      try {
        const own = sh.ownerNode;
        if (sh.media && /\bscreen\b/.test(sh.media.mediaText) && !/print/.test(sh.media.mediaText)) { own.remove(); continue; }
        dropScreen(sh);
        const txt = [...sh.cssRules].map(r => r.cssText).join("\n");
        if (own.tagName === "STYLE") own.textContent = txt;
        else { const ns = d.createElement("style"); ns.textContent = txt; own.replaceWith(ns); }
      } catch { /* cizí styly (písma) */ }
    }
    const st = d.createElement("style"); st.textContent = css; d.head.appendChild(st);
    d.documentElement.style.background = "#fff";
    // bez posuvníku (ve Windows by zúžil stránku a rozvržení by nesedělo s „fotkou“)
    const noBar = d.createElement("style"); noBar.textContent = "html,body{overflow:hidden!important;scrollbar-width:none}html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}"; d.head.appendChild(noBar);
    // obsah pláten (podpisy)
    const lc = document.querySelectorAll("canvas"), cc = d.querySelectorAll("canvas");
    cc.forEach((c, i) => { const o = lc[i]; if (!o || !o.width || !o.height) return; c.width = o.width; c.height = o.height; c.getContext("2d").drawImage(o, 0, 0); });
    await Promise.all([...d.images].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
    try { await d.fonts.ready; } catch { /* nic */ }
    await new Promise(r => setTimeout(r, 120));
    // Je-li obsah širší než papír, Chrome ho při tisku rozvrhne aspoň na 4/3 šířky a zmenší (nejvýš 2×) – totéž zde
    let CW = W;
    const contentW = () => { let m = 0; for (const e of d.body.querySelectorAll("*")) { const r = e.getBoundingClientRect(); if (r.width && r.right > m) m = r.right; } return Math.max(m, d.body.scrollWidth); };
    if (contentW() > W + 1) { CW = Math.round(W * 4 / 3); fr.style.width = CW + "px"; await new Promise(r => setTimeout(r, 80)); }
    for (let k = 0; k < 4; k++) {
      const sw = Math.ceil(contentW());
      if (sw <= CW + 1 || sw > W * 2) break;
      CW = sw; fr.style.width = CW + "px"; await new Promise(r => setTimeout(r, 80));
    }
    const PH = Math.floor(H * CW / W);

    // Stránkování jako při tisku: řádky a karty, které by se přetrhly na hraně strany, se odsunou na další stranu
    // (každý sloupec zvlášť), nucené zalomení (break-before: page) začne novou stranu. Pak se stránka jen rozřeže po A4.
    const body = d.body, win = fr.contentWindow;
    const top0 = () => body.getBoundingClientRect().top;
    const isForced = cs => /page|always|left|right/.test(cs.breakBefore) || /always/.test(cs.pageBreakBefore);
    const isAvoid = (el, cs) => /avoid/.test(cs.breakInside) || /avoid/.test(cs.pageBreakInside) || /^(TR|IMG|CANVAS|SVG)$/i.test(el.tagName);
    const keepNext = cs => /avoid/.test(cs.breakAfter) || /avoid/.test(cs.pageBreakAfter);
    const push = (el, delta) => {
      if (delta < 0.5) return;
      if (el.tagName === "TR") {
        const tr = d.createElement("tr"), td = d.createElement("td");
        td.colSpan = 99; td.style.cssText = `height:${delta}px;padding:0;border:0;background:transparent`;
        tr.style.cssText = "border:0;background:transparent"; tr.appendChild(td); el.before(tr); return;
      }
      const mt = parseFloat(win.getComputedStyle(el).marginTop) || 0;
      el.style.setProperty("margin-top", (mt + delta) + "px", "important");
    };
    const els = [...body.querySelectorAll("*")].filter(el => { const cs = win.getComputedStyle(el); return cs.display !== "none" && cs.position !== "fixed" && cs.position !== "absolute"; });
    const done = new Set();
    for (const el of els) {
      if ([...done].some(x => x.contains(el))) continue;
      const cs = win.getComputedStyle(el);
      let r = el.getBoundingClientRect(); if (!r.height) continue;
      let t = r.top - top0(), bt = r.bottom - top0();
      if (isForced(cs) && t > 4) { const off = t % PH; if (off > 1 && PH - off > 1) { push(el, PH - off); r = el.getBoundingClientRect(); t = r.top - top0(); bt = r.bottom - top0(); } }
      const B = (Math.floor(t / PH) + 1) * PH; // nejbližší hrana strany pod horním okrajem prvku
      if (isAvoid(el, cs) && r.height <= PH * 0.95 && bt > B + 0.5) { push(el, B - t); done.add(el); continue; }
      if (keepNext(cs) && r.height < PH * 0.3 && bt + 40 > B && t < B) { push(el, B - t); continue; }
    }
    const total = Math.ceil(body.scrollHeight);
    const cuts = []; for (let y = 0; y < total - 2; y += PH) cuts.push(y); cuts.push(total);

    const scale = Math.max(1, Math.min(2, Math.sqrt(15e6 / (CW * total))));
    const canvas = await window.html2canvas(body, { scale, useCORS: true, backgroundColor: "#ffffff", width: CW, windowWidth: CW, height: total, windowHeight: H, scrollX: 0, scrollY: 0, logging: false });
    const pdf = new window.jspdf.jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const mmPerPx = (210 - ml - mr) / CW;
    for (let i = 0; i < cuts.length - 1; i++) {
      const y0 = cuts[i], h = cuts[i + 1] - y0;
      const pc = document.createElement("canvas"); pc.width = canvas.width; pc.height = Math.max(1, Math.round(h * scale));
      const g = pc.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, pc.width, pc.height);
      g.drawImage(canvas, 0, Math.round(y0 * scale), canvas.width, pc.height, 0, 0, pc.width, pc.height);
      if (i) pdf.addPage();
      pdf.addImage(pc.toDataURL("image/jpeg", 0.85), "JPEG", ml, mt, 210 - ml - mr, h * mmPerPx);
    }
    return pdf.output("blob");
  } finally { if (!window.IA_PDF_DEBUG) fr.remove(); }
}

// ---------- Sdílet PDF (e-mail, Outlook, WhatsApp… podle nabídky Sdílet v systému) ----------
let h2pLoading = null;
function loadHtml2pdf() {
  if (window.html2pdf) return Promise.resolve(window.html2pdf);
  return h2pLoading ||= new Promise((ok, fail) => {
    const sc = document.createElement("script");
    sc.src = new URL("../assets/vendor/html2pdf.bundle.min.js?v=20261121c", import.meta.url).href;
    sc.onload = () => ok(window.html2pdf); sc.onerror = () => { h2pLoading = null; fail(new Error("Nepodařilo se načíst nástroj pro PDF (jste online?).")); };
    document.head.appendChild(sc);
  });
}
async function makePdf(doc) {
  const h2p = await loadHtml2pdf();
  const el = document.createElement("div");
  el.className = "pv-doc pv-pdf-doc" + (doc.classList.contains("pv-only-bad") ? " pv-only-bad" : "");
  el.innerHTML = doc.innerHTML;
  return h2p().set({
    margin: [10, 10, 12, 10],
    image: { type: "jpeg", quality: 0.85 },
    html2canvas: { scale: 1.6, useCORS: true, backgroundColor: "#ffffff" },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak: { mode: ["css", "legacy"], avoid: ["tr", ".pv-kv", ".pv-head", "h2", "h3"] },
  }).from(el).outputPdf("blob");
}
function download(file) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
async function shareClick(btn, build, { fname, subject }) {
  if (btn.disabled) return;
  const label = btn._pvLabel ||= btn.innerHTML;
  const reset = () => { btn._pvReady = null; btn.innerHTML = label; btn.classList.remove("pv-ready"); };
  let file = btn._pvReady;
  if (!file) {
    btn.disabled = true; btn.textContent = "Připravuji PDF…";
    try { file = new File([await build()], fname, { type: "application/pdf" }); }
    catch (e) { alert("PDF se nepodařilo vytvořit: " + e.message); btn.disabled = false; reset(); return; }
    btn.disabled = false; btn.innerHTML = label;
  }
  if (!(navigator.canShare && navigator.canShare({ files: [file] }))) {
    download(file); reset();
    alert("Tento prohlížeč neumí soubor sdílet přímo do aplikace. PDF se stáhlo do počítače – přiložte ho do e-mailu ručně.\n\nTip: ve Windows použijte Microsoft Edge nebo Google Chrome.");
    return;
  }
  try { await navigator.share({ files: [file], title: subject, text: subject }); reset(); }
  catch (e) {
    if (e.name === "AbortError") { reset(); return; }
    if (e.name === "NotAllowedError") { btn._pvReady = file; btn.textContent = "PDF je připravené – klepněte znovu"; btn.classList.add("pv-ready"); return; }
    reset(); download(file); alert("Sdílení se nepodařilo, PDF se stáhlo – přiložte ho ručně.");
  }
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
.pv-btns{display:flex;flex-wrap:wrap;gap:8px}.pv-btns button{border:0;border-radius:9px;padding:8px 14px;font:600 .9rem inherit;cursor:pointer}
.pv-pdf{background:#1e1e1e;color:#fff}.pv-share{background:#e30613;color:#fff}.pv-share.pv-ready{background:#1d7a3a}.pv-share:disabled{opacity:.7;cursor:wait}
.pv-sigs{display:flex;flex-wrap:wrap;gap:16px}.pv-sig{border:1px solid #ddd;border-radius:8px;padding:8px 12px;min-width:200px;display:flex;flex-direction:column;gap:2px}.pv-sig img{max-height:70px;max-width:260px}.pv-sigl{font-size:.75rem;color:#777}
.btn.pv-ready{background:#1d7a3a!important;color:#fff!important;border-color:#1d7a3a!important}
.pv-pdf-doc{overflow:visible!important;max-height:none!important;padding:0!important;background:#fff;font-size:9.5pt}.pv-pdf-doc tr.pv-bad,.pv-pdf-doc .pv-lvl{-webkit-print-color-adjust:exact}.pv-close{background:#fff;border:1px solid #ccc!important}
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
