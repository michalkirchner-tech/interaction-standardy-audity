// KPI – sběr dat od partnera: jedinečné odkazy k online vyplnění
import { supabase } from "./supabase.js?v=20261120u";
import { PTYPES, periodNos, periodName, LAK, KAR, PAINT, fmtNum } from "./kpi.js?v=20261120u";
import { DEPTS } from "./kpi-defs.js?v=20261120u";
import { buildTemplate, readTemplate } from "./kpi-xlsx.js?v=20261120u";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtD = iso => new Date(iso).toLocaleDateString("cs-CZ");
const fmtDT = iso => { const d = new Date(iso); return fmtD(iso) + " " + d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }); };
const SCOPE = { lak: "lakovna", kar: "karosárna (klempírna)", all: "lakovna + karosárna" };
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
  const rev = r.filled_at ? (r.imported_at ? `<span class="kpi-st st-ok">Uloženo do vstupů</span><span class="muted">${fmtDT(r.imported_at)}</span>` : `<span class="kpi-st st-new">Vyplněno – čeká na uložení</span>`) : "";
  if (r.filled_at) return `${rev}<span class="muted">vyplnil(a) ${esc(r.filled_by)} · ${fmtDT(r.filled_at)}</span>${r.status === "locked" ? `<span class="muted">odkaz uzavřen</span>` : new Date(r.expires_at) < new Date() ? `<span class="muted">platnost odkazu vypršela</span>` : ""}`;
  if (r.status === "locked") return `<span class="kpi-st st-lock">Uzavřeno</span>`;
  if (new Date(r.expires_at) < new Date()) return `<span class="kpi-st st-exp">Platnost vypršela</span>${r.filled_at ? `<span class="muted">vyplněno ${fmtDT(r.filled_at)}</span>` : ""}`;
  if (r.status === "filled") return `<span class="kpi-st st-ok">Vyplněno</span><span class="muted">${fmtDT(r.filled_at)} · ${esc(r.filled_by)}</span>`;
  return `<span class="kpi-st st-wait">Čeká na vyplnění</span>`;
}

