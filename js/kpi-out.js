// KPI – výstupy: dashboard, tabulka po pobočkách, grafy, vlastní cílové benchmarky
import { supabase } from "./supabase.js?v=20261120w";
import { KPIS, PAINT_KPIS, KPI_BY_KEY, periodData, sumBranches, kpiValues, benchmark, targetFor, rate, fmtKpi, periodName, monthCount } from "./kpi-calc.js?v=20261120w";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const CARDS = ["marze", "zisk", "hodnota_mj", "produktivita", "obrat_hod", "spotreba_hod", "obrat_lak", "produktivita_kar"];
const CHARTS = [
  ["spotreba", "Spotřeba (odepsaný lak. materiál) dle střediska"],
  ["obrat", "Obrat (fakturace lak. materiálu) dle střediska"],
  ["zisk", "Zisk (marže) z lak. materiálu / Kč"],
  ["marze", "Zisk (marže) z lak. materiálu / %"],
  ["spotreba_lak", "Spotřeba na 1 lakýrníka"],
  ["obrat_lak", "Obrat na 1 lakýrníka"],
  ["spotreba_hod", "Spotřeba na 1 prodanou hodinu"],
  ["obrat_hod", "Obrat na 1 prodanou hodinu"],
  ["produktivita", "Využití kapacity lakýrníků (produktivita)"],
  ["produktivita_kar", "Produktivita karosárny"],
];

export async function loadTargets() {
  const { data, error } = await supabase.from("kpi_targets").select("key,value");
  if (error) throw error;
  return Object.fromEntries(data.map(r => [r.key, Number(r.value)]));
}
export async function loadAllEntries() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("kpi_entries").select("partner_id,year,period_type,period_no,data").range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

// ---------- Graf (SVG) ----------
export function barChart(title, items, fmt, bench, target) {
  const vals = items.map(i => i.v).filter(v => v != null);
  if (!vals.length) return "";
  if (items.length > 6) return hBarChart(title, items, fmt, bench, target);
  const refs = [bench, target].filter(v => v != null);
  const max = Math.max(...vals, ...refs, 0) * 1.12 || 1;
  const min = Math.min(0, ...vals);
  const W = 460, H = 230, L = 10, R = 10, T = 14, B = 46;
  const h = v => (v - min) / (max - min) * (H - T - B);
  const y0 = H - B - h(0);
  const bw = Math.min(64, (W - L - R) / items.length * 0.62);
  const step = (W - L - R) / items.length;
  const line = (v, cls) => v == null ? "" : `<line x1="${L}" x2="${W - R}" y1="${H - B - h(v)}" y2="${H - B - h(v)}" class="${cls}"/>`;
  const leg = [bench != null ? `<span class="lg-bm-t">┄ benchmark ${esc(fmtKpi(bench, fmt))}</span>` : "", target != null ? `<span class="lg-tg-t">┈ vlastní cíl ${esc(fmtKpi(target, fmt))}</span>` : ""].filter(Boolean).join(" · ");
  return `<figure class="kpi-chart"><figcaption>${esc(title)}${leg ? `<small>${leg}</small>` : ""}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
      <line x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}" class="ax"/>
      ${items.map((it, i) => {
        if (it.v == null) return `<text x="${L + step * i + step / 2}" y="${y0 - 6}" text-anchor="middle" class="na">—</text><text x="${L + step * i + step / 2}" y="${H - B + 16}" text-anchor="middle" class="lab">${esc(it.label)}</text>`;
        const bh = Math.abs(h(it.v) - h(0)), x = L + step * i + (step - bw) / 2, y = it.v >= 0 ? y0 - bh : y0;
        return `<rect x="${x}" y="${y}" width="${bw}" height="${Math.max(bh, 1)}" rx="3" class="${it.total ? "bar-t" : "bar"}"/>
          <text x="${x + bw / 2}" y="${it.v >= 0 ? y - 5 : y + bh + 12}" text-anchor="middle" class="val">${esc(fmtKpi(it.v, fmt))}</text>
          <text x="${x + bw / 2}" y="${H - B + 16}" text-anchor="middle" class="lab">${esc(it.label)}</text>`;
      }).join("")}
      ${line(bench, "bm")}${line(target, "tg")}
    </svg></figure>`;
}

