// Fotky ke kritériím auditu: zmenšení v zařízení → uložení do Supabase Storage (složka podle zákazníka)
// Ve stavu formuláře se ukládá jen cesta k fotce a malá miniatura (pár kB), ne fotka samotná.
import { supabase } from "./supabase.js?v=20261120o";

const BUCKET = "audit-photos";
const MAX_SIDE = 1200, QUALITY = 0.55;   // velká fotka: delší strana 1200 px, JPEG 55 % (obvykle 80–200 kB)
const THUMB = 80, THUMB_Q = 0.5;         // miniatura 80×80 px (asi 2–3 kB)
const BRAND = location.pathname.includes("/stellantis/") ? "stellantis" : location.pathname.includes("/mitsubishi/") ? "mitsubishi" : location.pathname.includes("/hyundai/") ? "hyundai" : location.pathname.includes("/volvo/") ? "volvo" : "arval";
const pending = new Map();               // cesta → { blob, tries } čekající na nahrání
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let rerender = () => {};

const slug = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

function loadImg(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("Fotku se nepodařilo přečíst.")); };
    img.src = url;
  });
}
function toBlob(canvas, q) { return new Promise(r => canvas.toBlob(r, "image/jpeg", q)); }
async function shrink(file) {
  const img = await loadImg(file);
  const w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  const blob = await toBlob(c, QUALITY);
  const t = document.createElement("canvas"); t.width = t.height = THUMB;
  const s = Math.min(w, h);
  t.getContext("2d").drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, THUMB, THUMB);
  return { blob, thumb: t.toDataURL("image/jpeg", THUMB_Q) };
}

async function upload(path, blob) {
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
}
async function flush() {
  for (const [path, p] of pending) {
    try { await upload(path, p.blob); pending.delete(path); p.done(); }
    catch (e) { p.tries++; p.fail(e); }
  }
}
setInterval(() => { if (pending.size && navigator.onLine) flush(); }, 20000);
addEventListener("online", flush);
addEventListener("beforeunload", e => { if (pending.size) { e.preventDefault(); e.returnValue = ""; } });

// ---------- okno s fotkou ----------
function viewer(item, getState, opts, retake) {
  const back = document.createElement("div");
  back.className = "iaph-back no-print";
  back.innerHTML = `<div class="iaph-box" role="dialog" aria-modal="true">
    <div class="iaph-head"><strong>Fotka ke kritériu</strong><button type="button" class="iaph-x" aria-label="Zavřít">×</button></div>
    <div class="iaph-img"><img alt="Fotka kritéria" src="${esc(item.t)}"><span class="iaph-load">Načítám fotku…</span></div>
    <div class="iaph-meta">${item.at ? `Pořízeno ${new Date(item.at).toLocaleString("cs-CZ", { dateStyle: "short", timeStyle: "short" })}` : ""}${item.up === false ? ` · <b class="iaph-warn">zatím nenahráno do úložiště</b>` : ""}</div>
    <div class="iaph-act"><button type="button" data-a="retake">Vyfotit znovu</button><button type="button" data-a="del" class="red">Smazat fotku</button><button type="button" data-a="close" class="ghost">Zavřít</button></div></div>`;
  const close = () => back.remove();
  back.addEventListener("mousedown", e => { if (e.target === back) close(); });
  back.querySelector(".iaph-x").onclick = close;
  back.querySelector('[data-a="close"]').onclick = close;
  back.querySelector('[data-a="retake"]').onclick = () => { close(); retake(); };
  back.querySelector('[data-a="del"]').onclick = async () => {
    if (!confirm("Smazat tuto fotku?")) return;
    const st = getState(); delete st.photos[opts.id];
    pending.delete(item.p);
    supabase.storage.from(BUCKET).remove([item.p]).catch(() => {});
    close(); opts.changed(); rerender();
  };
  document.body.appendChild(back);
  const img = back.querySelector("img"), ld = back.querySelector(".iaph-load");
  const local = pending.get(item.p);
  if (local) { img.src = URL.createObjectURL(local.blob); ld.remove(); }
  else supabase.storage.from(BUCKET).createSignedUrl(item.p, 600).then(({ data, error }) => {
    if (error || !data) { ld.textContent = "Velkou fotku se nepodařilo načíst (zobrazena miniatura)."; return; }
    img.onload = () => ld.remove(); img.src = data.signedUrl;
  });
}

