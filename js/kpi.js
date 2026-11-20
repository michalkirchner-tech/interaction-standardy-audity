// KPI servisních partnerů (lakovna, karosárna) – jen pro administrátora
// Krok 1: partneři a pobočky · Krok 2: zadávání vstupů za období · Krok 3: výstupy
import { supabase } from "./supabase.js?v=20261121a";
import { renderRequests } from "./kpi-requests.js?v=20261121a";
import { renderCompare } from "./kpi-compare.js?v=20261121a";
import { outputsHtml, loadAllEntries, loadTargets, targetsFormHtml, saveTargets } from "./kpi-out.js?v=20261121a";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const czErr = e => /kpi_partners_name_uq/.test(e?.message || "") ? "Partner s tímto názvem už existuje."
  : /kpi_branches_name_uq/.test(e?.message || "") ? "Dvě pobočky nesmí mít stejný název."
  : (e?.message || String(e));

import { LAK, KAR, PAINT } from "./kpi-defs.js?v=20261121a";
import { hoursHtml, bindHours, collectHours } from "./kpi-hours.js?v=20261121a";
export { LAK, KAR, PAINT };
export const PTYPES = { M: "Měsíc", Q: "Kvartál", H: "Pololetí", Y: "Rok" };
const MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
export const periodNos = t => t === "M" ? 12 : t === "Q" ? 4 : t === "H" ? 2 : 1;
export const periodName = (t, n) => t === "M" ? MONTHS[n - 1] : t === "Q" ? `${n}. kvartál` : t === "H" ? `${n}. pololetí` : "celý rok";
export const periodLabel = e => `${periodName(e.period_type, e.period_no)} ${e.year}`;
// rozsah měsíců, které období pokrývá
export const monthsOf = (t, n) => t === "M" ? [n, n] : t === "Q" ? [n * 3 - 2, n * 3] : t === "H" ? [n * 6 - 5, n * 6] : [1, 12];
const pOrder = { Y: 0, H: 1, Q: 2, M: 3 };

// čísla: zobrazení s mezerami a desetinnou čárkou, čtení s tolerancí
export const fmtNum = (v, dec = 2) => v == null || v === "" || isNaN(v) ? "" : Number(v).toLocaleString("cs-CZ", { maximumFractionDigits: dec });
const parseNum = s => { const t = String(s ?? "").replace(/\s| /g, "").replace(",", "."); if (t === "") return null; const n = Number(t); return isNaN(n) ? NaN : n; };

let partners = [];
let current = null;    // otevřený partner
let sel = null;        // zvolené období { year, type, no }
let dirty = false;

async function loadPartners() {
  const { data, error } = await supabase.from("kpi_partners")
    .select("id,name,ic,note,has_kar,has_painters,in_benchmark,created_at,kpi_branches(id,name,sort,kpi_painters(id,name,sort))")
    .order("name");
  if (error) throw error;
  data.forEach(p => {
    p.kpi_branches.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "cs"));
    p.kpi_branches.forEach(b => b.kpi_painters.sort((a, c) => a.sort - c.sort));
  });
  return data;
}

async function loadEntries(pid) {
  const { data, error } = await supabase.from("kpi_entries").select("id,year,period_type,period_no,data,updated_at").eq("partner_id", pid);
  if (error) throw error;
  return data.sort((a, b) => b.year - a.year || pOrder[a.period_type] - pOrder[b.period_type] || a.period_no - b.period_no);
}

export async function renderKpi(app) {
  document.title = "KPI servisních partnerů | INTERACTION";
  dirty = false;
  app.innerHTML = `
    <section class="brand-page wide-page kpi-page">
      <a class="back" href="#" id="kpiTopBack">← Zpět na úvod</a>
      <div class="brand-head brand-head-plain"><div><h2>KPI servisních partnerů</h2>
        <p>Sledování ukazatelů lakovny a karosárny. Vidí jen administrátor.</p></div></div>
      <div id="kpiBox"><div class="empty">Načítám…</div></div>
    </section>`;
  window.scrollTo(0, 0);
  await showList();
}

function box() { return document.getElementById("kpiBox"); }