// Vodorovný graf pro mnoho položek (dlouhé názvy vlevo)
function hBarChart(title, items, fmt, bench, target) {
  const vals = items.map(i => i.v).filter(v => v != null);
  const max = Math.max(...vals, bench ?? 0, target ?? 0, 0) * 1.15 || 1, min = Math.min(0, ...vals);
  const W = 560, L = 190, R = 14, rowH = 22, T = 6, H = T + items.length * rowH + 10;
  const x = v => L + (v - min) / (max - min) * (W - L - R);
  const short = s => s.length > 30 ? s.slice(0, 29) + "…" : s;
  const vline = (v, cls) => v == null ? "" : `<line x1="${x(v)}" x2="${x(v)}" y1="${T - 2}" y2="${H - 6}" class="${cls}"/>`;
  const leg = [bench != null ? `<span class="lg-bm-t">┆ benchmark ${esc(fmtKpi(bench, fmt))}</span>` : "", target != null ? `<span class="lg-tg-t">┆ vlastní cíl ${esc(fmtKpi(target, fmt))}</span>` : ""].filter(Boolean).join(" · ");
  return `<figure class="kpi-chart kpi-chart-h"><figcaption>${esc(title)}${leg ? `<small>${leg}</small>` : ""}</figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">
      ${items.map((it, i) => {
        const y = T + i * rowH;
        const lab = `<text x="${L - 6}" y="${y + rowH / 2 + 4}" text-anchor="end" class="lab"><title>${esc(it.label)}</title>${esc(short(it.label))}</text>`;
        if (it.v == null) return lab + `<text x="${L + 4}" y="${y + rowH / 2 + 4}" class="na">—</text>`;
        const x0 = x(Math.min(0, it.v)), w = Math.max(1, Math.abs(x(it.v) - x(0)));
        return lab + `<rect x="${x0}" y="${y + 3}" width="${w}" height="${rowH - 7}" rx="3" class="${it.total ? "bar-t" : "bar"}"/>
          <text x="${x0 + w + 4}" y="${y + rowH / 2 + 4}" class="val">${esc(fmtKpi(it.v, fmt))}</text>`;
      }).join("")}
      <line x1="${x(0)}" x2="${x(0)}" y1="${T - 2}" y2="${H - 6}" class="ax"/>
      ${vline(bench, "bm")}${vline(target, "tg")}
    </svg></figure>`;
}

const dot = r => r > 0 ? `<span class="kpi-dot good" title="lepší než srovnání">▲</span>` : r < 0 ? `<span class="kpi-dot bad" title="horší než srovnání">▼</span>` : "";

