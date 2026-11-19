// Galerie fotek zákazníka (přehled výsledků): všechny fotky z jeho auditů u dané značky
import { supabase } from "./supabase.js?v=20261119e";
import { criteriaLabels, czDate, esc } from "./results.js?v=20261119e";
import { zip } from "./export.js?v=20261119e";

const BUCKET = "audit-photos";
const KIND = { ostry: "Ostrý audit", nulty: "Nultý audit" };
const slug = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
const fmtTime = iso => iso ? new Date(iso).toLocaleString("cs-CZ", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

export async function openGallery(brand, partner, auditRows) {
  const back = document.createElement("div");
  back.className = "gal-back";
  back.innerHTML = `<div class="gal" role="dialog" aria-modal="true">
    <div class="gal-head"><div><h3>Fotky z auditů</h3><span class="gal-sub">${esc(partner)}</span></div>
      <span class="gal-tools"></span><button type="button" class="gal-x" aria-label="Zavřít">×</button></div>
    <div class="gal-body"><div class="empty">Načítám fotky…</div></div></div>`;
  document.body.appendChild(back);
  document.body.classList.add("gal-open");
  const close = () => { back.remove(); document.body.classList.remove("gal-open"); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape" && !back.querySelector(".gal-lb")) close(); };
  document.addEventListener("keydown", onKey);
  back.querySelector(".gal-x").onclick = close;
  back.addEventListener("mousedown", e => { if (e.target === back) close(); });
  const body = back.querySelector(".gal-body");

  // 1) fotky ze všech auditů zákazníka (nejnovější audit nahoře)
  const ids = auditRows.filter(r => r.photo_count > 0).map(r => r.id);
  const [{ data, error }, labels] = await Promise.all([
    supabase.from("audits").select("id,audit_date,audit_kind,photos:data->photos").in("id", ids),
    criteriaLabels(brand).catch(() => ({})),
  ]);
  if (error) { body.innerHTML = `<div class="empty">Fotky se nepodařilo načíst: ${esc(error.message)}</div>`; return; }
  const audits = data.sort((a, b) => b.audit_date.localeCompare(a.audit_date)).map(a => ({
    ...a,
    items: Object.entries(a.photos || {}).map(([cid, p]) => ({ cid, ...p, label: labels[cid]?.label || `Kritérium ${cid}`, order: labels[cid]?.order ?? 9999 }))
      .sort((x, y) => x.order - y.order),
  })).filter(a => a.items.length);
  const all = audits.flatMap(a => a.items.map(it => ({ ...it, audit: a })));
  if (!all.length) { body.innerHTML = `<div class="empty">U tohoto zákazníka zatím nejsou žádné fotky.</div>`; return; }

  // 2) dočasné odkazy na velké fotky (platí 1 hodinu)
  const { data: urls } = await supabase.storage.from(BUCKET).createSignedUrls(all.map(it => it.p), 3600);
  const urlOf = new Map((urls || []).filter(u => u.signedUrl && !u.error).map(u => [u.path, u.signedUrl]));
  all.forEach((it, i) => { it.i = i; it.url = urlOf.get(it.p) || null; });

  body.innerHTML = audits.map(a => `
    <section class="gal-sec">
      <h4>${KIND[a.audit_kind] || "Audit"} · ${czDate(a.audit_date)} <span>${a.items.length} ${a.items.length === 1 ? "fotka" : a.items.length < 5 ? "fotky" : "fotek"}</span></h4>
      <div class="gal-grid">${all.filter(it => it.audit === a).map(it => `
        <button type="button" class="gal-tile${it.url ? "" : " gal-missing"}" data-i="${it.i}" title="${esc(it.label)}">
          <span class="gal-img" style="background-image:url('${it.t}')">${it.url ? `<img loading="lazy" src="${esc(it.url)}" alt="">` : `<em>není v úložišti</em>`}</span>
          <span class="gal-cap">${esc(it.label)}</span>
        </button>`).join("")}</div>
    </section>`).join("");
  body.querySelectorAll("[data-i]").forEach(b => b.onclick = () => lightbox(+b.dataset.i));

  // ZIP se všemi fotkami
  const tools = back.querySelector(".gal-tools");
  const dl = document.createElement("button");
  dl.type = "button"; dl.className = "btn-exp"; dl.textContent = `Stáhnout vše (ZIP, ${all.filter(x => x.url).length})`;
  dl.onclick = async () => {
    dl.disabled = true;
    const files = [], used = new Set(), perDir = {};
    let n = 0;
    for (const it of all) {
      if (!it.url) continue;
      dl.textContent = `Stahuji ${++n} / ${all.filter(x => x.url).length}…`;
      try {
        const buf = new Uint8Array(await (await fetch(it.url)).arrayBuffer());
        const dir = `${it.audit.audit_date}_${it.audit.audit_kind === "nulty" ? "nulty" : "ostry"}`;
        const seq = (perDir[dir] = (perDir[dir] || 0) + 1);
        let name = `${dir}/${String(seq).padStart(3, "0")}_${slug(it.label)}.jpg`;
        while (used.has(name)) name = name.replace(/\.jpg$/, "_2.jpg");
        used.add(name); files.push({ name, data: buf });
      } catch (e) { console.warn("Fotku se nepodařilo stáhnout", it.p, e); }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zip(files, "application/zip"));
    a.download = `fotky_${brand}_${slug(partner)}.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    dl.disabled = false; dl.textContent = `Stáhnout vše (ZIP, ${all.filter(x => x.url).length})`;
  };
  tools.appendChild(dl);

  // Zvětšená fotka s listováním
  function lightbox(i) {
    const lb = document.createElement("div");
    lb.className = "gal-lb";
    const show = () => {
      const it = all[i];
      lb.innerHTML = `
        <button type="button" class="gal-lb-x" aria-label="Zavřít">×</button>
        <button type="button" class="gal-nav gal-prev" aria-label="Předchozí"${i ? "" : " disabled"}>‹</button>
        <figure><img src="${esc(it.url || it.t)}" alt=""><figcaption><strong>${esc(it.label)}</strong>
          <span>${KIND[it.audit.audit_kind] || "Audit"} ${czDate(it.audit.audit_date)}${it.at ? ` · vyfoceno ${fmtTime(it.at)}` : ""} · ${i + 1} / ${all.length}</span></figcaption></figure>
        <button type="button" class="gal-nav gal-next" aria-label="Další"${i < all.length - 1 ? "" : " disabled"}>›</button>`;
      lb.querySelector(".gal-lb-x").onclick = done;
      lb.querySelector(".gal-prev").onclick = () => { if (i > 0) { i--; show(); } };
      lb.querySelector(".gal-next").onclick = () => { if (i < all.length - 1) { i++; show(); } };
    };
    const key = e => {
      if (e.key === "Escape") done();
      else if (e.key === "ArrowLeft" && i > 0) { i--; show(); }
      else if (e.key === "ArrowRight" && i < all.length - 1) { i++; show(); }
    };
    function done() { lb.remove(); document.removeEventListener("keydown", key); }
    lb.addEventListener("mousedown", e => { if (e.target === lb) done(); });
    // přejetí prstem na telefonu
    let sx = null;
    lb.addEventListener("touchstart", e => { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", e => { if (sx == null) return; const dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 50) { if (dx < 0 && i < all.length - 1) i++; else if (dx > 0 && i > 0) i--; show(); } sx = null; });
    document.addEventListener("keydown", key);
    back.appendChild(lb);
    show();
  }
}