// Horní odkaz zpět: v seznamu partnerů vede na úvod, jinde zpět na přehled KPI
function setBack(toList) {
  const a = document.getElementById("kpiTopBack"); if (!a) return;
  a.textContent = toList ? "← Zpět na přehled KPI" : "← Zpět na úvod";
  a.onclick = toList ? e => { e.preventDefault(); if (leaveOk()) { showList(); window.scrollTo(0, 0); } } : null;
}
const leaveOk = () => !dirty || confirm("Máte neuložené změny ve vstupech. Opravdu odejít bez uložení?");
window.addEventListener("beforeunload", e => { if (dirty && document.getElementById("kpiInputs")) { e.preventDefault(); e.returnValue = ""; } });

// ---------- Seznam partnerů ----------
async function showList(msg = "") {
  const b = box(); if (!b) return;
  dirty = false; current = null;
  setBack(false);
  try { partners = await loadPartners(); }
  catch (e) { b.innerHTML = `<div class="empty">Data se nepodařilo načíst: ${esc(e.message)}</div>`; return; }
  let counts = {};
  try {
    const { data } = await supabase.from("kpi_entries").select("partner_id,year");
    (data || []).forEach(r => { const c = counts[r.partner_id] ||= { n: 0, years: new Set() }; c.n++; c.years.add(r.year); });
  } catch { /* počty jsou jen informativní */ }
  let pending = [];
  try {
    const { data } = await supabase.from("kpi_requests").select("id,partner_id,year,period_type,period_no,filled_by,filled_at")
      .not("filled_at", "is", null).is("imported_at", null).order("filled_at", { ascending: false });
    pending = data || [];
  } catch { /* upozornění je jen doplněk */ }
  document.dispatchEvent(new Event("kpi-inbox-changed"));
  b.innerHTML = `
    ${pending.length ? `<div class="res-card kpi-inbox">
      <h3>📨 Nová vyplnění od partnerů <span class="kpi-inbox-n">${pending.length}</span></h3>
      <p class="f-note">Partner údaje odeslal přes odkaz. Do vstupů se uloží, až je zkontrolujete a potvrdíte.</p>
      <table class="res-table"><tbody>${pending.map(r => `<tr>
        <td><strong>${esc(partners.find(p => p.id === r.partner_id)?.name || "?")}</strong></td>
        <td>${periodName(r.period_type, r.period_no)} ${r.year}</td>
        <td class="muted-cell">vyplnil(a) ${esc(r.filled_by)} · ${new Date(r.filled_at).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" })}</td>
        <td class="kpi-actions"><button type="button" class="btn-save kpi-btn kpi-btn-sm" data-inbox="${r.id}" data-ip="${r.partner_id}">Zkontrolovat a uložit</button></td>
      </tr>`).join("")}</tbody></table></div>` : ""}
    <div class="res-card">
      <div class="kpi-bar">
        <h3>Servisní partneři</h3>
        <div class="kpi-bar-btns">${partners.length ? `<button type="button" class="btn-logout kpi-btn-cmp" id="kpiCmp">⚖️ Porovnat partnery</button>` : ""}
        <button type="button" class="btn-save kpi-btn" id="kpiNew">+ Založit partnera</button></div>
      </div>
      ${msg ? `<p class="kpi-ok">${msg}</p>` : ""}
      ${partners.length ? `
      <div class="table-wrap"><table class="res-table">
        <thead><tr><th>Partner</th><th>Pobočky</th><th>Sleduje</th><th>Zadaná období</th><th></th></tr></thead>
        <tbody>${partners.map(p => { const c = counts[p.id]; return `<tr>
          <td><a href="#kpi" class="kpi-open" data-open="${p.id}"><strong>${esc(p.name)}</strong></a><span class="muted">${p.ic ? "IČO " + esc(p.ic) : ""}${p.note ? (p.ic ? " · " : "") + esc(p.note) : ""}</span></td>
          <td>${p.kpi_branches.map(x => esc(x.name)).join(", ") || "—"}</td>
          <td class="muted-cell">Lakovna${p.has_kar ? ", karosárna" : ""}${p.has_painters ? ", lakýrníci" : ""}${p.in_benchmark === false ? `<span class="muted">mimo benchmark</span>` : ""}</td>
          <td class="muted-cell">${c ? `${c.n} · roky ${[...c.years].sort().join(", ")}` : "zatím nic"}</td>
          <td class="kpi-actions"><button type="button" class="btn-save kpi-btn kpi-btn-sm" data-open="${p.id}">Zobrazit</button>
            <button type="button" class="btn-logout" data-edit="${p.id}">Upravit</button>
            <button type="button" class="btn-del" data-del="${p.id}">Smazat</button></td>
        </tr>`; }).join("")}</tbody></table></div>`
      : `<div class="empty">Zatím není založený žádný partner. Začněte tlačítkem „Založit partnera“.</div>`}
    </div>`;
  document.getElementById("kpiNew").onclick = () => showForm(null);
  const cmp = document.getElementById("kpiCmp"); if (cmp) cmp.onclick = showCompare;
  b.querySelectorAll("[data-inbox]").forEach(x => x.onclick = () => { mode = "req"; openReview = x.dataset.inbox; showPartner(x.dataset.ip); });
  b.querySelectorAll("[data-open]").forEach(x => x.onclick = e => { e.preventDefault(); showPartner(x.dataset.open); });
  b.querySelectorAll("[data-edit]").forEach(x => x.onclick = () => showForm(partners.find(p => p.id === x.dataset.edit)));
  b.querySelectorAll("[data-del]").forEach(x => x.onclick = () => delPartner(partners.find(p => p.id === x.dataset.del), x));
}