// ---------- Výstupy jednoho partnera za zvolené období ----------
// ctx = { partner, entries (partnera), allEntries, partners, targets, sel:{year,type,no} }
export function outputsHtml(ctx) {
  const { partner: p, entries, sel } = ctx;
  const pd = periodData(entries, sel.year, sel.type, sel.no);
  if (!pd) return `<div class="empty">Za ${periodName(sel.type, sel.no)} ${sel.year} nejsou zadané žádné vstupy. Přepněte na „Vstupy“ a vyplňte je, nebo zvolte jiné období.</div>`;
  const br = p.kpi_branches;
  const perBr = br.map(x => ({ name: x.name, v: kpiValues(pd.data.b?.[x.id]) }));
  const totalIn = sumBranches(br.map(x => pd.data.b?.[x.id]).filter(Boolean));
  const tot = kpiValues(totalIn);
  const brMap = Object.fromEntries(ctx.partners.filter(q => q.in_benchmark !== false).map(q => [q.id, q.kpi_branches]));
  const bm = benchmark(ctx.allEntries, brMap, sel.type);
  const defs = KPIS.filter(d => p.has_kar || !d.kar);
  const ref = d => targetFor(d, ctx.targets, sel.type) ?? bm[d.k]?.v ?? null;
  const multi = br.length > 1;

  const note = pd.partial
    ? `<p class="f-note kpi-note kpi-warn">⚠️ Neúplné období – zadáno jen: ${pd.parts.join(", ")}; chybí: ${pd.missing.join(", ")}. Hodnoty odpovídají jen zadané části.</p>`
    : !pd.exact ? `<p class="f-note kpi-note">ℹ️ Sečteno ze zadaných období: ${pd.parts.join(", ")}.</p>` : "";
  const nulls = Object.entries(totalIn).filter(([, v]) => v == null).map(([k]) => k);
  const nullNote = nulls.length && !pd.exact ? `<p class="f-note">Některé vstupy (např. ${nulls.map(k => ({ nakup: "nákup", mj: "prodané MJ", spotreba: "spotřeba", obrat: "obrat" }[k] || k)).slice(0, 3).join(", ")}) chybí v některé části období, proto se ukazatele z nich za celé období nepočítají (—).</p>` : "";

  const cards = CARDS.map(k => KPI_BY_KEY[k]).filter(d => defs.includes(d) && tot[d.k] != null).map(d => {
    const t = targetFor(d, ctx.targets, sel.type), b = bm[d.k]?.v;
    return `<div class="kpi-card ${rate(d, tot[d.k], ref(d)) > 0 ? "good" : rate(d, tot[d.k], ref(d)) < 0 ? "bad" : ""}">
      <div class="kpi-card-l">${esc(d.l)}</div>
      <div class="kpi-card-v">${fmtKpi(tot[d.k], d.fmt)}</div>
      <div class="kpi-card-r">${d.abs ? "absolutní částka – bez benchmarku" : b != null ? `Benchmark: <b>${fmtKpi(b, d.fmt)}</b> ${dot(rate(d, tot[d.k], b))}` : "Benchmark: —"}${t != null ? `<br>Vlastní cíl: <b>${fmtKpi(t, d.fmt)}</b> ${dot(rate(d, tot[d.k], t))}` : ""}</div>
    </div>`;
  }).join("");

  let lastG = "";
  const rows = defs.filter(d => tot[d.k] != null || perBr.some(x => x.v[d.k] != null)).map(d => {
    const g = d.g !== lastG ? `<tr class="kpi-sec"><td colspan="${br.length + (multi ? 4 : 3)}">${esc(d.g)}</td></tr>` : "";
    lastG = d.g;
    const t = targetFor(d, ctx.targets, sel.type), b = d.abs ? null : bm[d.k]?.v, r = ref(d);
    const cell = v => `<td class="kpi-v ${rate(d, v, r) > 0 ? "good" : rate(d, v, r) < 0 ? "bad" : ""}">${fmtKpi(v, d.fmt)}</td>`;
    return g + `<tr><th scope="row">${esc(d.l)}${d.per ? `<span class="muted">za ${periodName(sel.type, sel.no).replace(/^\d+\. /, "").replace("celý rok", "rok")}</span>` : ""}</th>
      ${perBr.map(x => cell(x.v[d.k])).join("")}${multi ? cell(tot[d.k]) : ""}
      <td class="kpi-ref">${d.abs ? "" : b != null ? `${fmtKpi(b, d.fmt)}<span class="muted">${bm[d.k].n} pob.</span>` : "—"}</td>
      <td class="kpi-ref">${d.abs ? "" : t != null ? fmtKpi(t, d.fmt) : "—"}</td></tr>`;
  }).join("");

  const items = k => [...perBr.map(x => ({ label: x.name, v: x.v[k] })), ...(multi ? [{ label: "Celkem", v: tot[k], total: true }] : [])];
  const charts = CHARTS.filter(([k]) => defs.includes(KPI_BY_KEY[k])).map(([k, t]) => {
    const d = KPI_BY_KEY[k];
    // u absolutních částek (spotřeba, obrat, zisk) „Celkem“ do grafu nedáváme – přerostl by pobočky
    const its = d.abs ? perBr.map(x => ({ label: x.name, v: x.v[k] })) : items(k);
    return barChart(t, its, d.fmt, d.abs ? null : bm[k]?.v, d.abs ? null : targetFor(d, ctx.targets, sel.type));
  }).join("");

  return `
    ${note}${nullNote}
    <h4 class="kpi-h kpi-total-h">Výsledky ${esc(p.name)} celkové <span class="kpi-total-n">${br.length} ${br.length === 1 ? "pobočka" : br.length < 5 ? "pobočky" : "poboček"} · ${periodName(sel.type, sel.no)} ${sel.year}</span></h4>
    <div class="kpi-cards">${cards}</div>
    <div class="kpi-legend"><span><i class="lg-good"></i> lepší než cíl (vlastní cíl, jinak benchmark)</span><span><i class="lg-bad"></i> horší</span><span><i class="lg-bm"></i> benchmark = průměr všech poboček partnerů zahrnutých do benchmarku, ze všech uložených dat</span></div>
    <h4 class="kpi-h">Ukazatele podle poboček</h4>
    <div class="table-wrap kpi-table-wrap"><table class="res-table kpi-out">
      <thead><tr><th>Ukazatel</th>${br.map(x => `<th>${esc(x.name)}</th>`).join("")}${multi ? "<th>Celkem</th>" : ""}<th>Benchmark</th><th>Vlastní cíl</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    ${charts ? `<h4 class="kpi-h">Grafy</h4><div class="kpi-charts">${charts}</div>` : ""}
    ${peopleHtml(p, pd.data, ctx, bm, sel)}
    ${paintersHtml(p, pd.data)}`;
}

