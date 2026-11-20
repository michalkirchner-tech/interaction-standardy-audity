// KPI – sběr dat od partnera: jedinečné odkazy k online vyplnění
import { supabase } from "./supabase.js?v=20261120l";
import { PTYPES, periodNos, periodName } from "./kpi.js?v=20261120l";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtD = iso => new Date(iso).toLocaleDateString("cs-CZ");
const fmtDT = iso => { const d = new Date(iso); return fmtD(iso) + " " + d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }); };
export const fillUrl = token => new URL("vyplnit/?k=" + token, location.origin + location.pathname.replace(/[^/]*$/, "")).href;

async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select(); document.execCommand("copy"); t.remove(); }
  const o = btn.textContent; btn.textContent = "✓ Zkopírováno"; setTimeout(() => btn.textContent = o, 1800);
}

function mailto(p, r) {
  const per = `${periodName(r.period_type, r.period_no)} ${r.year}`;
  const subj = `Podklady pro KPI – ${p.name} – ${per}`;
  const body = `Dobrý den,\n\nprosíme o vyplnění podkladů pro vyhodnocení KPI za období ${per}.\n\nFormulář otevřete tímto odkazem (není potřeba registrace ani přihlášení):\n${fillUrl(r.token)}\n\nOdkaz platí do ${fmtD(r.expires_at)}. Po odeslání můžete údaje stejným odkazem ještě upravit.\n\nDěkujeme\nINTERACTION`;
  return `mailto:?subject=${encodeURIComponent(subj)}&body=${encodeURIComponent(body)}`;
}

function status(r) {
  if (r.status === "locked") return `<span class="kpi-st st-lock">Uzavřeno</span>`;
  if (new Date(r.expires_at) < new Date()) return `<span class="kpi-st st-exp">Platnost vypršela</span>${r.filled_at ? `<span class="muted">vyplněno ${fmtDT(r.filled_at)}</span>` : ""}`;
  if (r.status === "filled") return `<span class="kpi-st st-ok">Vyplněno</span><span class="muted">${fmtDT(r.filled_at)} · ${esc(r.filled_by)}</span>`;
  return `<span class="kpi-st st-wait">Čeká na vyplnění</span>`;
}