// host = kontejner, p = partner (s pobočkami), sel = výchozí období { year, type, no }, onChange = obnova dat, openId = rovnou otevřít kontrolu vyplnění
export async function renderRequests(host, p, sel, onChange, openId) {
  host.innerHTML = `<div class="empty">Načítám…</div>`;
  const { data: list, error } = await supabase.from("kpi_requests")
    .select("id,token,year,period_type,period_no,branch_ids,scope,status,expires_at,note,filled_by,filled_at,imported_at,submitted,created_at")
    .eq("partner_id", p.id).order("created_at", { ascending: false });
  if (error) { host.innerHTML = `<div class="empty">Seznam odkazů se nepodařilo načíst: ${esc(error.message)}</div>`; return; }
  const brName = id => p.kpi_branches.find(b => b.id === id)?.name || "(odebraná pobočka)";
  const f = { year: sel.year, type: sel.type, no: sel.no };
  const now = new Date().getFullYear();
  host.innerHTML = `
    <h4 class="kpi-h">Odkaz k online vyplnění nebo excelová tabulka</h4>
    <p class="f-note"><b>Odkaz:</b> partner ho otevře bez registrace a vyplní prázdný formulář jen pro zvolené období a pobočky (jiná období ani výsledky neuvidí); údaje se rovnou uloží do vstupů.
    <b>Tabulka .xlsx:</b> stáhnete ji, pošlete partnerovi a vyplněnou nahrajete níže. V obou případech vyplněná pole přepíšou dosavadní hodnoty, prázdná nic nemažou.</p>
    <div class="kpi-req-new">
      <div class="kpi-period">
        <label>Rok<select id="rqYear">${[now + 1, now, now - 1, now - 2].map(y => `<option ${y === f.year ? "selected" : ""}>${y}</option>`).join("")}</select></label>
        <label>Sledované období<select id="rqType">${Object.entries(PTYPES).map(([k, v]) => `<option value="${k}" ${k === f.type ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label id="rqNoWrap">Které<select id="rqNo"></select></label>
        <label>Oddělení<select id="rqScope"><option value="lak" ${p.has_kar ? "" : "selected"}>Lakovna</option><option value="kar">Karosárna (klempírna)</option><option value="all" ${p.has_kar ? "selected" : ""}>Komplet (lakovna + karosárna)</option></select></label>
        <label>Platnost odkazu<select id="rqDays"><option value="14">14 dní</option><option value="30" selected>30 dní</option><option value="60">60 dní</option><option value="90">90 dní</option></select></label>
      </div>
      <div class="kpi-lbl-sm">Pobočky ve formuláři</div>
      <div class="kpi-req-br">${p.kpi_branches.map(b => `<label class="kpi-check"><input type="checkbox" data-rqb="${b.id}" checked> ${esc(b.name)}</label>`).join("")}</div>
      <label class="kpi-req-note">Poznámka pro partnera (nepovinné)<input id="rqNote" maxlength="300" placeholder="např. Prosíme o vyplnění do 15. dne následujícího měsíce."></label>
      <div class="auth-msg" id="rqMsg"></div>
      <button type="button" class="btn-save kpi-btn" id="rqCreate">📨 Vytvořit odkaz</button>
      <button type="button" class="btn-logout kpi-btn-cmp" id="rqXlsx">⬇️ Stáhnout tabulku .xlsx</button>
      <div id="rqResult"></div>
    </div>
    <h4 class="kpi-h">Nahrát vyplněnou tabulku od partnera</h4>
    <div class="kpi-req-new">
      <label class="kpi-req-note">Soubor .xlsx stažený z této aplikace<input type="file" id="rqFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></label>
      <div id="rqImport"></div>
    </div>
    <div id="rqReview"></div>
    <h4 class="kpi-h">Vytvořené odkazy</h4>
    ${list.length ? `<div class="table-wrap kpi-table-wrap"><table class="res-table kpi-req-list">
      <thead><tr><th>Období</th><th>Pobočky</th><th>Vytvořeno</th><th>Platí do</th><th>Stav</th><th></th></tr></thead>
      <tbody>${list.map(r => `<tr>
        <td><strong>${periodName(r.period_type, r.period_no)} ${r.year}</strong><span class="muted">${SCOPE[r.scope] || ""}</span></td>
        <td>${r.branch_ids.map(brName).map(esc).join(", ")}</td>
        <td class="td-date">${fmtD(r.created_at)}</td>
        <td class="td-date">${fmtD(r.expires_at)}</td>
        <td>${status(r)}</td>
        <td class="kpi-actions">
          ${r.filled_at ? `<button type="button" class="btn-save kpi-btn kpi-btn-sm" data-review="${r.id}">${r.imported_at ? "Zobrazit vyplnění" : "Zkontrolovat a uložit"}</button>` : ""}
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
    const scope = host.querySelector("#rqScope").value;
    if (!(await ensureKar(p, scope, out))) { e.target.disabled = false; return; }
    const row = { scope, partner_id: p.id, year: +yS.value, period_type: tS.value, period_no: tS.value === "Y" ? 1 : +nS.value, branch_ids: ids,
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
  const chosen = () => ({ scope: host.querySelector("#rqScope").value, year: +yS.value, type: tS.value, no: tS.value === "Y" ? 1 : +nS.value, ids: [...host.querySelectorAll("[data-rqb]:checked")].map(x => x.dataset.rqb) });
  host.querySelector("#rqXlsx").onclick = async () => {
    const c = chosen(), out = host.querySelector("#rqMsg");
    if (!c.ids.length) { out.textContent = "Vyberte alespoň jednu pobočku."; return; }
    out.textContent = "";
    if (!(await ensureKar(p, c.scope, out))) return;
    const { blob, filename } = buildTemplate({ partner: p, year: c.year, type: c.type, no: c.no, branchIds: c.ids, scope: c.scope });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
  };
  host.querySelector("#rqFile").onchange = e => { const f = e.target.files[0]; if (f) importFile(host, p, f, onChange); };
  const find = id => list.find(r => r.id === id);
  const review = r => {
    const box = host.querySelector("#rqReview");
    const t = { year: r.year, type: r.period_type, no: r.period_no, branchIds: r.branch_ids, who: r.filled_by, data: { b: {}, p: {}, h: {}, ...(r.submitted || {}) }, problems: [],
      count: Object.values(r.submitted?.b || {}).concat(Object.values(r.submitted?.p || {})).reduce((a, o) => a + Object.keys(o).length, 0),
      source: `Vyplněno přes odkaz ${fmtDT(r.filled_at)}`, imported: r.imported_at };
    box.innerHTML = `<h4 class="kpi-h">Kontrola vyplnění od partnera</h4><div class="kpi-req-new kpi-review-box"></div>`;
    previewSave(box.querySelector(".kpi-review-box"), p, t, async () => {
      await supabase.from("kpi_requests").update({ imported_at: new Date().toISOString() }).eq("id", r.id);
      await onChange?.();
      document.dispatchEvent(new Event("kpi-inbox-changed"));
      await renderRequests(host, p, sel, onChange);
      const done = host.querySelector("#rqReview");
      if (done) done.innerHTML = `<p class="kpi-ok">✅ Vyplnění od ${esc(r.filled_by)} (${periodName(r.period_type, r.period_no)} ${r.year}) je uložené do vstupů. Najdete ho na záložkách Vstupy a Výstupy.</p>`;
    }, () => box.innerHTML = "");
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  host.querySelectorAll("[data-review]").forEach(b => b.onclick = () => review(find(b.dataset.review)));
  if (openId && find(openId)) review(find(openId));
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

// Volba karosárny u partnera, který ji zatím nesleduje: zapne mu sledování karosárny
async function ensureKar(p, scope, out) {
  if (scope === "lak" || p.has_kar) return true;
  const { error } = await supabase.from("kpi_partners").update({ has_kar: true }).eq("id", p.id);
  if (error) { out.textContent = "Nepodařilo se zapnout sledování karosárny: " + error.message; return false; }
  p.has_kar = true;
  out.innerHTML = `<span class="kpi-ok-inline">U partnera ${esc(p.name)} bylo zapnuto sledování karosárny.</span>`;
  return true;
}

// ---------- Import vyplněné tabulky ----------
async function importFile(host, p, file, onChange) {
  const box = host.querySelector("#rqImport");
  box.innerHTML = `<div class="empty">Načítám tabulku…</div>`;
  let t;
  try { t = await readTemplate(file); }
  catch (e) { box.innerHTML = `<p class="auth-msg">Tabulku nelze načíst: ${esc(e.message)}</p>`; return; }
  if (t.partnerId !== p.id) { box.innerHTML = `<p class="auth-msg">Tabulka patří partnerovi „${esc(t.partnerName)}“, ne „${esc(p.name)}“. Otevřete ji u správného partnera.</p>`; return; }
  t.source = "Excelová tabulka";
  previewSave(box, p, t, async () => { host.querySelector("#rqFile").value = ""; await onChange?.(); }, () => { box.innerHTML = ""; host.querySelector("#rqFile").value = ""; });
}

// Náhled vyplněných údajů (z tabulky nebo z odkazu) proti dosavadním vstupům a uložení po potvrzení.
// t = { year, type, no, branchIds, who, data:{b,p,h}, problems, count, source, imported }
async function previewSave(box, p, t, onSaved, onCancel) {
  box.innerHTML = `<div class="empty">Načítám…</div>`;
  const { data: ex, error } = await supabase.from("kpi_entries").select("id,data").eq("partner_id", p.id).eq("year", t.year).eq("period_type", t.type).eq("period_no", t.no).maybeSingle();
  if (error) { box.innerHTML = `<p class="auth-msg">${esc(error.message)}</p>`; return; }
  const cur = ex?.data || { b: {}, p: {} };
  const brs = p.kpi_branches.filter(b => t.branchIds.includes(b.id));
  const defs = [...LAK, ...(p.has_kar ? KAR : [])];
  let changes = 0;
  const cellH = (nv, ov) => {
    if (nv == null) return `<td class="kpi-v muted-cell">${ov != null ? fmtNum(ov) : ""}</td>`;
    const ch = ov != null && ov !== nv; if (ov !== nv) changes++;
    return `<td class="kpi-v ${ch ? "kpi-chg" : "kpi-new"}" title="${ch ? "dosud: " + fmtNum(ov) : "nová hodnota"}">${fmtNum(nv)}${ch ? `<span class="muted">dosud ${fmtNum(ov)}</span>` : ""}</td>`;
  };
  const pts = brs.flatMap(b => (b.kpi_painters || []).map(x => ({ ...x, b: b.name }))).filter(x => t.data.p[x.id]);
  box.innerHTML = `
    <p class="kpi-ok">${esc(t.source || "")}: <b>${esc(p.name)}</b> · <b>${periodName(t.type, t.no)} ${t.year}</b> · vyplnil(a): <b>${esc(t.who || "neuvedeno")}</b> · vyplněných polí: <b>${t.count}</b></p>
    ${t.imported ? `<p class="f-note kpi-note">ℹ️ Toto vyplnění už bylo uloženo do vstupů ${new Date(t.imported).toLocaleString("cs-CZ")}. Náhled porovnává s aktuálními vstupy; můžete ho uložit znovu.</p>` : ""}
    ${t.problems.length ? `<p class="auth-msg">Upozornění k tabulce:<br>${t.problems.map(esc).join("<br>")}</p>` : ""}
    ${!t.count ? `<p class="auth-msg">V tabulce nejsou vyplněné žádné údaje.</p>` : `
    <div class="table-wrap kpi-table-wrap"><table class="res-table kpi-out">
      <thead><tr><th>Ukazatel</th>${brs.map(b => `<th>${esc(b.name)}</th>`).join("")}</tr></thead>
      <tbody>${defs.map(m => `<tr><th scope="row">${esc(m.l)}<span class="muted">${m.u}</span></th>${brs.map(b => cellH(t.data.b[b.id]?.[m.k], cur.b?.[b.id]?.[m.k])).join("")}</tr>`).join("")}</tbody></table></div>
    ${Object.keys(t.data.h || {}).length ? `<p class="f-note">Hodiny zadané jmenovitě: ${brs.filter(b => t.data.h[b.id]).map(b => `${esc(b.name)} – ${Object.entries(t.data.h[b.id]).map(([dk, rows]) => `${DEPTS[dk].label.toLowerCase()} ${rows.length} os.`).join(", ")}`).join("; ")} (v tabulce výše jsou jejich součty).</p>` : ""}
    ${pts.length ? `<div class="table-wrap kpi-table-wrap"><table class="res-table kpi-out">
      <thead><tr><th>Lakýrník</th>${PAINT.map(m => `<th>${m.l}</th>`).join("")}</tr></thead>
      <tbody>${pts.map(x => `<tr><th scope="row">${esc(x.name)}<span class="muted">${esc(x.b)}</span></th>${PAINT.map(m => cellH(t.data.p[x.id]?.[m.k], cur.p?.[x.id]?.[m.k])).join("")}</tr>`).join("")}</tbody></table></div>` : ""}
    <div class="kpi-legend"><span><i class="lg-good"></i> nová hodnota</span><span><i class="lg-chg"></i> přepíše dosavadní hodnotu</span><span>šedě = beze změny (pole v tabulce prázdné)</span></div>
    <button type="button" class="btn-save kpi-btn" id="rqImpSave">Uložit do vstupů (${periodName(t.type, t.no)} ${t.year})</button>
    <button type="button" class="btn-logout" id="rqImpCancel">Zrušit</button>`}`;
  const cancel = box.querySelector("#rqImpCancel");
  if (cancel) cancel.onclick = onCancel;
  const save = box.querySelector("#rqImpSave");
  if (save) save.onclick = async () => {
    save.disabled = true;
    const data = { b: { ...(cur.b || {}) }, p: { ...(cur.p || {}) } };
    for (const sec of ["b", "p"]) for (const [id, o] of Object.entries(t.data[sec])) data[sec][id] = { ...(data[sec][id] || {}), ...o };
    // jmenovité hodiny: nové nahradí dosavadní; souhrn za středisko z tabulky jmenovité zruší
    data.h = JSON.parse(JSON.stringify(cur.h || {}));
    for (const b of brs) for (const [dk, d] of Object.entries(DEPTS)) {
      if (t.data.h?.[b.id]?.[dk]) (data.h[b.id] ||= {})[dk] = t.data.h[b.id][dk];
      else if (t.data.b[b.id] && (d.o in t.data.b[b.id] || d.p in t.data.b[b.id]) && data.h[b.id]) { delete data.h[b.id][dk]; if (!Object.keys(data.h[b.id]).length) delete data.h[b.id]; }
    }
    const { error: e2 } = await supabase.from("kpi_entries").upsert({ partner_id: p.id, year: t.year, period_type: t.type, period_no: t.no, data }, { onConflict: "partner_id,year,period_type,period_no" });
    if (e2) { alert("Uložení se nepodařilo: " + e2.message); save.disabled = false; return; }
    box.innerHTML = `<p class="kpi-ok">✅ Údaje jsou uložené do vstupů za ${periodName(t.type, t.no)} ${t.year}. Najdete je na záložkách Vstupy a Výstupy.</p>`;
    await onSaved?.();
  };
}
