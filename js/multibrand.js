// Multi brand – rozdílový list: co musí servis s certifikací výchozí značky doplnit pro cílové značky
import { exportPdf, exportXlsx } from "./export.js?v=20261120k";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TYPE = { KO: "KO", P: "Povinné", N: "Nutné", D: "Doporučené", U1: "Úroveň 1", U2: "Úroveň 2", U3: "Úroveň 3" };
const KIND = { new: "Navíc", strict: "Přísnější", own: "Specifické pro značku" };
const ORDER = { new: 0, strict: 1, own: 2 };
const LOGO = { arval: "assets/logos/arval.png", stellantis: "assets/logos/stellantis.svg", mitsubishi: "assets/logos/mitsubishi.svg", hyundai: "assets/logos/hyundai.svg", byd: "assets/logos/byd.svg", volvo: "assets/logos/volvo.svg", skoda: "assets/logos/skoda.svg", porsche: "assets/logos/porsche-cr.svg", toyota: "assets/logos/toyota.svg" };
const fmtNum = n => String(n).replace(".", ",");
let catalog = null;
const state = { customer: "", base: "", targets: [], arval: "3", incD: false };

export async function renderMultibrand(app) {
  document.title = "Multi brand – rozdílový list | INTERACTION";
  app.innerHTML = `
    <section class="brand-page wide-page mb-page">
      <a class="back" href="#">← Zpět na úvod</a>
      <div class="brand-head brand-head-plain"><div><h2>Multi brand – rozdílový list</h2>
        <p>Zákazník má platnou certifikaci jedné značky a chce se nově auditovat na další. Vyberte značku, kterou už má, a cílové značky – list ukáže, co musí dovybavit nebo zavést navíc.</p></div></div>
      <div id="mbBox"><div class="empty">Načítám katalog požadavků…</div></div>
    </section>`;
  const box = document.getElementById("mbBox");
  try { catalog = catalog || await fetch(new URL("../data/multibrand.json?v=20261120k", import.meta.url)).then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); }); }
  catch (e) { box.innerHTML = `<div class="empty">Katalog se nepodařilo načíst: ${esc(e.message)}</div>`; return; }
  draw(box);
}

const brandIds = () => Object.keys(catalog.brands);
const bName = b => catalog.brands[b];

function allowed(key) {
  const it = catalog.items[key];
  if (it.b === "arval" && /^U\d$/.test(it.ty) && +it.ty[1] > +state.arval) return false;
  if (it.ty === "D" && !state.incD) return false;
  return true;
}

// Výpočet rozdílů
function compute() {
  const { base, targets } = state;
  const rows = [];
  for (const t of catalog.topics) {
    const mem = t.m.filter(allowed);
    const bm = mem.filter(k => catalog.items[k].b === base);
    const per = [];
    for (const tb of targets) {
      const tm = mem.filter(k => catalog.items[k].b === tb);
      if (!tm.length) continue;
      if (t.own) { per.push({ brand: tb, kind: "own", items: tm }); continue; }
      if (!bm.length) { per.push({ brand: tb, kind: "new", items: tm }); continue; }
      const pv = ks => { const v = ks.map(k => t.p[k]).filter(x => x != null); return v.length ? Math.max(...v) : null; };
      const vt = pv(tm), vb = pv(bm);
      if (vt != null && vb != null && vt > vb) per.push({ brand: tb, kind: "strict", items: tm, from: vb, to: vt, baseItems: bm });
    }
    if (!per.length) continue;
    const kind = per.reduce((k, p) => (ORDER[p.kind] < ORDER[k] ? p.kind : k), "own");
    rows.push({ t, kind, per });
  }
  rows.sort((a, b) => catalog.areas.indexOf(a.t.area) - catalog.areas.indexOf(b.t.area) || ORDER[a.kind] - ORDER[b.kind] || a.t.title.localeCompare(b.t.title, "cs"));
  return rows;
}
function coverage() { // kolik požadavků cílové značky už výchozí značka pokrývá
  const res = {};
  for (const tb of state.targets) {
    let need = 0, cov = 0;
    for (const t of catalog.topics) {
      const mem = t.m.filter(allowed);
      if (!mem.some(k => catalog.items[k].b === tb)) continue;
      need++;
      if (!t.own && mem.some(k => catalog.items[k].b === state.base)) cov++;
    }
    res[tb] = { need, cov };
  }
  return res;
}