async function delPartner(p, btn) {
  if (!confirm(`Opravdu smazat partnera „${p.name}“ včetně všech jeho poboček a zadaných KPI dat?\n\nTuto akci nelze vrátit.`)) return;
  btn.disabled = true;
  const { error } = await supabase.from("kpi_partners").delete().eq("id", p.id);
  if (error) { alert("Smazání se nepodařilo: " + czErr(error)); btn.disabled = false; return; }
  showList(`Partner „${esc(p.name)}“ byl smazán.`);
}

// ---------- Porovnání partnerů ----------
async function showCompare() {
  const b = box();
  setBack(true);
  b.innerHTML = `<div class="empty">Načítám…</div>`;
  window.scrollTo(0, 0);
  try { [allEntries, targets] = await Promise.all([loadAllEntries(), loadTargets()]); }
  catch (e) { b.innerHTML = `<div class="empty">Data se nepodařilo načíst: ${esc(e.message)}</div>`; return; }
  renderCompare(b, { partners, allEntries, targets });
}

// ---------- Formulář partnera ----------
function branchRow(br = {}) {
  return `<div class="kpi-branch" data-id="${br.id || ""}">
    <div class="kpi-branch-line">
      <input name="branch" value="${esc(br.name || "")}" placeholder="Název pobočky, např. Veleslavín">
      <button type="button" class="btn-del" data-rm title="Odebrat pobočku">✕</button>
    </div>
    <input name="painters" class="kpi-painters" value="${esc((br.kpi_painters || []).map(x => x.name).join(", "))}" placeholder="Lakýrníci této pobočky, oddělte čárkou (např. Tomáš Černý, Michal Brožek)">
  </div>`;
}

