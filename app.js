// Standardy a audity – úvodní stránka s dlaždicemi značek
import { supabase, getProfile } from "./js/supabase.js";

const BRANDS = [
  { id: "arval",      name: "Arval",       logo: "assets/logos/arval.png",      wide: true, url: "arval/" },
  { id: "stellantis", name: "Stellantis",  logo: "assets/logos/stellantis.svg", wide: true, url: "stellantis/" },
  { id: "mercedes",   name: "Mercedes-Benz", logo: "assets/logos/mercedes.svg" },
  { id: "skoda",      name: "Škoda Auto",  logo: "assets/logos/skoda.svg",      wide: true },
  { id: "porsche-cr", name: "Porsche ČR",  logo: "assets/logos/porsche-cr.svg", wide: true },
  { id: "volvo",      name: "Volvo",       logo: "assets/logos/volvo.svg" },
  { id: "mitsubishi", name: "Mitsubishi",  logo: "assets/logos/mitsubishi.svg" },
  { id: "hyundai",    name: "Hyundai",     logo: "assets/logos/hyundai.svg",    wide: true },
];

const app = document.getElementById("app");
const userBox = document.getElementById("userBox");
document.getElementById("year").textContent = new Date().getFullYear();
let profile = null;

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
      await start();
    } catch (err) { out.textContent = czErr(err); btn.disabled = false; }
  };
}

function renderUserBox() {
  const name = profile.full_name || profile.email;
  userBox.innerHTML = `
    <span class="user-name" title="${esc(profile.email)}">${esc(name)}</span>
    ${profile.role === "admin" ? `<span class="badge-admin">Admin</span>` : ""}
    <button type="button" class="btn-logout" id="btnLogout">Odhlásit</button>`;
  document.getElementById("btnLogout").onclick = async () => { await supabase.auth.signOut(); profile = null; location.hash = ""; renderAuth(); };
}

function renderHome() {
  document.title = "Standardy a audity | INTERACTION";
  app.innerHTML = `
    <section class="hero">
      <h1>Standardy a audity</h1>
      <p>Vyberte značku</p>
    </section>
    <section class="grid">
      ${BRANDS.map(b => `
        <a class="tile" href="${b.url || "#" + b.id}" aria-label="${b.name}">
          <span class="tile-logo${b.wide ? " wide" : ""}"><img src="${b.logo}" alt="${b.name}"></span>
          <span class="tile-name">${b.name}</span>
        </a>`).join("")}
    </section>`;
  app.querySelectorAll(".tile").forEach(attachTilt);
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

function route() {
  document.body.classList.toggle("is-home", !BRANDS.some(b => "#" + b.id === location.hash));
  const id = location.hash.replace(/^#\/?/, "");
  const brand = BRANDS.find(b => b.id === id);
  brand ? renderBrand(brand) : renderHome();
}

async function start() {
  profile = await getProfile();
  if (!profile) { renderAuth(); return; }
  renderUserBox();
  const next = new URLSearchParams(location.search).get("next");
  if (next && /^[a-z-]+\/$/.test(next)) { location.replace(next); return; }
  route();
}

window.addEventListener("hashchange", () => { if (profile) route(); });
start();
