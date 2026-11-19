// Základní údaje auditu: „Příjem do servisu“ a „Mechanická dílna“ – v místě sídla, nebo na jiné adrese.
// Formulář dá k dispozici window.IA_FORM = { state(), changed() } a do stránky vloží prázdné <div class="ialoc-slot">.
// Tento modul do nich bloky vykreslí (i po každém překreslení formuláře).
import { krajFromAddress } from "./results.js?v=20261119h";

const BLOCKS = [
  { key: "mistoPrijmu", title: "Příjem do servisu", kraj: true },
  { key: "mistoDilny", title: "Mechanická dílna", kraj: false, extra: "dilnaField" }, // formulář může přidat pole (Arval: počet mechaniků)
];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const empty = () => ({ jinde: false, ulice: "", psc: "", mesto: "", kraj: "" });
let uid = 0;

function getObj(key) {
  const st = window.IA_FORM?.state?.();
  if (!st || !st.meta) return null;
  if (!st.meta[key] || typeof st.meta[key] !== "object") st.meta[key] = empty();
  return st.meta[key];
}
const changed = () => { try { window.IA_FORM?.changed?.(); } catch (e) {} };

function krajLine(o, state) {
  if (state === "loading") return `<span class="ialoc-muted">Dohledávám kraj…</span>`;
  if (o.kraj) return `Kraj: <strong>${esc(o.kraj)}</strong> <span class="ialoc-muted">(podle této adresy se servis řadí ve filtru krajů)</span>`;
  if (state === "fail") return `<span class="ialoc-bad">Kraj se podle adresy nepodařilo dohledat – zkontrolujte ulici, PSČ a město.</span>`;
  return `<span class="ialoc-muted">Po vyplnění adresy se doplní kraj (pro filtr v přehledu auditů).</span>`;
}

function renderBlock(slot, b) {
  const o = getObj(b.key);
  if (!o) return;
  const n = "ialoc" + (++uid);
  const st = window.IA_FORM.state(), xf = b.extra ? window.IA_FORM[b.extra] : null;
  const card = document.createElement("div");
  card.className = (slot.dataset.card || "card") + " ialoc";
  card.innerHTML = `
    <h3>${esc(b.title)}</h3>
    <div class="ialoc-top">
      <div class="ialoc-opts">
        <label><input type="radio" name="${n}" value="0"${o.jinde ? "" : " checked"}> V místě sídla</label>
        <label><input type="radio" name="${n}" value="1"${o.jinde ? " checked" : ""}> Na jiné adrese</label>
      </div>
      ${xf ? `<label class="ialoc-f ialoc-extra">${esc(xf.label)}<input data-x="1" type="${xf.type || "text"}" value="${esc(st.meta[xf.key] ?? "")}"></label>` : ""}
    </div>
    <div class="ialoc-addr"${o.jinde ? "" : " hidden"}>
      <div class="ialoc-grid">
        <label class="ialoc-f ialoc-wide">Ulice a číslo<input data-k="ulice" value="${esc(o.ulice)}" autocomplete="off"></label>
        <label class="ialoc-f">PSČ<input data-k="psc" value="${esc(o.psc)}" inputmode="numeric" autocomplete="off"></label>
        <label class="ialoc-f">Město<input data-k="mesto" value="${esc(o.mesto)}" autocomplete="off"></label>
      </div>
      ${b.kraj ? `<div class="ialoc-kraj">${krajLine(o)}</div>` : ""}
    </div>`;
  const addr = card.querySelector(".ialoc-addr"), kr = card.querySelector(".ialoc-kraj");
  card.querySelectorAll("input[type=radio]").forEach(r => r.addEventListener("change", () => {
    if (!r.checked) return;
    o.jinde = r.value === "1"; addr.hidden = !o.jinde; changed();
  }));
  let timer = null, seq = 0;
  const lookup = async () => {
    if (!kr) return;
    if (!o.mesto.trim() && !o.psc.trim()) { o.kraj = ""; kr.innerHTML = krajLine(o); changed(); return; }
    const my = ++seq; kr.innerHTML = krajLine(o, "loading");
    const k = await krajFromAddress(o);
    if (my !== seq) return;
    o.kraj = k || ""; kr.innerHTML = krajLine(o, k ? null : "fail"); changed();
  };
  const xi = card.querySelector("input[data-x]");
  if (xi) xi.addEventListener("input", () => { window.IA_FORM.state().meta[xf.key] = xi.value; changed(); });
  card.querySelectorAll("input[data-k]").forEach(inp => {
    inp.addEventListener("input", () => { o[inp.dataset.k] = inp.value; if (b.kraj) { o.kraj = ""; clearTimeout(timer); timer = setTimeout(lookup, 1200); } changed(); });
    inp.addEventListener("click", e => e.stopPropagation());
  });
  slot.appendChild(card);
}

function fill(slot) {
  slot.innerHTML = "";
  slot.dataset.filled = "1";
  BLOCKS.forEach(b => renderBlock(slot, b));
}
function refresh() { document.querySelectorAll(".ialoc-slot").forEach(fill); }
function fillNew() { document.querySelectorAll(".ialoc-slot:not([data-filled])").forEach(fill); }

new MutationObserver(fillNew).observe(document.body, { childList: true, subtree: true });

const css = `
.ialoc h3{margin-top:0}
.ialoc-top{display:grid;grid-template-columns:2fr 1fr 1.4fr;gap:12px 16px;align-items:end}
.ialoc-top .ialoc-opts{align-self:center}
.ialoc-extra{grid-column:2 / span 2}
.ialoc-opts{display:flex;flex-wrap:wrap;gap:10px 22px;margin:4px 0 2px}
.ialoc-opts label{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-weight:500}
.ialoc-opts input{width:18px;height:18px;margin:0;accent-color:currentColor}
.ialoc-addr{margin-top:12px}
.ialoc-grid{display:grid;grid-template-columns:2fr 1fr 1.4fr;gap:12px 16px}
.ialoc-f{display:flex;flex-direction:column;gap:5px;font-size:.82rem;font-weight:600;color:#555}
.ialoc-f input{font:inherit;font-size:.95rem;font-weight:400;color:#1e1e1e;padding:9px 11px;border:1px solid #d5d5d5;border-radius:9px;background:#fff;width:100%;box-sizing:border-box}
.ialoc-f input:focus{outline:2px solid rgba(0,0,0,.15);border-color:#888}
.ialoc-kraj{margin-top:10px;font-size:.86rem}
.ialoc-muted{color:#777}.ialoc-bad{color:#b0101d}
@media(max-width:700px){.ialoc-grid{grid-template-columns:1fr 1fr}.ialoc-wide{grid-column:1/-1}.ialoc-top{grid-template-columns:1fr}.ialoc-extra{grid-column:auto}}
@media print{.ialoc-opts label:has(input:not(:checked)){display:none}.ialoc-opts input{display:none}.ialoc-kraj .ialoc-muted{display:none}}`;
{ const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }

window.IA_LOC = { refresh };
fillNew();