function showForm(p) {
  const b = box();
  setBack(true);
  const edit = !!p;
  b.innerHTML = `
    <div class="res-card kpi-form-card">
      <h3>${edit ? `Upravit partnera – ${esc(p.name)}` : "Nový servisní partner"}</h3>
      <form id="kpiForm" class="kpi-form" novalidate>
        <label>Název partnera *<input name="name" value="${esc(p?.name || "")}" required placeholder="např. Přerost a Švarc"></label>
        <label>IČO<input name="ic" value="${esc(p?.ic || "")}" inputmode="numeric" maxlength="8" placeholder="nepovinné"></label>
        <label class="kpi-wide">Poznámka<input name="note" value="${esc(p?.note || "")}" placeholder="nepovinné"></label>
        <div class="kpi-wide kpi-checks">
          <div class="kpi-lbl">Co u partnera sledujeme</div>
          <label class="kpi-check"><input type="checkbox" checked disabled> Lakovna (vždy)</label>
          <label class="kpi-check"><input type="checkbox" name="has_kar" ${p?.has_kar ? "checked" : ""}> Karosárna – zaměstnanci, hodiny, zakázky</label>
          <label class="kpi-check"><input type="checkbox" name="has_painters" ${p?.has_painters ? "checked" : ""}> Spotřeba materiálu podle lakýrníků (plnič, barva, lak)</label>
          <label class="kpi-check"><input type="checkbox" name="in_benchmark" ${p?.in_benchmark === false ? "" : "checked"}> Započítávat do benchmarku (vypněte u ukázkových nebo netypických dat)</label>
        </div>
        <div class="kpi-wide">
          <div class="kpi-lbl">Pobočky (střediska) *</div>
          <p class="f-note">Každá pobočka má vlastní vstupy i výstupy KPI. Má-li partner jen jedno místo, založte jednu pobočku (např. „Spořilov“).</p>
          <div id="kpiBranches">${(p?.kpi_branches?.length ? p.kpi_branches : [{}]).map(branchRow).join("")}</div>
          <button type="button" class="btn-logout" id="kpiAddBranch">+ Přidat pobočku</button>
        </div>
        <div class="auth-msg kpi-wide" id="kpiMsg"></div>
        <div class="kpi-wide">
          <button type="submit" class="btn-save kpi-btn">${edit ? "Uložit změny" : "Založit partnera"}</button>
          <button type="button" class="btn-logout" id="kpiCancel">Zrušit</button>
        </div>
      </form>
    </div>`;
  const form = document.getElementById("kpiForm");
  const list = document.getElementById("kpiBranches");
  const showPainters = () => list.classList.toggle("no-painters", !form.has_painters.checked);
  form.has_painters.onchange = showPainters; showPainters();
  const bindRm = () => list.querySelectorAll("[data-rm]").forEach(x => x.onclick = () => {
    const row = x.closest(".kpi-branch");
    if (list.children.length === 1) { row.querySelectorAll("input").forEach(i => i.value = ""); return; }
    row.remove();
  });
  bindRm();
  document.getElementById("kpiAddBranch").onclick = () => { list.insertAdjacentHTML("beforeend", branchRow()); bindRm(); list.lastElementChild.querySelector("input").focus(); };
  document.getElementById("kpiCancel").onclick = () => showList();
  form.onsubmit = async e => {
    e.preventDefault();
    const out = document.getElementById("kpiMsg");
    const name = form.name.value.trim(), ic = form.ic.value.trim(), note = form.note.value.trim();
    const rows = [...list.children].map((el, i) => ({
      id: el.dataset.id || null, name: el.querySelector("[name=branch]").value.trim(), sort: i,
      painters: el.querySelector("[name=painters]").value.split(/[,;\n]/).map(s => s.trim()).filter(Boolean),
    })).filter(r => r.name);
    if (!name) { out.textContent = "Vyplňte název partnera."; return; }
    if (ic && !/^\d{8}$/.test(ic)) { out.textContent = "IČO musí mít 8 číslic (nebo ho nechte prázdné)."; return; }
    if (!rows.length) { out.textContent = "Zadejte alespoň jednu pobočku."; return; }
    const lower = rows.map(r => r.name.toLowerCase());
    if (new Set(lower).size !== lower.length) { out.textContent = "Dvě pobočky nesmí mít stejný název."; return; }
    const removed = edit ? p.kpi_branches.filter(o => !rows.some(r => r.id === o.id)) : [];
    if (removed.length && !confirm(`Odebíráte pobočky: ${removed.map(r => r.name).join(", ")}.\n\nV zadaných obdobích se přestanou zobrazovat a počítat. Pokračovat?`)) return;
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      let pid = p?.id;
      const fields = { name, ic: ic || null, note: note || null, has_kar: form.has_kar.checked, has_painters: form.has_painters.checked, in_benchmark: form.in_benchmark.checked };
      if (edit) {
        const { error } = await supabase.from("kpi_partners").update(fields).eq("id", pid);
        if (error) throw error;
        if (removed.length) {
          const { error: e2 } = await supabase.from("kpi_branches").delete().in("id", removed.map(r => r.id));
          if (e2) throw e2;
        }
      } else {
        const { data, error } = await supabase.from("kpi_partners").insert(fields).select("id").single();
        if (error) throw error;
        pid = data.id;
      }
      for (const r of rows) {
        if (r.id) {
          const { error } = await supabase.from("kpi_branches").update({ name: r.name, sort: r.sort }).eq("id", r.id);
          if (error) throw error;
        } else {
          const { data, error } = await supabase.from("kpi_branches").insert({ partner_id: pid, name: r.name, sort: r.sort }).select("id").single();
          if (error) throw error;
          r.id = data.id;
        }
        await syncPainters(r, edit ? p.kpi_branches.find(o => o.id === r.id)?.kpi_painters || [] : []);
      }
      showList(edit ? `Změny u partnera „${esc(name)}“ jsou uložené.` : `Partner „${esc(name)}“ je založený. Klikněte na „Zobrazit“ a zadejte vstupy.`);
    } catch (err) { out.textContent = "Uložení se nepodařilo: " + czErr(err); btn.disabled = false; }
  };
  form.name.focus();
}

