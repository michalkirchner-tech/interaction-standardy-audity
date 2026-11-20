// Veřejná stránka pro partnera: vyplnění vstupů KPI přes jedinečný odkaz (bez přihlášení)
import { supabase } from "./supabase.js?v=20261120l";
import { LAK, KAR, PAINT } from "./kpi-defs.js?v=20261120l";

const app = document.getElementById("app");
document.getElementById("year").textContent = new Date().getFullYear();
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
const periodName = (t, n) => t === "M" ? MONTHS[n - 1] : t === "Q" ? `${n}. kvartál` : t === "H" ? `${n}. pololetí` : "celý rok";
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
  const defs = [["Lakovna", LAK], ...(f.has_kar ? [["Karosárna", KAR]] : [])];
  const painters = br.filter(b => b.painters?.length);
  page(`
    <div class="brand-head brand-head-plain"><div>
      <h2>Podklady pro KPI – ${esc(f.partner)}</h2>
      <p>Sledované období: <strong>${esc(per)}</strong> · odkaz platí do ${new Date(f.expires_at).toLocaleDateString("cs-CZ")}</p>
    </div></div>
    <div class="res-card">
      ${msg}
      ${f.status === "filled" && !msg ? `<p class="kpi-ok">Údaje jste už odeslali ${fmtDT(f.filled_at)} (${esc(f.filled_by)}). Níže je můžete upravit a odeslat znovu.</p>` : ""}
      ${f.note ? `<p class="kpi-note f-note">📝 ${esc(f.note)}</p>` : ""}
      <p class="f-note">Vyplňte prosím údaje za uvedené období${br.length > 1 ? " zvlášť za každou pobočku" : ""}. Čísla pište bez měny a mezer nebo s mezerami, desetinná místa s čárkou. Pokud údaj nesledujete, pole nechte prázdné.</p>
      <div class="table-wrap kpi-table-wrap"><table class="res-table kpi-in">
        <thead><tr><th>Ukazatel</th>${br.map(b => `<th>${esc(b.name)}</th>`).join("")}</tr></thead>
        <tbody>${defs.map(([g, list]) => `<tr class="kpi-sec"><td colspan="${br.length + 1}">${g}</td></tr>` + list.map(m => `
          <tr><th scope="row">${esc(m.l)}<span class="muted">${m.u}${m.avg ? " · průměrný stav za období" : ""}</span></th>
          ${br.map(b => cell(s.b?.[b.id]?.[m.k], `data-b="${b.id}" data-k="${m.k}"`)).join("")}</tr>`).join("")).join("")}</tbody>
      </table></div>
      ${painters.length ? `
      <h4 class="kpi-h">Spotřeba materiálu podle lakýrníků</h4>
      <div class="table-wrap kpi-table-wrap"><table class="res-table kpi-in">
        <thead><tr><th>Lakýrník</th>${PAINT.map(m => `<th>${m.l}<span class="muted">${m.u}</span></th>`).join("")}</tr></thead>
        <tbody>${painters.map(b => `<tr class="kpi-sec"><td colspan="${PAINT.length + 1}">${esc(b.name)}</td></tr>` + b.painters.map(pt => `
          <tr><th scope="row">${esc(pt.name)}</th>${PAINT.map(m => cell(s.p?.[pt.id]?.[m.k], `data-p="${pt.id}" data-k="${m.k}"`)).join("")}</tr>`).join("")).join("")}</tbody>
      </table></div>` : ""}
      <div class="kpi-form fill-who"><label>Vyplnil(a) – jméno a příjmení *<input id="fillBy" value="${esc(f.filled_by || "")}" maxlength="120" autocomplete="name"></label></div>
      <div class="auth-msg" id="fillMsg"></div>
      <button type="button" class="btn-save kpi-btn" id="fillSend">Odeslat údaje</button>
    </div>`);
  app.querySelectorAll(".kpi-num").forEach(i => {
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
  const data = { b: {}, p: {} };
  let n = 0;
  app.querySelectorAll("input[data-b]").forEach(i => { const v = parseNum(i.value); if (v != null) { (data.b[i.dataset.b] ||= {})[i.dataset.k] = v; n++; } });
  app.querySelectorAll("input[data-p]").forEach(i => { const v = parseNum(i.value); if (v != null) { (data.p[i.dataset.p] ||= {})[i.dataset.k] = v; n++; } });
  if (!n) { out.textContent = ERR.NIC_NEVYPLNENO; return; }
  const btn = document.getElementById("fillSend"); btn.disabled = true; btn.textContent = "Odesílám…";
  const { error } = await supabase.rpc("kpi_request_submit", { p_token: token, p_data: data, p_filled_by: who });
  if (error) { out.textContent = czErr(error); btn.disabled = false; btn.textContent = "Odeslat údaje"; return; }
  Object.assign(form, { submitted: data, status: "filled", filled_by: who, filled_at: new Date().toISOString() });
  draw(`<p class="kpi-ok">✅ Děkujeme, údaje byly odeslány. Do ${new Date(form.expires_at).toLocaleDateString("cs-CZ")} je můžete tímto odkazem upravit a odeslat znovu.</p>`);
}

load();
