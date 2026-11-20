// Standardy a audity – úvodní stránka s dlaždicemi značek
import { supabase, getProfile } from "./js/supabase.js?v=20261121a";
import { exportPdf, exportXlsx } from "./js/export.js?v=20261121a";
import { registerSW, canInstall, install, onInstallChange, offerInstall } from "./js/pwa.js?v=20261121a";
import { renderBackups, backupReminderHtml } from "./js/backup.js?v=20261121a";
import { renderUsers } from "./js/users.js?v=20261121a";
import { openGallery } from "./js/gallery.js?v=20261121a";
import { openPreview } from "./js/preview.js?v=20261121a";
import { renderMultibrand } from "./js/multibrand.js?v=20261121a";
import { renderKpi } from "./js/kpi.js?v=20261121a";
import { RESULT_BRANDS, NO_VALIDITY, arvalDefs, loadAudits, exportTable, latestPerCustomer, statusOf, dashboardHtml, detectBrand, prepareImport, saveAudit, deleteAudit, czDate, defaultFilter, custKey, loadInactive, markInactive, setInactive, stOf, esc as escR } from "./js/results.js?v=20261121a";

const BRANDS = [
  { id: "arval",      name: "Arval",       logo: "assets/logos/arval.png",      wide: true, url: "arval/" },
  { id: "stellantis", name: "Stellantis",  logo: "assets/logos/stellantis.svg", wide: true, url: "stellantis/" },
  { id: "mercedes",   name: "Mercedes-Benz", logo: "assets/logos/mercedes.svg" },
  { id: "skoda",      name: "Škoda Auto",  logo: "assets/logos/skoda.svg",      wide: true, url: "skoda/" },
  { id: "porsche-cr", name: "Porsche ČR",  logo: "assets/logos/porsche-cr.svg", wide: true, url: "porsche-cr/" },
  { id: "volvo",      name: "Volvo",       logo: "assets/logos/volvo.svg",      url: "volvo/" },
  { id: "mitsubishi", name: "Mitsubishi",  logo: "assets/logos/mitsubishi.svg", url: "mitsubishi/" },
  { id: "hyundai",    name: "Hyundai",     logo: "assets/logos/hyundai.svg",    wide: true, url: "hyundai/" },
  { id: "byd",        name: "BYD",         logo: "assets/logos/byd.svg",        wide: true, url: "byd/" },
  { id: "tesla",      name: "Tesla",       logo: "assets/logos/tesla.svg" },
  { id: "ford",       name: "Ford",        logo: "assets/logos/ford.svg",       wide: true },
  { id: "toyota",     name: "Toyota",      logo: "assets/logos/toyota.svg",     wide: true, url: "toyota/" },
];

const app = document.getElementById("app");
const userBox = document.getElementById("userBox");
document.getElementById("year").textContent = new Date().getFullYear();
let profile = null;
let justSignedIn = false;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Přihlášení a registrace ----------
const ERR = {
  "Invalid login credentials": "Nesprávný e-mail nebo heslo.",
  "User already registered": "Tento e-mail je už zaregistrovaný – přihlaste se.",
  "Email not confirmed": "E-mail ještě není potvrzený – klikněte na odkaz v e-mailu od Supabase.",
  "Password should be at least 6 characters.": "Heslo musí mít alespoň 6 znaků.",
};
const czErr = e => ERR[e?.message] || (e?.message?.includes("rate limit") ? "Příliš mnoho pokusů, zkuste to za chvíli." : "Chyba: " + (e?.message || e));