// Lakýrníci se párují podle jména – přejmenování = nový lakýrník (jeho dřívější data zůstanou u starého jména)
async function syncPainters(row, old) {
  const keep = old.filter(o => row.painters.some(n => n.toLowerCase() === o.name.toLowerCase()));
  const drop = old.filter(o => !keep.includes(o));
  if (drop.length) { const { error } = await supabase.from("kpi_painters").delete().in("id", drop.map(x => x.id)); if (error) throw error; }
  for (const [i, n] of row.painters.entries()) {
    const ex = keep.find(o => o.name.toLowerCase() === n.toLowerCase());
    const { error } = ex
      ? await supabase.from("kpi_painters").update({ name: n, sort: i }).eq("id", ex.id)
      : await supabase.from("kpi_painters").insert({ branch_id: row.id, name: n, sort: i });
    if (error) throw error;
  }
}

// ---------- Detail partnera: zadávání vstupů ----------
let entries = [];
let mode = "in";      // "in" = vstupy, "out" = výstupy, "req" = sběr dat
let openReview = null; // id vyplnění, které se má po otevření partnera rovnou zobrazit
let allEntries = [], targets = {};

async function showPartner(pid, msg = "") {
  const b = box();
  setBack(true);
  current = partners.find(p => p.id === pid);
  if (!current) return showList();
  b.innerHTML = `<div class="empty">Načítám…</div>`;
  try { [entries, allEntries, targets] = await Promise.all([loadEntries(pid), loadAllEntries(), loadTargets()]); }
  catch (e) { b.innerHTML = `<div class="empty">Data se nepodařilo načíst: ${esc(e.message)}</div>`; return; }
  if (!sel || sel.pid !== pid) {
    const last = entries[0];
    sel = last ? { pid, year: last.year, type: last.period_type, no: last.period_no } : { pid, year: new Date().getFullYear(), type: "Q", no: 1 };
  }
  b.innerHTML = `
    <div class="res-card">
      <div class="kpi-bar">
        <div><h3 class="kpi-title">${esc(current.name)}</h3>
          <span class="muted-cell">Pobočky: ${current.kpi_branches.map(x => esc(x.name)).join(", ")}</span></div>
        <div class="kpi-tabs"><button type="button" data-mode="in" class="${mode === "in" ? "active" : ""}">Vstupy</button><button type="button" data-mode="out" class="${mode === "out" ? "active" : ""}">Výstupy</button><button type="button" data-mode="req" class="${mode === "req" ? "active" : ""}">📨 Sběr dat od partnera</button></div>
      </div>
      ${msg ? `<p class="kpi-ok">${msg}</p>` : ""}
      <div class="kpi-period">
        <label>Rok<select id="pYear">${yearOptions()}</select></label>
        <label>Sledované období<select id="pType">${Object.entries(PTYPES).map(([k, v]) => `<option value="${k}" ${k === sel.type ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label id="pNoWrap">Které<select id="pNo"></select></label>
      </div>
      <div class="kpi-saved"><span class="kpi-lbl-sm">Uložená období:</span> ${entries.length ? entries.map(e => `<button type="button" class="kpi-chip" data-y="${e.year}" data-t="${e.period_type}" data-n="${e.period_no}">${periodLabel(e)}</button>`).join("") : `<span class="muted-cell">zatím žádné</span>`}</div>
      <div id="kpiInputs"></div>
    </div>`;
  b.querySelectorAll("[data-mode]").forEach(t => t.onclick = () => {
    if (t.dataset.mode === mode || (mode === "in" && !leaveOk())) return;
    mode = t.dataset.mode; dirty = false;
    b.querySelectorAll("[data-mode]").forEach(x => x.classList.toggle("active", x === t));
    draw();
  });
  const pYear = document.getElementById("pYear"), pType = document.getElementById("pType"), pNo = document.getElementById("pNo");
  const fillNo = () => {
    const n = periodNos(sel.type);
    if (sel.no > n) sel.no = 1;
    pNo.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${i + 1 === sel.no ? "selected" : ""}>${periodName(sel.type, i + 1)}</option>`).join("");
    document.getElementById("pNoWrap").hidden = sel.type === "Y";
  };
  const change = (fn) => () => { if (!leaveOk()) { pYear.value = sel.year; pType.value = sel.type; fillNo(); return; } fn(); fillNo(); draw(); };
  pYear.onchange = change(() => sel.year = +pYear.value);
  pType.onchange = change(() => sel.type = pType.value);
  pNo.onchange = change(() => sel.no = +pNo.value);
  b.querySelectorAll(".kpi-chip").forEach(c => c.onclick = () => {
    if (!leaveOk()) return;
    Object.assign(sel, { year: +c.dataset.y, type: c.dataset.t, no: +c.dataset.n });
    pYear.innerHTML = yearOptions(); pType.value = sel.type; fillNo(); draw();
  });
  fillNo();
  draw();
}