// Popisek v grafu: příjmení; při shodě příjmení i iniciála jména (např. „J. Procházka“)
function shortName(n, rows) {
  const parts = n.trim().split(/\s+/), sur = parts.slice(-1)[0];
  const same = rows.filter(r => r.n.trim().split(/\s+/).slice(-1)[0] === sur).length > 1;
  return same && parts.length > 1 ? `${parts[0][0]}. ${sur}` : sur;
}

// Produktivita podle jmenovitě zadaných hodin – jednotlivci i středisko jako celek
function peopleHtml(p, data, ctx, bm, sel) {
  if (!data.h) return "";
  const groups = [];
  for (const b of p.kpi_branches) for (const [dk, lab, kk] of [["lak", "Lakovna", "produktivita"], ["kar", "Karosárna", "produktivita_kar"]]) {
    const rows = (data.h[b.id]?.[dk] || []).map(r => ({ ...r, v: r.o ? (r.p ?? null) / r.o : null }));
    if (!rows.length) continue;
    const sum = k => { const xs = rows.map(r => r[k]).filter(v => v != null); return xs.length ? xs.reduce((x, y) => x + y, 0) : null; };
    const o = sum("o"), pp = sum("p");
    groups.push({ b: b.name, lab, d: KPI_BY_KEY[kk], rows, tot: { o, p: pp, v: o ? (pp ?? null) / o : null } });
  }
  if (!groups.length) return "";
  const cls = (d, v, ref) => rate(d, v, ref) > 0 ? "good" : rate(d, v, ref) < 0 ? "bad" : "";
  const body = groups.map(g => {
    const ref = targetFor(g.d, ctx.targets, sel.type) ?? bm[g.d.k]?.v;
    return `<tr class="kpi-sec"><td colspan="4">${esc(g.b)} – ${g.lab}</td></tr>
      ${g.rows.map(r => `<tr><th scope="row">${esc(r.n)}</th><td class="kpi-v">${fmtKpi(r.o, "num")}</td><td class="kpi-v">${fmtKpi(r.p, "num")}</td><td class="kpi-v ${cls(g.d, r.v, ref)}">${fmtKpi(r.v, "pct")}</td></tr>`).join("")}
      <tr class="kpi-total"><th scope="row">Středisko celkem</th><td class="kpi-v">${fmtKpi(g.tot.o, "num")}</td><td class="kpi-v">${fmtKpi(g.tot.p, "num")}</td><td class="kpi-v ${cls(g.d, g.tot.v, ref)}">${fmtKpi(g.tot.v, "pct")}</td></tr>`;
  }).join("");
  const charts = groups.map(g => barChart(`Produktivita – ${g.b} – ${g.lab.toLowerCase()}`,
    [...g.rows.map(r => ({ label: shortName(r.n, g.rows), v: r.v })), { label: "Středisko", v: g.tot.v, total: true }],
    "pct", bm[g.d.k]?.v, targetFor(g.d, ctx.targets, sel.type))).join("");
  return `<h4 class="kpi-h">Produktivita podle zaměstnanců a středisek</h4>
    <p class="f-note">Produktivita = prodané (fakturované) hodiny / odchozené hodiny. Barva porovnává s vlastním cílem, jinak s benchmarkem.</p>
    <div class="table-wrap kpi-table-wrap"><table class="res-table kpi-out kpi-people">
      <thead><tr><th>Jméno</th><th>Odchozené hod.</th><th>Prodané hod.</th><th>Produktivita</th></tr></thead>
      <tbody>${body}</tbody></table></div>
    <div class="kpi-charts">${charts}</div>`;
}