const critText = k => { const it = catalog.items[k]; return `${it.no ? it.no + " · " : ""}${it.t}`; };
const typeOf = k => TYPE[catalog.items[k].ty] || "";

function draw(box) {
  const ids = brandIds();
  if (state.base && !ids.includes(state.base)) state.base = "";
  state.targets = state.targets.filter(b => b !== state.base);
  const showArval = state.base === "arval" || state.targets.includes("arval");
  const ready = state.base && state.targets.length;
  const rows = ready ? compute() : [];
  const cov = ready ? coverage() : {};
  const cnt = k => rows.reduce((n, r) => n + r.per.filter(p => p.kind === k).length, 0);

  box.innerHTML = `
    <div class="res-card mb-form">
      <div class="mb-step"><span class="mb-n">1</span><div>
        <label class="mb-lbl">Značka, na kterou má zákazník platnou certifikaci</label>
        <div class="mb-brands" data-role="base">${ids.map(b => `<button type="button" class="mb-brand${state.base === b ? " on" : ""}" data-b="${b}"><img src="${LOGO[b]}" alt=""><span>${esc(bName(b))}</span></button>`).join("")}</div>
      </div></div>
      <div class="mb-step"><span class="mb-n">2</span><div>
        <label class="mb-lbl">Nové značky, na které se bude auditovat <span class="mb-hint">(lze vybrat víc)</span></label>
        <div class="mb-brands" data-role="targets">${ids.map(b => `<button type="button" class="mb-brand${state.targets.includes(b) ? " on" : ""}${b === state.base ? " dis" : ""}" data-b="${b}"${b === state.base ? " disabled" : ""}><img src="${LOGO[b]}" alt=""><span>${esc(bName(b))}</span></button>`).join("")}</div>
      </div></div>
      <div class="mb-opts">
        <label class="f-field"><span>Zákazník (pro tisk, nepovinné)</span><input id="mbCust" value="${esc(state.customer)}" placeholder="např. Auto Bárta s.r.o."></label>
        ${showArval ? `<label class="f-field"><span>Úroveň Arval</span><select id="mbArval">${[1, 2, 3].map(n => `<option value="${n}"${state.arval == n ? " selected" : ""}>Úroveň ${n}${n === 3 ? " (všechna kritéria)" : ""}</option>`).join("")}</select></label>` : ""}
        <label class="mb-chk"><input type="checkbox" id="mbIncD"${state.incD ? " checked" : ""}> Zahrnout i doporučená kritéria</label>
      </div>
    </div>
    ${!ready ? `<div class="empty">Vyberte výchozí značku a alespoň jednu novou značku.</div>` : `
    <div class="kpis kpis-3">
      <div class="kpi kpi-expired"><span class="kpi-n">${cnt("new")}</span><span class="kpi-l">Požadavky navíc</span></div>
      <div class="kpi kpi-soon"><span class="kpi-n">${cnt("strict")}</span><span class="kpi-l">Přísnější parametr</span></div>
      <div class="kpi"><span class="kpi-n">${cnt("own")}</span><span class="kpi-l">Specifické pro značku</span></div>
    </div>
    <div class="mb-cov">${state.targets.map(tb => `<span><strong>${esc(bName(tb))}:</strong> ${bName(state.base)} už pokrývá ${cov[tb].cov} z ${cov[tb].need} požadavků (${cov[tb].need ? Math.round(cov[tb].cov / cov[tb].need * 100) : 0} %)</span>`).join("")}</div>
    <div class="res-card">
      <div class="res-toolbar"><input type="search" id="mbSearch" placeholder="Hledat v rozdílovém listu…"><span class="res-exp">
        <button type="button" class="btn-exp" data-x="pdf">Export do PDF</button><button type="button" class="btn-exp" data-x="xlsx">Export do Excelu</button></span></div>
      ${rows.length ? catalog.areas.filter(a => rows.some(r => r.t.area === a)).map(a => `
        <h3 class="mb-area">${esc(a)} <span>${rows.filter(r => r.t.area === a).length}</span></h3>
        ${rows.filter(r => r.t.area === a).map(r => `
          <div class="mb-row k-${r.kind}" data-q="${esc((r.t.title + " " + r.per.map(p => p.items.map(critText).join(" ")).join(" ")).toLowerCase())}">
            <div class="mb-row-h"><span class="mb-kind k-${r.kind}">${KIND[r.kind]}</span><strong>${esc(r.t.title)}</strong></div>
            ${r.per.map(p => `<div class="mb-req"><span class="mb-bchip">${esc(bName(p.brand))}</span><div>
              ${p.kind === "strict" ? `<div class="mb-strict">${esc(bName(state.base))}: ${fmtNum(p.from)} ${esc(r.t.u)} → ${esc(bName(p.brand))}: <b>${fmtNum(p.to)} ${esc(r.t.u)}</b></div>` : ""}
              ${p.items.map(k => `<div class="mb-crit">${esc(critText(k))}${typeOf(k) ? ` <em>${typeOf(k)}</em>` : ""}</div>`).join("")}
              ${p.kind === "own" && r.t.note ? `<div class="mb-note">${esc(r.t.note)}</div>` : ""}
            </div></div>`).join("")}
          </div>`).join("")}`).join("")
      : `<div class="empty">Výchozí značka pokrývá všechny požadavky vybraných značek.</div>`}
    </div>
    <p class="mb-disc">Rozdílový list vychází ze společného katalogu požadavků, který přiřazuje podobná kritéria jednotlivých standardů k sobě. Jde o podklad pro přípravu – rozhodující je vždy znění standardu a výsledek auditu cílové značky.</p>`}`;

  box.querySelectorAll('[data-role="base"] [data-b]').forEach(b => b.onclick = () => { state.base = b.dataset.b; draw(box); });
  box.querySelectorAll('[data-role="targets"] [data-b]').forEach(b => b.onclick = () => {
    const v = b.dataset.b; state.targets = state.targets.includes(v) ? state.targets.filter(x => x !== v) : [...state.targets, v]; draw(box);
  });
  const cust = box.querySelector("#mbCust"); cust.oninput = () => { state.customer = cust.value; };
  const ar = box.querySelector("#mbArval"); if (ar) ar.onchange = () => { state.arval = ar.value; draw(box); };
  box.querySelector("#mbIncD").onchange = e => { state.incD = e.target.checked; draw(box); };
  const s = box.querySelector("#mbSearch");
  if (s) s.oninput = () => { const q = s.value.toLowerCase().trim(); box.querySelectorAll(".mb-row").forEach(r => r.hidden = q && !r.dataset.q.includes(q));
    box.querySelectorAll(".mb-area").forEach(h => { let n = h.nextElementSibling, any = false; while (n && n.classList.contains("mb-row")) { if (!n.hidden) any = true; n = n.nextElementSibling; } h.hidden = !any; }); };
  box.querySelectorAll("[data-x]").forEach(b => b.onclick = () => { const t = table(rows); if (b.dataset.x === "pdf") exportPdf(t); else exportXlsx(t, t.file + ".xlsx"); });
}