const draw = () => {
  box().querySelector(".res-card")?.classList.toggle("kpi-mode-req", mode === "req");
  if (mode === "req") {
    dirty = false;
    const open = openReview; openReview = null;
    return renderRequests(document.getElementById("kpiInputs"), current, sel, async () => { [entries, allEntries] = await Promise.all([loadEntries(current.id), loadAllEntries()]); }, open);
  }
  return mode === "out" ? drawOutputs() : drawInputs();
};

function drawOutputs() {
  dirty = false;
  const host = document.getElementById("kpiInputs");
  host.innerHTML = `
    <div class="kpi-bar kpi-out-bar"><h4 class="kpi-h">Výstupy – ${periodName(sel.type, sel.no)} ${sel.year}</h4>
      <button type="button" class="btn-logout" id="kpiTgOpen">🎯 Vlastní cílové benchmarky</button></div>
    <div id="kpiTg"></div>
    ${outputsHtml({ partner: current, entries, allEntries, partners, targets, sel })}`;
  document.getElementById("kpiTgOpen").onclick = () => {
    const tg = document.getElementById("kpiTg");
    if (tg.innerHTML) { tg.innerHTML = ""; return; }
    tg.innerHTML = targetsFormHtml(targets);
    document.getElementById("kpiTgClose").onclick = () => tg.innerHTML = "";
    document.getElementById("kpiTgSave").onclick = async () => {
      const btn = document.getElementById("kpiTgSave"); btn.disabled = true;
      try { await saveTargets(tg); targets = await loadTargets(); drawOutputs(); }
      catch (e) { document.getElementById("kpiTgMsg").textContent = "Uložení se nepodařilo: " + e.message; btn.disabled = false; }
    };
  };
}

function yearOptions() {
  const now = new Date().getFullYear();
  const ys = new Set([now + 1, now, now - 1, now - 2, now - 3, ...entries.map(e => e.year), sel.year]);
  return [...ys].sort((a, b) => b - a).map(y => `<option ${y === sel.year ? "selected" : ""}>${y}</option>`).join("");
}

const findEntry = () => entries.find(e => e.year === sel.year && e.period_type === sel.type && e.period_no === sel.no);

