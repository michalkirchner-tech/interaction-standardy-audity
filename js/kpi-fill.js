// Veřejná stránka pro partnera: vyplnění vstupů KPI přes jedinečný odkaz (bez přihlášení)
import { supabase } from "./supabase.js?v=20261120v";
import { LAK, KAR, periodName, periodRange } from "./kpi-defs.js?v=20261120v";
import { hoursHtml, bindHours, collectHours } from "./kpi-hours.js?v=20261120v";

const app = document.getElementById("app");
document.getElementById("year").textContent = new Date().getFullYear();
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtNum = v => v == null || v === "" || isNaN(v) ? "" : Number(v).toLocaleString("cs-CZ", { maximumFractionDigits: 4 });
const parseNum = s => { const t = String(s ?? "").replace(/\s| /g, "").replace(",", "."); if (t === "") return null; const n = Number(t); return isNaN(n) || n < 0 ? NaN : n; };
const fmtDT = iso => { const d = new Date(iso); return d.toLocaleDateString("cs-CZ") + " " + d.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" }); };
const ERR = {
  ODKAZ_NEPLATNY: "Tento odkaz není platný. Zkontrolujte, že jste ho zkopírovali celý, případně požádejte o nový.",
  ODKAZ_ZAMCEN: "Formulář už byl uzavřen a údaje nelze měnit. Pokud potřebujete něco opravit, kontaktujte prosím INTERACTION.",
  ODKAZ_VYPRSEL: "Platnost odkazu vypršela. Požádejte prosím o nový odkaz.",
  CHYBI_JMENO: "Vyplňte prosím, kdo údaje vyplnil.",
  NEPLATNE_CISLO: "Některé pole neobsahuje platné kladné číslo.",
  NIC_NEVYPLNENO: "Nevyplnili jste žádný údaj.",
};
const czErr = e => { const m = e?.message || String(e); const k = Object.keys(ERR).find(x => m.includes(x)); return k ? ERR[k] : "Chyba: " + m; };

const token = new URLSearchParams(location.search).get("k") || "";
let form = null;

function page(html) { app.innerHTML = `<section class="brand-page wide-page fill-page">${html}</section>`; window.scrollTo(0, 0); }

async function load() {
  if (!/^[0-9a-f]{32,64}$/.test(token)) return page(`<div class="empty">${ERR.ODKAZ_NEPLATNY}</div>`);
  const { data, error } = await supabase.rpc("kpi_request_get", { p_token: token });
  if (error) return page(`<div class="empty">${esc(czErr(error))}</div>`);
  form = data;
  draw();
}

function cell(val, attrs) { return `<td><input class="kpi-num" inputmode="decimal" ${attrs} value="${esc(fmtNum(val))}" autocomplete="off"></td>`; }

function draw(msg = "") {
  const f = form, br = f.branches, s = f.submitted || {};
  const per = `${periodName(f.period_type, f.period_no)} ${f.year}`;
  document.title = `Podklady pro KPI – ${f.partner} – ${per}`;
  const visible = list => list.filter(m => !m.adminOnly && !m.hours);
  const lak = f.has_lak !== false, kar = !!f.has_kar;
  const defs = [...(lak ? [["Lakovna", visible(LAK)]] : []), ...(kar ? [["Karosárna", visible(KAR)]] : [])];
  const depts = [...(lak ? ["lak"] : []), ...(kar ? ["kar"] : [])];
  page(`
    <div class="brand-head brand-head-plain"><div>
      <h2>Podklady pro KPI – ${esc(f.partner)}</h2>
      <p>Odkaz platí do ${new Date(f.expires_at).toLocaleDateString("cs-CZ")}</p>
    </div></div>
    <div class="fill-period">Vyplňujete údaje za období<strong>${esc(per)}</strong><span>${periodRange(f.year, f.period_type, f.period_no)}</span><em>${lak && kar ? "lakovna a karosárna" : kar ? "karosárna (klempírna)" : "lakovna"}</em></div>
    <div class="res-card">
      ${msg}
      ${f.status === "filled" && !msg ? `<p class="kpi-ok">Údaje jste už odeslali ${fmtDT(f.filled_at)} (${esc(f.filled_by)}). Níže je můžete upravit a odeslat znovu.</p>` : ""}
      ${f.note ? `<p class="kpi-note f-note">📝 ${esc(f.note)}</p>` : ""}
      <p class="f-note">Vyplňte prosím údaje za uvedené období${br.length > 1 ? " zvlášť za každou pobočku" : ""}. Čísla pište bez měny a mezer nebo s mezerami, desetinná místa s čárkou. Pokud údaj nesledujete, pole nechte prázdné.</p>
      <div class="table-wrap kpi-table-wrap"><table class="res-table kpi-in">
        <thead><tr><th>Ukazatel</th>${br.map(b => `<th>${esc(b.name)}</th>`).join("")}</tr></thead>
        <tbody>${defs.map(([g, list]) => `<tr class="kpi-sec"><td colspan="${br.length + 1}">${g}</td></tr>` + list.map(m => `
          <tr><th scope="row">${esc(m.l)}<span class="muted">${m.u}${m.avg ? " · průměrný stav za období" : ""}</span>${m.hint ? `<span class="fill-hint">ℹ️ ${esc(m.hint)}</span>` : ""}</th>
          ${br.map(b => cell(s.b?.[b.id]?.[m.k], `data-b="${b.id}" data-k="${m.k}"`)).join("")}</tr>`).join("")).join("")}</tbody>
      </table></div>
      ${hoursHtml(br, depts, { b: s.b, h: s.h })}

      <div class="kpi-form fill-who"><label>Vyplnil(a) – jméno a příjmení *<input id="fillBy" value="${esc(f.filled_by || "")}" maxlength="120" autocomplete="name"></label></div>
      <div class="auth-msg" id="fillMsg"></div>
      <button type="button" class="btn-save kpi-btn" id="fillSend">Odeslat údaje</button>
    </div>`);
  bindHours(app);
  app.querySelectorAll("input[data-b], input[data-p]").forEach(i => {
    i.oninput = () => i.classList.toggle("kpi-bad", isNaN(parseNum(i.value)));
    i.onblur = () => { const v = parseNum(i.value); if (v != null && !isNaN(v)) i.value = fmtNum(v); };
  });
  document.getElementById("fillSend").onclick = send;
}

async function send() {
  const out = document.getElementById("fillMsg");
  const bad = app.querySelectorAll(".kpi-num.kpi-bad");
  if (bad.length) { out.textContent = "Některá pole neobsahují platné kladné číslo (jsou označená červeně)."; bad[0].focus(); return; }
  const who = document.getElementById("fillBy").value.trim();
  if (!who) { out.textContent = ERR.CHYBI_JMENO; document.getElementById("fillBy").focus(); return; }
  const hrs = collectHours(app);
  if (hrs.errors.length) { out.innerHTML = hrs.errors.map(esc).join("<br>"); return; }
  const data = { b: {}, p: {}, h: hrs.h };
  let n = 0;
  for (const [id, o] of Object.entries(hrs.b)) for (const [k, v] of Object.entries(o)) { (data.b[id] ||= {})[k] = v; n++; }
  app.querySelectorAll("input[data-b]").forEach(i => { const v = parseNum(i.value); if (v != null) { (data.b[i.dataset.b] ||= {})[i.dataset.k] = v; n++; } });
  if (!n) { out.textContent = ERR.NIC_NEVYPLNENO; return; }
  const btn = document.getElementById("fillSend"); btn.disabled = true; btn.textContent = "Odesílám…";
  const { error } = await supabase.rpc("kpi_request_submit", { p_token: token, p_data: data, p_filled_by: who });
  if (error) { out.textContent = czErr(error); btn.disabled = false; btn.textContent = "Odeslat údaje"; return; }
  Object.assign(form, { submitted: data, status: "filled", filled_by: who, filled_at: new Date().toISOString() });
  draw(`<p class="kpi-ok">✅ Děkujeme, údaje byly odeslány. Do ${new Date(form.expires_at).toLocaleDateString("cs-CZ")} je můžete tímto odkazem upravit a odeslat znovu.</p>`);
}

load();