function table(rows) {
  const head = ["Oblast", "Požadavek", "Rozdíl", "Značka", "Kritérium značky", "Typ"];
  const body = [], rowClass = [];
  for (const r of rows) for (const p of r.per) {
    const crit = p.items.map(critText).join("\n");
    const diff = p.kind === "strict" ? `Přísnější: ${fmtNum(p.from)} → ${fmtNum(p.to)} ${r.t.u}` : KIND[p.kind];
    body.push([r.t.area, r.t.title, diff, bName(p.brand), crit + (p.kind === "own" && r.t.note ? `\n${r.t.note}` : ""), [...new Set(p.items.map(typeOf).filter(Boolean))].join(", ")]);
    rowClass.push(p.kind === "new" ? "st-expired" : p.kind === "strict" ? "st-soon" : "st-ok");
  }
  const d = new Date(), stamp = d.toISOString().slice(0, 10);
  const tnames = state.targets.map(bName).join(", ");
  const opts = [state.base === "arval" || state.targets.includes("arval") ? `Arval úroveň ${state.arval}` : "", state.incD ? "včetně doporučených kritérií" : "bez doporučených kritérií"].filter(Boolean).join(" · ");
  return {
    title: `Rozdílový list: ${bName(state.base)} → ${tnames}`,
    subtitle: `${state.customer ? state.customer + " · " : ""}Stav k ${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} · ${opts} · ${body.length} položek`,
    sheet: "Rozdílový list", head, rows: body, rowClass,
    file: `rozdilovy_list_${state.base}_${state.targets.join("-")}_${stamp}`,
  };
}