// ---------- jedno trvalé políčko pro výběr fotky ----------
// Políčko je mimo formulář, takže ho překreslení formuláře nezruší (iPhone jinak fotku do stránky nevrátí).
const WAIT_KEY = "ia-photo-wait", NOCAP_KEY = "ia-photo-nocapture";
let target = null;                       // { id, getState, opts, btn } – kritérium, pro které se právě fotí
const picker = document.createElement("input");
picker.type = "file"; picker.accept = "image/*";
picker.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0";
picker.setAttribute("aria-hidden", "true"); picker.tabIndex = -1;
const noCapture = () => { try { return localStorage.getItem(NOCAP_KEY) === "1"; } catch { return false; } };
if (!noCapture()) picker.setAttribute("capture", "environment");
(document.body ? Promise.resolve() : new Promise(r => addEventListener("DOMContentLoaded", r))).then(() => document.body.appendChild(picker));
const clearWait = () => { try { sessionStorage.removeItem(WAIT_KEY); } catch {} };

function openPicker(id, getState, opts, btn) {
  if (!String(opts.partner() || "").trim()) { alert("Nejdřív vyplňte název zákazníka – fotky se ukládají do složky podle zákazníka."); return; }
  target = { id, getState, opts, btn };
  try { sessionStorage.setItem(WAIT_KEY, JSON.stringify({ id, path: location.pathname, at: Date.now() })); } catch {}
  picker.value = "";
  picker.click();
}
picker.addEventListener("cancel", () => { clearWait(); target = null; });
picker.addEventListener("change", async () => {
  clearWait();
  const file = picker.files && picker.files[0]; picker.value = "";
  const t = target; target = null;
  if (!file || !t) return;
  const { id, getState, opts } = t;
  document.querySelectorAll(`[data-iaph="${CSS.escape(id)}"]`).forEach(b => b.classList.add("iaph-busy"));
  let shot;
  try { shot = await shrink(file); } catch (e) { alert(e.message); rerender(); return; }
  const folder = [slug(opts.partner()), String(opts.ic() || "").replace(/\D/g, "")].filter(Boolean).join("-") || "bez-nazvu";
  const path = `${BRAND}/${folder}/${slug(id)}-${Date.now()}.jpg`;
  const s = getState(); s.photos = s.photos || {};
  const old = s.photos[id];
  s.photos[id] = { p: path, t: shot.thumb, at: new Date().toISOString(), kb: Math.round(shot.blob.size / 1024), up: false };
  const entry = { blob: shot.blob, tries: 0,
    done: () => { const cur = getState().photos?.[id]; if (cur && cur.p === path) { cur.up = true; opts.changed(); } if (old?.p) supabase.storage.from(BUCKET).remove([old.p]).catch(() => {}); rerender(); },
    fail: () => rerender() };
  pending.set(path, entry);
  opts.changed(); rerender();
  try { await upload(path, shot.blob); pending.delete(path); entry.done(); }
  catch (e) { entry.tries++; rerender(); console.warn("Nahrání fotky selhalo, zkusím znovu:", e.message); }
});

// Telefon během focení stránku zavřel a znovu načetl → fotka se nepřenesla. Upozorníme a příště nabídneme i galerii.
try {
  const w = JSON.parse(sessionStorage.getItem(WAIT_KEY) || "null");
  if (w && w.path === location.pathname && Date.now() - w.at < 15 * 60000) {
    clearWait();
    try { localStorage.setItem(NOCAP_KEY, "1"); } catch {}
    picker.removeAttribute("capture");
    setTimeout(() => alert("Fotka se nepřenesla – telefon během focení obnovil stránku (obvykle kvůli nedostatku paměti).\n\nVyfoťte prosím kritérium znovu. Nově se vám nabídne volba: buď fotoaparát, nebo výběr hotové fotky z galerie – pokud se to bude opakovat, vyfoťte nejdřív fotoaparátem telefonu a pak ji vyberte z galerie."), 800);
  }
} catch {}