function renderAuth(mode = "login", msg = "") {
  document.body.classList.add("is-home");
  userBox.innerHTML = "";
  const reg = mode === "register";
  app.innerHTML = `
    <section class="hero hero-auth">
      <h1>Standardy a audity</h1>
      <p>${reg ? "Registrace nového uživatele" : "Přihlaste se pro vstup do aplikace"}</p>
    </section>
    <section class="auth-card">
      <div class="auth-tabs">
        <button type="button" data-mode="login" class="${reg ? "" : "active"}">Přihlášení</button>
        <button type="button" data-mode="register" class="${reg ? "active" : ""}">Registrace</button>
      </div>
      <form id="authForm" novalidate>
        ${reg ? `<label>Jméno a příjmení<input name="name" autocomplete="name" required></label>` : ""}
        <label>E-mail<input name="email" type="email" autocomplete="email" required></label>
        <label>Heslo<input name="password" type="password" autocomplete="${reg ? "new-password" : "current-password"}" required minlength="6"></label>
        ${reg ? `<label>Heslo znovu<input name="password2" type="password" autocomplete="new-password" required minlength="6"></label>` : ""}
        <div class="auth-msg" id="authMsg">${msg}</div>
        <button class="btn-primary" type="submit">${reg ? "Zaregistrovat" : "Přihlásit"}</button>
      </form>
    </section>`;
  app.querySelectorAll(".auth-tabs button").forEach(b => b.onclick = () => renderAuth(b.dataset.mode));
  const form = document.getElementById("authForm");
  const out = document.getElementById("authMsg");
  form.onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    out.className = "auth-msg";
    if (!f.email || !f.password) { out.textContent = "Vyplňte e-mail a heslo."; return; }
    if (reg && !f.name.trim()) { out.textContent = "Vyplňte jméno a příjmení."; return; }
    if (reg && f.password !== f.password2) { out.textContent = "Hesla se neshodují."; return; }
    const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      if (reg) {
        const { data, error } = await supabase.auth.signUp({ email: f.email.trim(), password: f.password, options: { data: { full_name: f.name.trim() } } });
        if (error) throw error;
        if (!data.session) { renderAuth("login", "Registrace proběhla. Potvrďte prosím e-mail odkazem, který vám přišel, a pak se přihlaste."); return; }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: f.email.trim(), password: f.password });
        if (error) throw error;
      }
      justSignedIn = true;
      await start();
    } catch (err) { out.textContent = czErr(err); btn.disabled = false; }
  };
}

function renderUserBox() {
  const name = profile.full_name || profile.email;
  userBox.innerHTML = `
    <span class="user-name" title="${esc(profile.email)}">${esc(name)}</span>
    ${profile.role === "admin" ? `<a class="btn-backup btn-kpi" href="#kpi" title="KPI servisních partnerů">📊<span class="bk-txt"> KPI</span><span class="kpi-badge-n" id="kpiBadge" hidden></span></a><a class="btn-backup" href="#uzivatele" title="Registrovaní uživatelé">👥<span class="bk-txt"> Uživatelé</span></a><a class="btn-backup" href="#zalohy" title="Zálohy dat">💾<span class="bk-txt"> Zálohy</span></a><span class="badge-admin">Admin</span>` : ""}
    <button type="button" class="btn-logout" id="btnLogout">Odhlásit</button>`;
  if (profile.role === "admin") updateKpiBadge();
  document.getElementById("btnLogout").onclick = async () => { await supabase.auth.signOut(); profile = null; location.hash = ""; renderAuth(); };
}

// Počet vyplnění od partnerů, která čekají na uložení (číslo na tlačítku KPI)
async function updateKpiBadge() {
  const el = document.getElementById("kpiBadge");
  if (!el || profile?.role !== "admin") return;
  const { count, error } = await supabase.from("kpi_requests").select("id", { count: "exact", head: true }).not("filled_at", "is", null).is("imported_at", null);
  if (error) return;
  el.hidden = !count; el.textContent = count || "";
  el.title = count ? `${count} vyplnění od partnerů čeká na uložení` : "";
}
document.addEventListener("kpi-inbox-changed", updateKpiBadge);

function renderHome() {
  document.title = "Standardy a audity | INTERACTION";
  app.innerHTML = `
    <section class="hero">
      <h1>Standardy a audity</h1>
      <p>Vyberte značku</p>
      <a class="btn-results" href="#vysledky">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
        Výsledky auditů
      </a>
      <a class="btn-results btn-multi" href="#multibrand" title="Rozdílový list mezi standardy značek">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="9" height="12" rx="2"/><rect x="12.5" y="8" width="9" height="12" rx="2"/><path d="M15.5 14h3M17 12.5v3"/></g></svg>
        Multi brand
      </a>
      <div><button type="button" class="btn-install" id="btnInstall" hidden>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM12 7v7m-3-3 3 3 3-3M10 19h4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Nainstalovat do mobilu</button></div>
    </section>
    <div id="backupRemind"></div>
    <section class="grid">
      ${BRANDS.map(b => `
        <a class="tile" href="${b.url || "#" + b.id}" aria-label="${b.name}">
          <span class="tile-logo${b.wide ? " wide" : ""}"><img src="${b.logo}" alt="${b.name}"></span>
          <span class="tile-name">${b.name}</span>
        </a>`).join("")}
    </section>`;
  app.querySelectorAll(".tile").forEach(attachTilt);
  const ib = document.getElementById("btnInstall");
  const upd = () => { if (document.body.contains(ib)) ib.hidden = !canInstall(); };
  upd(); onInstallChange(upd);
  ib.onclick = () => install();
  if (profile.role === "admin") backupReminderHtml().then(h => { const el = document.getElementById("backupRemind"); if (el) el.innerHTML = h; });
}

