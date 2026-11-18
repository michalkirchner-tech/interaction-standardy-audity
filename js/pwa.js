// Instalace aplikace do mobilu / počítače (PWA)
export function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  const sw = new URL("../sw.js", import.meta.url), scope = new URL("../", import.meta.url);
  navigator.serviceWorker.register(sw, { scope: scope.pathname }).catch(() => {});
}

let deferred = null;
const listeners = new Set();
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; listeners.forEach(f => f()); });
window.addEventListener("appinstalled", () => { deferred = null; listeners.forEach(f => f()); });

export const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isMacSafari = () => /Macintosh/.test(navigator.userAgent) && /Safari\//.test(navigator.userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox/.test(navigator.userAgent) && navigator.maxTouchPoints === 0;
export const canInstall = () => !isStandalone() && (!!deferred || isIOS() || isMacSafari());
export function onInstallChange(f) { listeners.add(f); }

export async function install() {
  if (deferred) {
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null; listeners.forEach(f => f());
    return outcome;
  }
  if (isIOS()) { showIOSHelp(); return "ios"; }
  if (isMacSafari()) { showMacHelp(); return "mac"; }
  return "unavailable";
}

// Nabídka instalace po přihlášení / registraci
const OFFER_KEY = "ia-install-offer";
const OFFER_PAUSE_DAYS = 30;
export async function offerInstall({ force = false } = {}) {
  if (isStandalone() || document.querySelector(".pwa-modal")) return;
  let last = 0;
  try { last = +localStorage.getItem(OFFER_KEY) || 0; } catch {}
  if (!force && last && Date.now() - last < OFFER_PAUSE_DAYS * 86400000) return;
  if (!deferred && !isIOS() && !isMacSafari()) {            // Chrome/Edge posílá nabídku instalace s malým zpožděním
    await new Promise(r => { const t = setTimeout(r, 4000); listeners.add(() => { clearTimeout(t); r(); }); });
  }
  if (!canInstall() || document.querySelector(".pwa-modal")) return;
  const mobile = isIOS() || /Android|Mobi/i.test(navigator.userAgent);
  const d = document.createElement("div");
  d.className = "pwa-modal";
  d.innerHTML = `<div class="pwa-box pwa-offer" role="dialog" aria-modal="true" aria-label="Nainstalovat aplikaci">
    <img src="${new URL("../assets/icons/icon-192.png", import.meta.url)}" alt="" width="72" height="72">
    <h3>Nainstalujte si aplikaci Audity</h3>
    <p>Přidejte si Standardy a audity na ${mobile ? "plochu telefonu" : "plochu počítače"} – otevře se jedním klepnutím jako běžná aplikace, přes celou obrazovku a bez hledání v prohlížeči.</p>
    <div class="pwa-actions"><button type="button" class="btn-primary" data-act="install">${deferred ? "Nainstalovat" : "Ukázat postup"}</button>
    <button type="button" class="pwa-later" data-act="later">Teď ne</button></div>
    <p class="pwa-note">Kdykoli později najdete tlačítko „Nainstalovat“ na úvodní stránce.</p></div>`;
  const close = () => { try { localStorage.setItem(OFFER_KEY, String(Date.now())); } catch {} d.remove(); };
  d.onclick = async e => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (e.target === d || act === "later") close();
    else if (act === "install") { close(); await install(); }
  };
  document.body.appendChild(d);
}

function showMacHelp() {
  showHelp("Instalace na Mac (Safari)", `<li>V horní nabídce Safari zvolte <b>Soubor</b>.</li>
      <li>Klikněte na <b>Přidat do Docku…</b></li>
      <li>Potvrďte <b>Přidat</b> – aplikace <b>Audity</b> se objeví v Docku a ve složce Aplikace.</li>`);
}
function showHelp(title, steps) {
  const d = document.createElement("div");
  d.className = "pwa-modal";
  d.innerHTML = `<div class="pwa-box" role="dialog" aria-modal="true" aria-label="${title}"><h3>${title}</h3><ol>${steps}</ol><button type="button" class="btn-primary">Rozumím</button></div>`;
  d.onclick = e => { if (e.target === d || e.target.tagName === "BUTTON") d.remove(); };
  document.body.appendChild(d);
}

function showIOSHelp() {
  const d = document.createElement("div");
  d.className = "pwa-modal";
  d.innerHTML = `<div class="pwa-box" role="dialog" aria-modal="true" aria-label="Instalace na iPhone">
    <h3>Instalace na iPhone / iPad</h3>
    <ol>
      <li>Otevřete tuto stránku v prohlížeči <b>Safari</b>.</li>
      <li>Klepněte na tlačítko <b>Sdílet</b> <span class="pwa-ic">⎋</span> (čtvereček se šipkou nahoru) dole na liště.</li>
      <li>Sjeďte níž a zvolte <b>Přidat na plochu</b>.</li>
      <li>Potvrďte <b>Přidat</b> – na ploše se objeví ikona <b>Audity</b>.</li>
    </ol>
    <button type="button" class="btn-primary">Rozumím</button></div>`;
  d.onclick = e => { if (e.target === d || e.target.tagName === "BUTTON") d.remove(); };
  document.body.appendChild(d);
}
