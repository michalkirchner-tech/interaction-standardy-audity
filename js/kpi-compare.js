// KPI – porovnání partnerů (nebo jejich poboček) mezi sebou
import { KPIS, KPI_BY_KEY, periodData, sumBranches, kpiValues, benchmark, targetFor, fmtKpi, periodName, monthCount } from "./kpi-calc.js?v=20261120m";
import { barChart } from "./kpi-out.js?v=20261120m";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TYPES = { M: "měsíc", Q: "kvartál", H: "pololetí", Y: "rok" };
const KEY_CHARTS = ["marze", "hodnota_mj", "produktivita", "obrat_hod", "spotreba_hod", "obrat_lak", "obrat_zak", "spotreba_zak", "produktivita_kar"];

// stav porovnání zůstává během práce v aplikaci
const st = { ids: null, level: "partner", norm: "Q", periods: {}, kpi: "marze", view: "all" };

// Všechna období, za která má partner data (přímo zadaná i složená z kratších)
function periodOptions(entries) {
  const years = [...new Set(entries.map(e => e.year))].sort((a, b) => b - a);
  const out = [];
  for (const y of years) for (const [t, n] of [["Y", 1], ["H", 2], ["Q", 4], ["M", 12]]) for (let i = n; i >= 1; i--) {
    const pd = periodData(entries, y, t, i);
    if (pd) out.push({ id: `${y}-${t}-${i}`, y, t, n: i, partial: !!pd.partial, label: `${periodName(t, i)} ${y}${pd.partial ? " (neúplné)" : ""}` });
  }
  return out;
}
const pickDefault = (opts, norm) => (opts.find(o => o.t === norm && !o.partial) || opts.find(o => !o.partial) || opts[0])?.id;