function paintersHtml(p, data) {
  if (!p.has_painters || !data.p || !Object.keys(data.p).length) return "";
  const rows = p.kpi_branches.flatMap(b => b.kpi_painters.map(pt => ({ b: b.name, n: pt.name, raw: data.p[pt.id] }))).filter(r => r.raw);
  if (!rows.length) return "";
  return `<h4 class="kpi-h">Spotřeba lakýrnického materiálu podle lakýrníků</h4>
    <div class="table-wrap kpi-table-wrap"><table class="res-table kpi-out">
      <thead><tr><th>Lakýrník</th><th>Pobočka</th><th>Prodané MJ</th><th>Prodané hod.</th>${PAINT_KPIS.map(d => `<th>${esc(d.l)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => { const v = kpiValues(r.raw, PAINT_KPIS); return `<tr><th scope="row">${esc(r.n)}</th><td>${esc(r.b)}</td>
        <td class="kpi-v">${fmtKpi(r.raw.mj, "num")}</td><td class="kpi-v">${fmtKpi(r.raw.hod, "num")}</td>
        ${PAINT_KPIS.map(d => `<td class="kpi-v">${d.fmt === "l" ? fmtKpi(v[d.k], "l").replace(" l", " l/MJ") : fmtKpi(v[d.k], d.fmt)}</td>`).join("")}</tr>`; }).join("")}</tbody>
    </table></div>`;
}

// ---------- Vlastní cílové benchmarky ----------
export function targetsFormHtml(targets) {
  const defs = KPIS.filter(d => !d.abs && d.dir !== undefined);
  return `<div class="kpi-targets">
    <p class="f-note">Vlastní cíl má přednost před automatickým benchmarkem při barevném hodnocení. Prázdné pole = cíl nenastaven. Ukazatele „na lakýrníka / karosáře“ zadávejte <b>za celý rok</b> – pro kvartál, pololetí či měsíc se přepočtou.</p>
    <table class="res-table kpi-in"><tbody>${defs.map(d => {
      const v = targets[d.k];
      const shown = v == null ? "" : d.fmt === "pct" ? (v * 100).toLocaleString("cs-CZ", { maximumFractionDigits: 2 }) : v.toLocaleString("cs-CZ", { maximumFractionDigits: 2 });
      return `<tr><th scope="row">${esc(d.l)}<span class="muted">${d.fmt === "pct" ? "%" : d.fmt === "kc" ? "Kč" : d.fmt === "x" ? "násobek" : "počet"}${d.per ? " · za rok" : ""}</span></th>
        <td><input class="kpi-num" inputmode="decimal" data-t="${d.k}" value="${esc(shown)}"></td></tr>`;
    }).join("")}</tbody></table>
    <div class="auth-msg" id="kpiTgMsg"></div>
    <button type="button" class="btn-save kpi-btn" id="kpiTgSave">Uložit cíle</button>
    <button type="button" class="btn-logout" id="kpiTgClose">Zavřít</button>
  </div>`;
}

export async function saveTargets(host) {
  const ups = [], dels = [];
  for (const i of host.querySelectorAll("[data-t]")) {
    const d = KPI_BY_KEY[i.dataset.t];
    const t = i.value.replace(/\s| /g, "").replace(",", ".");
    if (t === "") { dels.push(d.k); continue; }
    const n = Number(t);
    if (isNaN(n)) throw new Error(`„${d.l}“ – neplatné číslo.`);
    ups.push({ key: d.k, value: d.fmt === "pct" ? n / 100 : n });
  }
  if (ups.length) { const { error } = await supabase.from("kpi_targets").upsert(ups); if (error) throw error; }
  if (dels.length) { const { error } = await supabase.from("kpi_targets").delete().in("key", dels); if (error) throw error; }
}