// Upozornění na překryv s jinak dlouhými obdobími téhož roku
function overlapNote() {
  const [a, z] = monthsOf(sel.type, sel.no);
  const ov = entries.filter(e => e.year === sel.year && e.period_type !== sel.type)
    .filter(e => { const [b, c] = monthsOf(e.period_type, e.period_no); return b <= z && c >= a; });
  if (!ov.length) return "";
  return `<p class="f-note kpi-note">ℹ️ Pro stejné měsíce jsou uložená i jiná období: ${ov.map(periodLabel).join(", ")}. Ve výstupech se vždy použije přímo zadané období; když chybí, sečte se z kratších (např. kvartál ze tří měsíců).</p>`;
}

function inputCell(val, attrs) {
  return `<td><input class="kpi-num" inputmode="decimal" ${attrs} value="${esc(fmtNum(val, 4))}"></td>`;
}

function drawInputs() {
  dirty = false;
  const host = document.getElementById("kpiInputs");
  const p = current, e = findEntry(), d = e?.data || {};
  const br = p.kpi_branches;
  const sectionRows = (defs) => defs.filter(m => !m.hours).map(m => `
    <tr><th scope="row">${esc(m.l)}<span class="muted">${m.u}${m.avg ? " · průměrný stav za období" : ""}${m.hint ? " · " + esc(m.hint) : ""}</span></th>
      ${br.map(x => inputCell(d.b?.[x.id]?.[m.k], `data-b="${x.id}" data-k="${m.k}"`)).join("")}
      ${br.length > 1 ? `<td class="kpi-sum" data-sum="${m.k}"></td>` : ""}</tr>`).join("");
  const head = `<thead><tr><th>Ukazatel</th>${br.map(x => `<th>${esc(x.name)}</th>`).join("")}${br.length > 1 ? "<th>Celkem</th>" : ""}</tr></thead>`;
  const painters = p.has_painters ? br.filter(x => x.kpi_painters.length) : [];
  host.innerHTML = `
    <h4 class="kpi-h">${e ? "Upravit" : "Zadat"} vstupy – ${periodName(sel.type, sel.no)} ${sel.year}
      ${e ? `<span class="kpi-badge">uloženo ${new Date(e.updated_at).toLocaleDateString("cs-CZ")}</span>` : `<span class="kpi-badge kpi-badge-new">nové období</span>`}</h4>
    ${overlapNote()}
    <p class="f-note">Prázdné pole = údaj se nesleduje (nepočítá se jako nula). Čísla pište bez měny, desetinná místa s čárkou.</p>
    <div class="table-wrap kpi-table-wrap"><table class="res-table kpi-in">
      ${head}
      <tbody><tr class="kpi-sec"><td colspan="${br.length + 2}">Lakovna</td></tr>${sectionRows(LAK)}
      ${p.has_kar ? `<tr class="kpi-sec"><td colspan="${br.length + 2}">Karosárna</td></tr>${sectionRows(KAR)}` : ""}</tbody>
    </table></div>
    ${painters.length ? `
    <h4 class="kpi-h">Spotřeba materiálu podle lakýrníků</h4>
    <div class="table-wrap kpi-table-wrap"><table class="res-table kpi-in">
      <thead><tr><th>Lakýrník</th>${PAINT.map(m => `<th>${m.l}<span class="muted">${m.u}</span></th>`).join("")}</tr></thead>
      <tbody>${painters.map(x => `<tr class="kpi-sec"><td colspan="${PAINT.length + 1}">${esc(x.name)}</td></tr>` + x.kpi_painters.map(pt => `
        <tr><th scope="row">${esc(pt.name)}</th>${PAINT.map(m => inputCell(d.p?.[pt.id]?.[m.k], `data-p="${pt.id}" data-k="${m.k}"`)).join("")}</tr>`).join("")).join("")}</tbody>
    </table></div>` : p.has_painters ? `<p class="f-note">Sledování lakýrníků je zapnuté, ale u poboček nejsou zadaní žádní lakýrníci – doplňte je přes „Upravit“ u partnera.</p>` : ""}
    ${hoursHtml(br.map(x => ({ id: x.id, name: x.name, painters: x.kpi_painters })), p.has_kar ? ["lak", "kar"] : ["lak"], d)}
    <div class="auth-msg" id="kpiInMsg"></div>
    <button type="button" class="btn-save kpi-btn" id="kpiSave">Uložit vstupy</button>
    ${e ? `<button type="button" class="btn-del kpi-del-period" id="kpiDelPeriod">Smazat toto období</button>` : ""}`;
  const recalc = () => {
    if (br.length < 2) return;
    host.querySelectorAll("[data-sum]").forEach(td => {
      const vals = [...host.querySelectorAll(`input[data-b][data-k="${td.dataset.sum}"]`)].map(i => parseNum(i.value)).filter(v => v != null && !isNaN(v));
      td.textContent = vals.length ? fmtNum(vals.reduce((a, b) => a + b, 0)) : "";
    });
  };
  bindHours(host, () => dirty = true);
  host.querySelectorAll("input[data-b], input[data-p]").forEach(i => {
    i.oninput = () => { dirty = true; i.classList.toggle("kpi-bad", isNaN(parseNum(i.value))); recalc(); };
    i.onblur = () => { const v = parseNum(i.value); if (v != null && !isNaN(v)) i.value = fmtNum(v, 4); };
  });
  recalc();
  document.getElementById("kpiSave").onclick = saveInputs;
  const del = document.getElementById("kpiDelPeriod");
  if (del) del.onclick = async () => {
    if (!confirm(`Smazat všechny vstupy za období ${periodName(sel.type, sel.no)} ${sel.year}?`)) return;
    const { error } = await supabase.from("kpi_entries").delete().eq("id", e.id);
    if (error) return alert("Smazání se nepodařilo: " + error.message);
    dirty = false;
    showPartner(current.id, `Období ${periodName(sel.type, sel.no)} ${sel.year} bylo smazáno.`);
  };
}

