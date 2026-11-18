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
export const canInstall = () => !isStandalone() && (!!deferred || isIOS());
export function onInstallChange(f) { listeners.add(f); }

export async function install() {
  if (deferred) {
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null; listeners.forEach(f => f());
    return outcome;
  }
  if (isIOS()) { showIOSHelp(); return "ios"; }
  return "unavailable";
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