function renderBrand(brand) {
  document.title = `${brand.name} – Standardy a audity | INTERACTION`;
  app.innerHTML = `
    <section class="brand-page">
      <a class="back" href="#">← Zpět na přehled značek</a>
      <div class="brand-head">
        <img src="${brand.logo}" alt="${brand.name}">
        <div>
          <h2>${brand.name}</h2>
          <p>Standardy a audity</p>
        </div>
      </div>
      <div class="empty">Obsah pro značku ${brand.name} zatím není připraven – doplníme v dalším kroku.</div>
    </section>`;
  window.scrollTo(0, 0);
}

// 3D náklon dlaždice podle pozice myši
function attachTilt(tile) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  tile.addEventListener("pointermove", e => {
    const r = tile.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;   // 0..1
    const y = (e.clientY - r.top) / r.height;   // 0..1
    tile.style.setProperty("--ry", `${(x - 0.5) * 18}deg`);
    tile.style.setProperty("--rx", `${(0.5 - y) * 18}deg`);
    tile.style.setProperty("--gx", `${x * 100}%`);
    tile.style.setProperty("--gy", `${y * 100}%`);
  });
  tile.addEventListener("pointerleave", () => {
    tile.style.setProperty("--rx", "0deg");
    tile.style.setProperty("--ry", "0deg");
  });
}

// ---------- Výsledky auditů ----------
async function renderResultsHome() {
  document.title = "Výsledky auditů | INTERACTION";
  app.innerHTML = `
    <section class="hero"><h1>Výsledky auditů</h1><p>Vyberte značku</p></section>
    <section class="grid grid-3">
      ${RESULT_BRANDS.map(b => `
        <a class="tile" href="#vysledky-${b.id}" aria-label="Výsledky ${b.name}">
          <span class="tile-logo${b.wide ? " wide" : ""}"><img src="assets/logos/${b.logo.split("/").pop()}" alt="${b.name}"></span>
          <span class="tile-name">${b.name}</span>
          <span class="tile-stats" data-stats="${b.id}">načítám…</span>
        </a>`).join("")}
    </section>`;
  app.querySelectorAll(".tile").forEach(attachTilt);
  try {
    const [all, inact] = await Promise.all([loadAudits(), loadInactive()]);
    const rows = latestPerCustomer(markInactive(all, inact).filter(r => (r.audit_kind || "ostry") === "ostry"));
    for (const b of RESULT_BRANDS) {
      const own = rows.filter(r => r.brand === b.id);
      const mine = own.map(r => stOf(r).key);
      const ex = mine.filter(k => k === "expired").length, so = mine.filter(k => k === "soon").length;
      const fail = NO_VALIDITY.has(b.id) ? own.filter(r => !/^Úspěšný/.test(r.result || "")).length : 0;
      app.querySelector(`[data-stats="${b.id}"]`).innerHTML = !mine.length ? "zatím bez auditů"
        : `${mine.length} zákazníků${ex ? ` · <b class="c-exp">${ex} propadlé</b>` : ""}${so ? ` · <b class="c-soon">${so} blíží se</b>` : ""}${fail ? ` · <b class="c-exp">${fail} neúspěšné</b>` : ""}`;
    }
  } catch (e) { app.querySelectorAll("[data-stats]").forEach(x => x.textContent = "chyba načtení"); }
}