export function renderCompare(host, ctx) {
  const { partners, allEntries, targets } = ctx;
  const byP = {};
  allEntries.forEach(e => (byP[e.partner_id] ||= []).push(e));
  const withData = partners.filter(p => byP[p.id]?.length);
  if (st.ids == null) st.ids = withData.map(p => p.id);
  st.ids = st.ids.filter(id => withData.some(p => p.id === id));
  const opts = Object.fromEntries(withData.map(p => [p.id, periodOptions(byP[p.id])]));

  const draw = () => {
    for (const id of st.ids) if (!opts[id].some(o => o.id === st.periods[id])) st.periods[id] = pickDefault(opts[id], st.norm);
    const sel = withData.filter(p => st.ids.includes(p.id));
    // jednotky porovnání
    const units = [];
    for (const p of sel) {
      const o = opts[p.id].find(x => x.id === st.periods[p.id]);
      const pd = periodData(byP[p.id], o.y, o.t, o.n);
      const f = monthCount(st.norm) / monthCount(o.t);
      const scale = v => Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x != null && KPI_BY_KEY[k]?.per ? x * f : x]));
      const per = o.label;
      if (st.level === "partner") units.push({ name: p.name, per, t: o.t, partial: o.partial, v: scale(kpiValues(sumBranches(p.kpi_branches.map(b => pd.data.b?.[b.id]).filter(Boolean)))), kar: p.has_kar });
      else p.kpi_branches.forEach(b => { if (pd.data.b?.[b.id]) units.push({ name: p.kpi_branches.length > 1 ? `${p.name} – ${b.name}` : p.name, per, t: o.t, partial: o.partial, v: scale(kpiValues(pd.data.b[b.id])), kar: p.has_kar }); });
    }
    const bm = benchmark(allEntries, Object.fromEntries(partners.map(p => [p.id, p.kpi_branches])), st.norm);
    const anyKar = units.some(u => u.kar);
    const defs = KPIS.filter(d => (!d.kar || anyKar) && units.some(u => u.v[d.k] != null));
    if (!defs.some(d => d.k === st.kpi)) st.kpi = defs[0]?.k;
    const normTxt = `za ${TYPES[st.norm]}`;

    host.innerHTML = `
      <div class="res-card">
        <div class="kpi-bar"><h3>Porovnání partnerů</h3></div>
        <div class="kpi-cmp-pick">
          <div class="kpi-lbl-sm">Partneři k porovnání</div>
          ${withData.map(p => `<label class="kpi-check"><input type="checkbox" data-pid="${p.id}" ${st.ids.includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>
            ${st.ids.includes(p.id) ? `<select class="kpi-cmp-per" data-per="${p.id}" title="Období partnera">${opts[p.id].map(o => `<option value="${o.id}" ${o.id === st.periods[p.id] ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select>` : ""}<br>`).join("")}
          ${partners.length > withData.length ? `<p class="f-note">Partneři bez zadaných dat se v porovnání nenabízejí: ${partners.filter(p => !withData.includes(p)).map(p => esc(p.name)).join(", ")}.</p>` : ""}
        </div>
        <div class="kpi-period">
          <label>Porovnávat<select id="cmpLevel"><option value="partner" ${st.level === "partner" ? "selected" : ""}>partnery celkem</option><option value="branch" ${st.level === "branch" ? "selected" : ""}>jednotlivé pobočky</option></select></label>
          <label>Ukazatele „na lakýrníka / karosáře“ přepočítat na<select id="cmpNorm">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${k === st.norm ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        </div>
        ${!units.length ? `<div class="empty">Vyberte alespoň jednoho partnera.</div>` : `
        <div class="kpi-tabs kpi-tabs-inline"><button type="button" data-view="all" class="${st.view === "all" ? "active" : ""}">Všechny KPI vedle sebe</button><button type="button" data-view="one" class="${st.view === "one" ? "active" : ""}">Podle ukazatele</button></div>
        ${new Set(units.map(u => u.per)).size > 1 ? `<p class="f-note kpi-note">ℹ️ Partneři mají různá období. Poměrové ukazatele (marže, na hodinu, na zakázku, produktivita) jsou srovnatelné vždy; ukazatele „na lakýrníka / karosáře“ jsou přepočtené ${normTxt}; absolutní částky (zisk, obrat, spotřeba celkem) odpovídají každý svému období.</p>` : ""}
        ${units.some(u => u.partial) ? `<p class="f-note kpi-note kpi-warn">⚠️ Některé vybrané období je neúplné – hodnoty odpovídají jen zadané části.</p>` : ""}
        ${st.view === "all" ? allHtml(units, defs, bm, targets) : oneHtml(units, defs, bm, targets)}`}
      </div>`;

    host.querySelectorAll("[data-pid]").forEach(c => c.onchange = () => { st.ids = [...host.querySelectorAll("[data-pid]:checked")].map(x => x.dataset.pid); draw(); });
    host.querySelectorAll("[data-per]").forEach(s => s.onchange = () => { st.periods[s.dataset.per] = s.value; draw(); });
    host.querySelector("#cmpLevel").onchange = e => { st.level = e.target.value; draw(); };
    host.querySelector("#cmpNorm").onchange = e => { st.norm = e.target.value; draw(); };
    host.querySelectorAll("[data-view]").forEach(b => b.onclick = () => { st.view = b.dataset.view; draw(); });
    const k = host.querySelector("#cmpKpi"); if (k) k.onchange = () => { st.kpi = k.value; draw(); };
  };
  draw();
}

// nejlepší / nejhorší v řádku
function marks(d, vals) {
  const xs = vals.filter(v => v != null);
  if (!d.dir || xs.length < 2) return () => "";
  const best = d.dir > 0 ? Math.max(...xs) : Math.min(...xs), worst = d.dir > 0 ? Math.min(...xs) : Math.max(...xs);
  if (best === worst) return () => "";
  return v => v === best ? "best" : v === worst ? "worst" : "";
}

function allHtml(units, defs, bm, targets) {
  let lastG = "";
  const cols = units.length + 3;
  const sameLen = new Set(units.map(u => u.t)).size === 1;
  const rows = defs.map(d => {
    const g = d.g !== lastG ? `<tr class="kpi-sec"><td colspan="${cols}">${esc(d.g)}</td></tr>` : ""; lastG = d.g;
    const vals = units.map(u => u.v[d.k]), m = d.abs && !sameLen ? () => "" : marks(d, vals), t = targetFor(d, targets, st.norm);
    return g + `<tr><th scope="row">${esc(d.l)}${d.per ? `<span class="muted">za ${TYPES[st.norm]}</span>` : ""}</th>
      ${vals.map(v => `<td class="kpi-v ${m(v)}">${fmtKpi(v, d.fmt)}</td>`).join("")}
      <td class="kpi-ref">${d.abs ? "" : bm[d.k] ? fmtKpi(bm[d.k].v, d.fmt) : "—"}</td><td class="kpi-ref">${d.abs ? "" : t != null ? fmtKpi(t, d.fmt) : "—"}</td></tr>`;
  }).join("");
  const charts = KEY_CHARTS.map(k => KPI_BY_KEY[k]).filter(d => defs.includes(d))
    .map(d => barChart(d.l + (d.per ? ` (za ${TYPES[st.norm]})` : ""), units.map(u => ({ label: u.name, v: u.v[d.k] })), d.fmt, bm[d.k]?.v, targetFor(d, targets, st.norm))).join("");
  return `
    <div class="kpi-legend"><span><i class="lg-good"></i> nejlepší hodnota v řádku</span><span><i class="lg-bad"></i> nejhorší hodnota v řádku</span></div>
    <div class="table-wrap kpi-table-wrap"><table class="res-table kpi-out kpi-cmp">
      <thead><tr><th>Ukazatel</th>${units.map(u => `<th>${esc(u.name)}<span class="muted">${esc(u.per)}</span></th>`).join("")}<th>Benchmark</th><th>Vlastní cíl</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <h4 class="kpi-h">Hlavní ukazatele v grafech</h4><div class="kpi-charts">${charts}</div>`;
}

function oneHtml(units, defs, bm, targets) {
  const d = KPI_BY_KEY[st.kpi];
  const t = targetFor(d, targets, st.norm), b = d.abs ? null : bm[d.k]?.v;
  const ranked = units.map(u => ({ ...u, x: u.v[d.k] })).sort((a, c) => a.x == null ? 1 : c.x == null ? -1 : (d.dir < 0 ? a.x - c.x : c.x - a.x));
  let lastG = "";
  const options = defs.map(x => { const g = x.g !== lastG ? `${lastG ? "</optgroup>" : ""}<optgroup label="${esc(x.g)}">` : ""; lastG = x.g; return g + `<option value="${x.k}" ${x.k === st.kpi ? "selected" : ""}>${esc(x.l)}</option>`; }).join("") + "</optgroup>";
  const ref = t ?? b;
  return `
    <div class="kpi-period"><label>Ukazatel<select id="cmpKpi" class="kpi-cmp-kpi">${options}</select></label></div>
    <div class="kpi-charts kpi-charts-one">${barChart(d.l + (d.per ? ` (za ${TYPES[st.norm]})` : ""), ranked.map(u => ({ label: u.name, v: u.x })), d.fmt, b, t)}</div>
    <h4 class="kpi-h">Pořadí${d.dir ? (d.dir > 0 ? " (vyšší = lepší)" : " (nižší = lepší)") : ""}</h4>
    <table class="res-table kpi-out kpi-rank"><thead><tr><th>#</th><th>${st.level === "partner" ? "Partner" : "Pobočka"}</th><th>Období</th><th>Hodnota</th><th>Rozdíl proti ${t != null ? "vlastnímu cíli" : "benchmarku"}</th></tr></thead>
      <tbody>${ranked.map((u, i) => {
        const diff = u.x != null && ref != null ? u.x - ref : null;
        const good = diff == null || !d.dir ? "" : diff * d.dir >= 0 ? "good" : "bad";
        return `<tr><td>${u.x == null ? "" : i + 1}.</td><th scope="row">${esc(u.name)}</th><td class="muted-cell">${esc(u.per)}</td>
          <td class="kpi-v">${fmtKpi(u.x, d.fmt)}</td>
          <td class="kpi-v ${good}">${diff == null ? "—" : (diff > 0 ? "+" : diff < 0 ? "−" : "") + (d.fmt === "pct" ? fmtKpi(Math.abs(diff), "pct").replace(" %", " p. b.") : fmtKpi(Math.abs(diff), d.fmt))}</td></tr>`;
      }).join("")}</tbody></table>`;
}