// ---------- tlačítko u kritéria ----------
// id: kritérium, getState(): aktuální stav formuláře, opts: { partner(): název zákazníka, ic(): IČ, changed(): uložit koncept }
function button(id, getState, opts) {
  opts = Object.assign({ partner: () => getState().meta?.partner, ic: () => getState().meta?.ic, changed: () => {} }, opts, { id });
  const st = getState();
  st.photos = st.photos || {};
  const item = st.photos[id];
  const legacy = !item && st.photographed && st.photographed[id];
  const wrap = document.createElement("span");
  wrap.className = "iaph no-print";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.dataset.iaph = id;
  if (item) {
    const bad = item.up === false && !pending.has(item.p);
    btn.className = "iaph-thumb" + (pending.has(item.p) ? " iaph-busy" : "") + (bad ? " iaph-bad" : "");
    btn.title = bad ? "Fotka se nenahrála do úložiště – klikněte a vyfoťte znovu" : pending.has(item.p) ? "Fotka se nahrává…" : "Fotka pořízena – klikněte pro zobrazení";
    btn.innerHTML = `<img src="${esc(item.t)}" alt="">`;
  } else {
    btn.className = "iaph-cam" + (legacy ? " iaph-legacy" : "");
    btn.title = legacy ? "Fotka byla pořízena do zařízení (starší verze) – klikněte pro novou fotku do aplikace" : "Vyfotit kritérium";
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
  }
  btn.setAttribute("aria-label", item ? "Zobrazit fotku kritéria" : "Vyfotit kritérium");
  const pick = () => openPicker(id, getState, opts, btn);
  btn.addEventListener("click", e => { e.stopPropagation(); e.preventDefault(); if (item) viewer(item, getState, opts, pick); else pick(); });
  btn.addEventListener("keydown", e => e.stopPropagation());
  wrap.append(btn);
  return wrap;
}

const css = `
.iaph{display:inline-flex;align-items:center;flex-shrink:0}
.iaph button{width:34px;height:34px;border-radius:8px;padding:0;cursor:pointer;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative}
.iaph-cam{border:1px solid #d6d6d6;background:#fff;color:#6b6b6b}
@media (hover:hover){.iaph-cam:hover{border-color:#1e1e1e;color:#1e1e1e}}
.iaph-legacy{background:#e2f4e9;border-color:#2e7d4f;color:#2e7d4f}
.iaph-thumb{border:2px solid #2e7d4f;background:#eee}
.iaph-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.iaph-busy{border-color:#e0a100!important}
.iaph-busy::after{content:"";position:absolute;inset:0;background:rgba(255,255,255,.45) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='9' fill='none' stroke='%23e0a100' stroke-width='3' stroke-dasharray='40 20'/%3E%3C/svg%3E") center/18px no-repeat}
.iaph-bad{border-color:#E21F25!important}
.iaph-bad::after{content:"!";position:absolute;right:1px;top:-1px;background:#E21F25;color:#fff;font:700 11px/14px sans-serif;width:14px;height:14px;border-radius:50%}
.iaph-back{position:fixed;inset:0;background:rgba(20,20,20,.7);z-index:2147483001;display:flex;align-items:center;justify-content:center;padding:16px;font-family:"Open Sans",system-ui,sans-serif}
.iaph-box{background:#fff;border-radius:14px;max-width:min(900px,100%);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;color:#1e1e1e}
.iaph-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:3px solid #E21F25}
.iaph-x{border:0;background:none;font-size:1.6rem;line-height:1;cursor:pointer;color:#777}
.iaph-img{position:relative;background:#111;display:flex;align-items:center;justify-content:center;min-height:200px;flex:1;overflow:hidden}
.iaph-img img{max-width:100%;max-height:70vh;display:block;object-fit:contain;min-width:240px}
.iaph-load{position:absolute;bottom:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.6);color:#fff;padding:4px 10px;border-radius:6px;font-size:.85rem}
.iaph-meta{padding:8px 16px 0;font-size:.85rem;color:#666}.iaph-warn{color:#b0101d}
.iaph-act{display:flex;flex-wrap:wrap;gap:8px;padding:12px 16px}
.iaph-act button{border:0;border-radius:9px;padding:9px 14px;font:600 .9rem "Open Sans",system-ui,sans-serif;cursor:pointer;background:#1e1e1e;color:#fff}
.iaph-act .red{background:#E21F25}.iaph-act .ghost{background:#fff;color:#1e1e1e;border:1px solid #ccc}
@media print{.iaph,.iaph-back{display:none!important}}`;
{ const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }

window.IA_PHOTOS = { button, onRerender: fn => { rerender = fn; }, pendingCount: () => pending.size };
document.dispatchEvent(new Event("ia-photos-ready"));