// host = kontejner, p = partner (s pobočkami), sel = výchozí období { year, type, no }, onFilled = obnova dat
export async function renderRequests(host, p, sel, onChange) {
  host.innerHTML = `<div class="empty">Načítám…</div>`;
  const { data: list, error } = await supabase.from("kpi_requests")
    .select("id,token,year,period_type,period_no,branch_ids,status,expires_at,note,filled_by,filled_at,created_at")
    .eq("partner_id", p.id).order("created_at", { ascending: false });
  if (error) { host.innerHTML = `<div class="empty">Seznam odkazů se nepodařilo načíst: ${esc(error.message)}</div>`; return; }
  const brName = id => p.kpi_branches.find(b => b.id === id)?.name || "(odebraná pobočka)";
  const f = { year: sel.year, type: sel.type, no: sel.no };
  const now = new Date().getFullYear();
  host.innerHTML = `
    <h4 class="kpi-h">Odkaz k online vyplnění</h4>
    <p class="f-note">Partner dostane jedinečný odkaz, otevře ho bez registrace a vyplní prázdný formulář jen pro zvolené období a pobočky (jiná období ani výsledky neuvidí). Odeslané údaje se rovnou uloží do vstupů – vyplněná pole přepíšou dosavadní hodnoty, prázdná nic nemažou.</p>
    <div class="kpi-req-new">
      <div class="kpi-period">
        <label>Rok<select id="rqYear">${[now + 1, now, now - 1, now - 2].map(y => `<option ${y === f.year ? "selected" : ""}>${y}</option>`).join("")}</select></label>
        <label>Sledované období<select id="rqType">${Object.entries(PTYPES).map(([k, v]) => `<option value="${k}" ${k === f.type ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label id="rqNoWrap">Které<select id="rqNo"></select></label>
        <label>Platnost odkazu<select id="rqDays"><option value="14">14 dní</option><option value="30" selected>30 dní</option><option value="60">60 dní</option><option value="90">90 dní</option></select></label>
      </div>
      <div class="kpi-lbl-sm">Pobočky ve formuláři</div>
      <div class="kpi-req-br">${p.kpi_branches.map(b => `<label class="kpi-check"><input type="checkbox" data-rqb="${b.id}" checked> ${esc(b.name)}</label>`).join("")}</div>
      <label class="kpi-req-note">Poznámka pro partnera (nepovinné)<input id="rqNote" maxlength="300" placeholder="např. Prosíme o vyplnění do 15. dne následujícího měsíce."></label>
      <div class="auth-msg" id="rqMsg"></div>
      <button type="button" class="btn-save kpi-btn" id="rqCreate">Vytvořit odkaz</button>
      <div id="rqResult"></div>
    </div>
    <h4 class="kpi-h">Vytvořené odkazy</h4>
    ${list.length ? `<div class="table-wrap kpi-table-wrap"><table class="res-table kpi-req-list">
      <thead><tr><th>Období</th><th>Pobočky</th><th>Vytvořeno</th><th>Platí do</th><th>Stav</th><th></th></tr></thead>
      <tbody>${list.map(r => `<tr>
        <td><strong>${periodName(r.period_type, r.period_no)} ${r.year}</strong></td>
        <td>${r.branch_ids.map(brName).map(esc).join(", ")}</td>
        <td class="td-date">${fmtD(r.created_at)}</td>
        <td class="td-date">${fmtD(r.expires_at)}</td>
        <td>${status(r)}</td>
        <td class="kpi-actions">
          <button type="button" class="btn-logout" data-copy="${r.id}">Kopírovat odkaz</button>
          <a class="btn-logout" href="${esc(mailto(p, r))}">E-mail</a>
          <button type="button" class="btn-logout" data-lock="${r.id}">${r.status === "locked" ? "Znovu otevřít" : "Uzavřít"}</button>
          ${new Date(r.expires_at) < new Date(Date.now() + 7 * 864e5) ? `<button type="button" class="btn-logout" data-ext="${r.id}">+30 dní</button>` : ""}
          <button type="button" class="btn-del" data-rdel="${r.id}">Smazat</button>
        </td></tr>`).join("")}</tbody></table></div>`
      : `<div class="empty">Zatím žádné odkazy.</div>`}`;

  const yS = host.querySelector("#rqYear"), tS = host.querySelector("#rqType"), nS = host.querySelector("#rqNo");
  const fillNo = () => { const n = periodNos(tS.value); if (f.no > n) f.no = 1; nS.innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${i + 1 === f.no ? "selected" : ""}>${periodName(tS.value, i + 1)}</option>`).join(""); host.querySelector("#rqNoWrap").hidden = tS.value === "Y"; };
  tS.onchange = () => { f.type = tS.value; fillNo(); };
  nS.onchange = () => f.no = +nS.value;
  fillNo();

  host.querySelector("#rqCreate").onclick = async e => {
    const out = host.querySelector("#rqMsg");
    const ids = [...host.querySelectorAll("[data-rqb]:checked")].map(x => x.dataset.rqb);
    if (!ids.length) { out.textContent = "Vyberte alespoň jednu pobočku."; return; }
    e.target.disabled = true;
    const row = { partner_id: p.id, year: +yS.value, period_type: tS.value, period_no: tS.value === "Y" ? 1 : +nS.value, branch_ids: ids,
      expires_at: new Date(Date.now() + +host.querySelector("#rqDays").value * 864e5).toISOString(), note: host.querySelector("#rqNote").value.trim() || null };
    const { data, error } = await supabase.from("kpi_requests").insert(row).select("token,year,period_type,period_no,expires_at").single();
    if (error) { out.textContent = "Odkaz se nepodařilo vytvořit: " + error.message; e.target.disabled = false; return; }
    await renderRequests(host, p, { year: row.year, type: row.period_type, no: row.period_no }, onChange);
    const res = host.querySelector("#rqResult");
    res.innerHTML = `<div class="kpi-ok kpi-link-box">Odkaz pro ${esc(p.name)} – ${periodName(data.period_type, data.period_no)} ${data.year}:<br>
      <input readonly value="${esc(fillUrl(data.token))}" class="kpi-link-in">
      <button type="button" class="btn-save kpi-btn kpi-btn-sm" id="rqCopy">Kopírovat odkaz</button>
      <a class="btn-logout" href="${esc(mailto(p, data))}">Připravit e-mail</a>
      <a class="btn-logout" href="${esc(fillUrl(data.token))}" target="_blank" rel="noopener">Náhled formuláře</a></div>`;
    res.querySelector("#rqCopy").onclick = ev => copy(fillUrl(data.token), ev.target);
    res.querySelector("input").onclick = ev => ev.target.select();
  };
  const find = id => list.find(r => r.id === id);
  host.querySelectorAll("[data-copy]").forEach(b => b.onclick = () => copy(fillUrl(find(b.dataset.copy).token), b));
  host.querySelectorAll("[data-lock]").forEach(b => b.onclick = async () => {
    const r = find(b.dataset.lock);
    const to = r.status === "locked" ? (r.filled_at ? "filled" : "sent") : "locked";
    const { error } = await supabase.from("kpi_requests").update({ status: to }).eq("id", r.id);
    if (error) return alert("Změna se nepodařila: " + error.message);
    renderRequests(host, p, sel, onChange);
  });
  host.querySelectorAll("[data-ext]").forEach(b => b.onclick = async () => {
    const r = find(b.dataset.ext);
    const base = Math.max(Date.now(), new Date(r.expires_at).getTime());
    const { error } = await supabase.from("kpi_requests").update({ expires_at: new Date(base + 30 * 864e5).toISOString() }).eq("id", r.id);
    if (error) return alert("Prodloužení se nepodařilo: " + error.message);
    renderRequests(host, p, sel, onChange);
  });
  host.querySelectorAll("[data-rdel]").forEach(b => b.onclick = async () => {
    if (!confirm("Smazat odkaz? Partner ho už nebude moci otevřít. Údaje, které už odeslal, zůstanou ve vstupech.")) return;
    const { error } = await supabase.from("kpi_requests").delete().eq("id", b.dataset.rdel);
    if (error) return alert("Smazání se nepodařilo: " + error.message);
    renderRequests(host, p, sel, onChange);
  });
}