async function saveInputs() {
  const host = document.getElementById("kpiInputs"), out = document.getElementById("kpiInMsg");
  const bad = host.querySelectorAll(".kpi-num.kpi-bad");
  if (bad.length) { out.textContent = "Některá pole neobsahují platné číslo (jsou označená červeně)."; bad[0].focus(); return; }
  const hrs = collectHours(host);
  if (hrs.errors.length) { out.innerHTML = hrs.errors.map(esc).join("<br>"); return; }
  const data = { b: {}, p: {}, h: hrs.h };
  let filled = 0;
  for (const [id, o] of Object.entries(hrs.b)) for (const [k, v] of Object.entries(o)) { (data.b[id] ||= {})[k] = v; filled++; }
  host.querySelectorAll("input[data-b]").forEach(i => { const v = parseNum(i.value); if (v != null) { (data.b[i.dataset.b] ||= {})[i.dataset.k] = v; filled++; } });
  host.querySelectorAll("input[data-p]").forEach(i => { const v = parseNum(i.value); if (v != null) { (data.p[i.dataset.p] ||= {})[i.dataset.k] = v; filled++; } });
  if (!filled) { out.textContent = "Nevyplnili jste žádný údaj."; return; }
  // zachovat data poboček/lakýrníků, které teď nejsou ve formuláři (např. odebrané)
  const old = findEntry()?.data || {};
  for (const [k, v] of Object.entries(old.b || {})) if (!current.kpi_branches.some(x => x.id === k)) data.b[k] = v;
  for (const [k, v] of Object.entries(old.p || {})) if (!host.querySelector(`input[data-p="${k}"]`)) data.p[k] = v;
  for (const [k, v] of Object.entries(old.h || {})) if (!current.kpi_branches.some(x => x.id === k)) data.h[k] = v;
  const btn = document.getElementById("kpiSave"); btn.disabled = true;
  const { error } = await supabase.from("kpi_entries").upsert(
    { partner_id: current.id, year: sel.year, period_type: sel.type, period_no: sel.no, data },
    { onConflict: "partner_id,year,period_type,period_no" });
  if (error) { out.textContent = "Uložení se nepodařilo: " + error.message; btn.disabled = false; return; }
  dirty = false;
  showPartner(current.id, `Vstupy za ${periodName(sel.type, sel.no)} ${sel.year} jsou uložené.`);
}
