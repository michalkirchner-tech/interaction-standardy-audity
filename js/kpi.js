// KPI servisních partnerů (lakovna, karosárna) – jen pro administrátora
// Krok 1: servisní partneři a jejich pobočky
import { supabase } from "./supabase.js?v=20261120g";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const czErr = e => /kpi_partners_name_uq/.test(e?.message || "") ? "Partner s tímto názvem už existuje."
  : /kpi_branches_name_uq/.test(e?.message || "") ? "Dvě pobočky nesmí mít stejný název."
  : (e?.message || String(e));

let partners = [];

async function loadPartners() {
  const { data, error } = await supabase.from("kpi_partners")
    .select("id,name,ic,note,created_at,kpi_branches(id,name,sort)")
    .order("name");
  if (error) throw error;
  data.forEach(p => p.kpi_branches.sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name, "cs")));
  return data;
}

export async function renderKpi(app) {
  document.title = "KPI servisních partnerů | INTERACTION";
  app.innerHTML = `
    <section class="brand-page wide-page kpi-page">
      <a class="back" href="#">← Zpět na úvod</a>
      <div class="brand-head brand-head-plain"><div><h2>KPI servisních partnerů</h2>
        <p>Sledování ukazatelů lakovny a karosárny. Vidí jen administrátor.</p></div></div>
      <div id="kpiBox"><div class="empty">Načítám…</div></div>
    </section>`;
  window.scrollTo(0, 0);
  await showList();
}

function box() { return document.getElementById("kpiBox"); }

async function showList(msg = "") {
  const b = box(); if (!b) return;
  try { partners = await loadPartners(); }
  catch (e) { b.innerHTML = `<div class="empty">Data se nepodařilo načíst: ${esc(e.message)}</div>`; return; }
  b.innerHTML = `
    <div class="res-card">
      <div class="kpi-bar">
        <h3>Servisní partneři</h3>
        <button type="button" class="btn-save kpi-btn" id="kpiNew">+ Založit partnera</button>
      </div>
      ${msg ? `<p class="kpi-ok">${msg}</p>` : ""}
      ${partners.length ? `
      <div class="table-wrap"><table class="res-table">
        <thead><tr><th>Partner</th><th>IČO</th><th>Pobočky</th><th>Poznámka</th><th></th></tr></thead>
        <tbody>${partners.map(p => `<tr>
          <td><strong>${esc(p.name)}</strong></td>
          <td>${esc(p.ic || "—")}</td>
          <td>${p.kpi_branches.map(x => esc(x.name)).join(", ") || "—"}</td>
          <td class="muted-cell">${esc(p.note || "")}</td>
          <td class="kpi-actions"><button type="button" class="btn-logout" data-edit="${p.id}">Upravit</button>
            <button type="button" class="btn-del" data-del="${p.id}">Smazat</button></td>
        </tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Zatím není založený žádný partner. Začněte tlačítkem „Založit partnera“.</div>`}
    </div>`;
  document.getElementById("kpiNew").onclick = () => showForm(null);
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

function branchRow(br = {}) {
  return `<div class="kpi-branch" data-id="${br.id || ""}">
    <input name="branch" value="${esc(br.name || "")}" placeholder="Název pobočky, např. Veleslavín">
    <button type="button" class="btn-del" data-rm title="Odebrat pobočku">✕</button>
  </div>`;
}

function showForm(p) {
  const b = box();
  const edit = !!p;
  b.innerHTML = `
    <div class="res-card kpi-form-card">
      <h3>${edit ? `Upravit partnera – ${esc(p.name)}` : "Nový servisní partner"}</h3>
      <form id="kpiForm" class="kpi-form" novalidate>
        <label>Název partnera *<input name="name" value="${esc(p?.name || "")}" required placeholder="např. Přerost a Švarc"></label>
        <label>IČO<input name="ic" value="${esc(p?.ic || "")}" inputmode="numeric" maxlength="8" placeholder="nepovinné"></label>
        <label class="kpi-wide">Poznámka<input name="note" value="${esc(p?.note || "")}" placeholder="nepovinné"></label>
        <div class="kpi-wide">
          <div class="kpi-lbl">Pobočky (střediska) *</div>
          <p class="f-note">Každá pobočka bude mít vlastní vstupy i výstupy KPI. Má-li partner jen jedno místo, založte jednu pobočku (např. „Spořilov“).</p>
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
  const list = document.getElementById("kpiBranches");
  const bindRm = () => list.querySelectorAll("[data-rm]").forEach(x => x.onclick = () => {
    if (list.children.length === 1) { x.previousElementSibling.value = ""; return; }
    x.parentElement.remove();
  });
  bindRm();
  document.getElementById("kpiAddBranch").onclick = () => { list.insertAdjacentHTML("beforeend", branchRow()); bindRm(); list.lastElementChild.querySelector("input").focus(); };
  document.getElementById("kpiCancel").onclick = () => showList();
  const form = document.getElementById("kpiForm");
  form.onsubmit = async e => {
    e.preventDefault();
    const out = document.getElementById("kpiMsg");
    const name = form.name.value.trim(), ic = form.ic.value.trim(), note = form.note.value.trim();
    const rows = [...list.children].map((el, i) => ({ id: el.dataset.id || null, name: el.querySelector("input").value.trim(), sort: i })).filter(r => r.name);
    if (!name) { out.textContent = "Vyplňte název partnera."; return; }
    if (ic && !/^\d{8}$/.test(ic)) { out.textContent = "IČO musí mít 8 číslic (nebo ho nechte prázdné)."; return; }
    if (!rows.length) { out.textContent = "Zadejte alespoň jednu pobočku."; return; }
    const lower = rows.map(r => r.name.toLowerCase());
    if (new Set(lower).size !== lower.length) { out.textContent = "Dvě pobočky nesmí mít stejný název."; return; }
    const removed = edit ? p.kpi_branches.filter(o => !rows.some(r => r.id === o.id)) : [];
    if (removed.length && !confirm(`Odebíráte pobočky: ${removed.map(r => r.name).join(", ")}.\n\nSmažou se i jejich zadaná KPI data. Pokračovat?`)) return;
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      let pid = p?.id;
      const fields = { name, ic: ic || null, note: note || null };
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
      // Přejmenování nejdřív na dočasné názvy by bylo potřeba jen při prohození jmen – řešíme postupně
      for (const r of rows.filter(r => r.id)) {
        const { error } = await supabase.from("kpi_branches").update({ name: r.name, sort: r.sort }).eq("id", r.id);
        if (error) throw error;
      }
      const fresh = rows.filter(r => !r.id).map(r => ({ partner_id: pid, name: r.name, sort: r.sort }));
      if (fresh.length) {
        const { error } = await supabase.from("kpi_branches").insert(fresh);
        if (error) throw error;
      }
      showList(edit ? `Změny u partnera „${esc(name)}“ jsou uložené.` : `Partner „${esc(name)}“ je založený.`);
    } catch (err) { out.textContent = "Uložení se nepodařilo: " + czErr(err); btn.disabled = false; }
  };
  form.name.focus();
}