const filters = {};
async function renderResultsBrand(b) {
  document.title = `Výsledky ${b.name} | INTERACTION`;
  app.innerHTML = `
    <section class="brand-page wide-page">
      <a class="back" href="#vysledky">← Zpět na výsledky auditů</a>
      <div class="brand-head">
        <img src="${b.logo}" alt="${b.name}">
        <div><h2>Výsledky auditů – ${b.name}</h2><p>${NO_VALIDITY.has(b.id) ? "Výsledek je úspěšný nebo neúspěšný; recertifikační lhůta se neuvádí." : "Nahoře jsou propadlé audity a audity, kterým se blíží termín."}</p></div>
      </div>
      <div id="dash"><div class="empty">Načítám…</div></div>
    </section>`;
  const dash = document.getElementById("dash");
  const isAdmin = profile.role === "admin";
  const filt = filters[b.id] || (filters[b.id] = defaultFilter()); // filtry zůstanou nastavené během práce v aplikaci
  let defs = null, rows = [];
  const draw = () => {
    const kOpen = document.getElementById("fKraj")?.open;
    dash.innerHTML = dashboardHtml(b.id, rows, isAdmin, defs, filt);
    if (kOpen) document.getElementById("fKraj").open = true;
    dash.querySelectorAll("[data-export]").forEach(btn => btn.onclick = () => {
      const t = exportTable(b.id, rows, defs, filt);
      if (!t.rows.length) return alert("Žádní zákazníci k exportu (zkontrolujte filtry a vyhledávání).");
      if (btn.dataset.export === "pdf") exportPdf(t); else exportXlsx(t, t.file + ".xlsx");
    });
    const search = document.getElementById("resSearch");
    const applySearch = () => { const q = filt.q.toLowerCase().trim(); dash.querySelectorAll("tbody tr").forEach(tr => tr.hidden = q && !tr.dataset.q.includes(q)); };
    if (search) { search.oninput = () => { filt.q = search.value; applySearch(); }; applySearch(); }
    const kind = document.getElementById("fKind"); if (kind) kind.onchange = () => { filt.kind = kind.value; draw(); };
    const per = document.getElementById("fPeriod"); if (per) per.onchange = () => { filt.period = per.value; draw(); };
    dash.querySelectorAll("#fKraj input[type=checkbox]").forEach(cb => cb.onchange = () => {
      filt.kraje = [...dash.querySelectorAll("#fKraj input:checked")].map(x => x.value); draw();
    });
    const clr = dash.querySelector("[data-kraj-clear]"); if (clr) clr.onclick = () => { filt.kraje = []; draw(); };
    const toggle = (btn, inactive) => async () => {
      const r = rows.find(x => custKey(x) === (inactive ? btn.dataset.inactCust : btn.dataset.actCust));
      if (!r) return;
      const msg = inactive
        ? `Označit zákazníka „${btn.dataset.name}“ jako neaktivního (${b.name})?\n\nAudity se nesmažou. ${NO_VALIDITY.has(b.id) ? "" : "Zákazník přestane hlásit termín a propadlý audit, "}V seznamu bude dole s označením „Neaktivní“ a dál se započítává do celkového počtu. Kdykoli ho můžete znovu aktivovat.`
        : `Znovu aktivovat zákazníka „${btn.dataset.name}“? Bude zase hlásit termíny příštích auditů.`;
      if (!confirm(msg)) return;
      btn.disabled = true;
      try { await setInactive(b.id, r, inactive); refresh(); }
      catch (e) { alert("Změna se nepodařila: " + e.message); btn.disabled = false; }
    };
    dash.querySelectorAll("[data-pv]").forEach(btn => btn.onclick = () => openPreview(b.id, btn.dataset.pv));
    dash.querySelectorAll("[data-gal]").forEach(btn => btn.onclick = () => openGallery(b.id, btn.dataset.name, rows.filter(r => custKey(r) === btn.dataset.gal)));
    dash.querySelectorAll("[data-inact-cust]").forEach(btn => btn.onclick = toggle(btn, true));
    dash.querySelectorAll("[data-act-cust]").forEach(btn => btn.onclick = toggle(btn, false));
    const file = document.getElementById("importFile");
    if (file) file.onchange = () => handleImport(b, [...file.files], refresh);
  };
  const refresh = async () => {
    try { defs = b.id === "arval" ? await arvalDefs() : null; const [a, inact] = await Promise.all([loadAudits(b.id), loadInactive()]); rows = markInactive(a, inact); }
    catch (e) { dash.innerHTML = `<div class="empty">Data se nepodařilo načíst: ${escR(e.message)}</div>`; return; }
    draw();
  };
  refresh();
}

async function handleImport(b, files, refresh) {
  const out = document.getElementById("importOut");
  const recs = [];
  out.innerHTML = "Zpracovávám…";
  for (const f of files) {
    try {
      const state = JSON.parse(await f.text());
      const brand = detectBrand(state);
      if (!brand) throw new Error("soubor nevypadá jako uložený audit z formuláře");
      if (brand !== b.id) throw new Error(`jde o audit ${{ arval: "Arval", stellantis: "Stellantis", mitsubishi: "Mitsubishi", hyundai: "Hyundai", volvo: "Volvo" }[brand]}, ne ${b.name}`);
      recs.push({ f: f.name, rec: await prepareImport(state, brand) });
    } catch (e) { recs.push({ f: f.name, err: e.message }); }
  }
  const ok = recs.filter(r => r.rec);
  out.innerHTML = `
    <table class="res-table small"><thead><tr><th>Soubor</th><th>Zákazník</th><th>Datum auditu</th><th>Platnost</th><th>Výsledek</th></tr></thead><tbody>
    ${recs.map(r => r.err ? `<tr><td>${escR(r.f)}</td><td colspan="4" class="c-exp">Nelze načíst: ${escR(r.err)}</td></tr>` : `
      <tr><td>${escR(r.f)}</td><td><strong>${escR(r.rec.partner)}</strong><span class="muted">${r.rec.ic ? "IČ " + escR(r.rec.ic) : ""}</span></td>
      <td>${czDate(r.rec.audit_date)}</td>
      <td>${r.rec.valid_months ? `<select data-valid="${recs.indexOf(r)}">${[12, 24, 36].map(m => `<option value="${m}" ${m === r.rec.valid_months ? "selected" : ""}>${m} měsíců</option>`).join("")}</select>` : "—"}</td>
      <td class="res-col">${escR(r.rec.result.split(" | ")[0])}</td></tr>`).join("")}
    </tbody></table>
    ${ok.length ? `<button type="button" class="btn-save" id="importSave">Uložit ${ok.length} ${ok.length === 1 ? "audit" : "audity"} do databáze</button>` : ""}
    <button type="button" class="btn-logout" id="importCancel">Zrušit</button>`;
  out.querySelectorAll("[data-valid]").forEach(s => s.onchange = () => recs[+s.dataset.valid].rec.valid_months = +s.value);
  document.getElementById("importCancel").onclick = () => { out.innerHTML = ""; document.getElementById("importFile").value = ""; };
  const save = document.getElementById("importSave");
  if (save) save.onclick = async () => {
    save.disabled = true;
    const msgs = [];
    for (const r of ok) {
      try { const how = await saveAudit(r.rec); msgs.push(`✓ ${escR(r.rec.partner)} – ${how === "updated" ? "přepsán existující záznam" : "uloženo"}`); }
      catch (e) { msgs.push(`<span class="c-exp">✗ ${escR(r.rec.partner)} – ${escR(e.message)}</span>`); }
    }
    await refresh();
    const o2 = document.getElementById("importOut");
    if (o2) o2.innerHTML = msgs.join("<br>");
  };
}

function route() {
  const id = location.hash.replace(/^#\/?/, "");
  document.body.classList.toggle("is-home", !id);
  const brand = BRANDS.find(b => b.id === id);
  const rb = RESULT_BRANDS.find(b => "vysledky-" + b.id === id);
  if (id === "zalohy" && profile.role === "admin") renderBackups(app);
  else if (id === "uzivatele" && profile.role === "admin") renderUsers(app, profile);
  else if (id === "kpi" && profile.role === "admin") renderKpi(app);
  else if (id === "vysledky") renderResultsHome();
  else if (id === "multibrand") renderMultibrand(app);
  else if (rb) renderResultsBrand(rb);
  else if (brand) renderBrand(brand);
  else renderHome();
}

async function start() {
  profile = await getProfile();
  if (!profile) { renderAuth(); return; }
  renderUserBox();
  const next = new URLSearchParams(location.search).get("next");
  if (next && /^[a-z-]+\/$/.test(next)) { location.replace(next); return; }
  route();
  offerInstall({ force: justSignedIn });
  justSignedIn = false;
}

window.addEventListener("hashchange", () => { if (profile) { route(); updateKpiBadge(); } });
registerSW();
start();
