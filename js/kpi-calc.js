// Výpočty KPI – čisté funkce bez napojení na databázi a stránku

export const monthsOf = (t, n) => t === "M" ? [n, n] : t === "Q" ? [n * 3 - 2, n * 3] : t === "H" ? [n * 6 - 5, n * 6] : [1, 12];
export const monthCount = t => t === "M" ? 1 : t === "Q" ? 3 : t === "H" ? 6 : 12;
const CHILD = { Y: ["H", 2], H: ["Q", 2], Q: ["M", 3] };
const MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
export const periodName = (t, n) => t === "M" ? MONTHS[n - 1] : t === "Q" ? `${n}. kvartál` : t === "H" ? `${n}. pololetí` : "celý rok";

// Vstupy, které jsou stavem (počet lidí) – za delší období se průměrují, ostatní se sčítají
const AVG = new Set(["lak_zam", "kar_zam"]);

// Sloučení dat několika období (děti) do jednoho
function combine(parts) {
  const out = { b: {}, p: {} };
  for (const sec of ["b", "p"]) {
    const ids = new Set(parts.flatMap(d => Object.keys(d[sec] || {})));
    for (const id of ids) {
      const keys = new Set(parts.flatMap(d => Object.keys(d[sec]?.[id] || {})));
      const o = {};
      for (const k of keys) {
        const vals = parts.map(d => d[sec]?.[id]?.[k]);
        if (vals.some(v => v == null)) { o[k] = null; continue; } // chybí v některé části → nelze spočítat celek
        o[k] = AVG.has(k) && sec === "b" ? vals.reduce((a, b) => a + b, 0) / vals.length : vals.reduce((a, b) => a + b, 0);
      }
      out[sec][id] = o;
    }
  }
  // jmenovité hodiny: sečíst podle jména (jen když jsou jmenovitě ve všech částech)
  const ids = new Set(parts.flatMap(d => Object.keys(d.h || {})));
  for (const id of ids) for (const dk of ["lak", "kar"]) {
    if (!parts.every(d => d.h?.[id]?.[dk]?.length)) continue;
    const m = new Map();
    for (const d of parts) for (const r of d.h[id][dk]) {
      const k = r.n.trim().toLowerCase(), x = m.get(k) || { n: r.n.trim(), o: null, p: null };
      if (r.o != null) x.o = (x.o || 0) + r.o; if (r.p != null) x.p = (x.p || 0) + r.p;
      m.set(k, x);
    }
    ((out.h ||= {})[id] ||= {})[dk] = [...m.values()];
  }
  return out;
}

// Data za období: přímo zadané, nebo složené z kratších období.
// Vrací { data, parts: [popisy použitých období], missing: [chybějící části] } nebo null, když nic není.
export function periodData(entries, year, type, no) {
  const exact = entries.find(e => e.year === year && e.period_type === type && e.period_no === no);
  if (exact) return { data: exact.data, parts: [periodName(type, no)], missing: [], exact: true };
  if (!CHILD[type]) return null;
  const [ct, cnt] = CHILD[type];
  const first = type === "Y" ? 1 : (no - 1) * cnt + 1;
  const subs = [], parts = [], missing = [];
  for (let i = 0; i < cnt; i++) {
    const r = periodData(entries, year, ct, first + i);
    if (r) { subs.push(r.data); parts.push(...r.parts); missing.push(...r.missing); }
    else missing.push(periodName(ct, first + i));
  }
  if (!subs.length) return null;
  if (missing.length) return { data: subs.length ? combine(subs) : null, parts, missing, partial: true };
  return { data: combine(subs), parts, missing, exact: false };
}

// ---------- Definice ukazatelů ----------
// dir: 1 = čím víc, tím líp; -1 = čím míň, tím líp; 0 = bez hodnocení
// per: true = hodnota závisí na délce období (benchmark se přepočítává na stejnou délku)
// fmt: kc | pct | num | x (násobek) | l (litry)
const div = (a, b) => a == null || b == null || !b ? null : a / b;
const sub = (a, b) => a == null || b == null ? null : a - b;
export const KPIS = [
  { g: "Zisk a marže lakýrnického materiálu", k: "zisk", l: "Zisk (obrat − spotřeba)", fmt: "kc", dir: 1, abs: true, f: v => sub(v.obrat, v.spotreba) },
  { g: "Zisk a marže lakýrnického materiálu", k: "marze", l: "Marže (obrat vs. spotřeba)", fmt: "pct", dir: 1, f: v => div(sub(v.obrat, v.spotreba), v.obrat) },
  { g: "Zisk a marže lakýrnického materiálu", k: "navyseni", l: "Navýšení (obrat / spotřeba)", fmt: "x", dir: 1, f: v => div(v.obrat, v.spotreba) },
  { g: "Zisk a marže lakýrnického materiálu", k: "zisk_n", l: "Zisk (obrat − nákup)", fmt: "kc", dir: 1, abs: true, f: v => sub(v.obrat, v.nakup) },
  { g: "Zisk a marže lakýrnického materiálu", k: "marze_n", l: "Marže (obrat vs. nákup)", fmt: "pct", dir: 1, f: v => div(sub(v.obrat, v.nakup), v.obrat) },
  { g: "Zisk a marže lakýrnického materiálu", k: "navyseni_n", l: "Navýšení (obrat / nákup)", fmt: "x", dir: 1, f: v => div(v.obrat, v.nakup) },
  { g: "Materiál celkem", k: "nakup", l: "Nákup", fmt: "kc", dir: 0, abs: true, f: v => v.nakup },
  { g: "Materiál celkem", k: "spotreba", l: "Spotřeba", fmt: "kc", dir: 0, abs: true, f: v => v.spotreba },
  { g: "Materiál celkem", k: "obrat", l: "Obrat (fakturace)", fmt: "kc", dir: 1, abs: true, f: v => v.obrat },
  { g: "Materiál celkem", k: "hodnota_mj", l: "Průměrná hodnota MJ", fmt: "kc", dir: 1, f: v => div(v.obrat, v.mj) },
  { g: "Na jednoho lakýrníka", k: "nakup_lak", l: "Nákup na lakýrníka", fmt: "kc", dir: 0, per: true, f: v => div(v.nakup, v.lak_zam) },
  { g: "Na jednoho lakýrníka", k: "spotreba_lak", l: "Spotřeba na lakýrníka", fmt: "kc", dir: 0, per: true, f: v => div(v.spotreba, v.lak_zam) },
  { g: "Na jednoho lakýrníka", k: "obrat_lak", l: "Obrat na lakýrníka", fmt: "kc", dir: 1, per: true, f: v => div(v.obrat, v.lak_zam) },
  { g: "Na jednoho lakýrníka", k: "zak_lak", l: "Zakázky lakovny na lakýrníka", fmt: "num", dir: 1, per: true, f: v => div(v.lak_zak, v.lak_zam) },
  { g: "Na prodanou (fakturovanou) hodinu", k: "nakup_hod", l: "Nákup na prodanou hodinu", fmt: "kc", dir: 0, f: v => div(v.nakup, v.lak_prod) },
  { g: "Na prodanou (fakturovanou) hodinu", k: "spotreba_hod", l: "Spotřeba na prodanou hodinu", fmt: "kc", dir: -1, f: v => div(v.spotreba, v.lak_prod) },
  { g: "Na prodanou (fakturovanou) hodinu", k: "obrat_hod", l: "Obrat na prodanou hodinu", fmt: "kc", dir: 1, f: v => div(v.obrat, v.lak_prod) },
  { g: "Na jednu zakázku", k: "nakup_zak", l: "Nákup na zakázku", fmt: "kc", dir: 0, f: v => div(v.nakup, v.lak_zak) },
  { g: "Na jednu zakázku", k: "spotreba_zak", l: "Spotřeba na zakázku", fmt: "kc", dir: -1, f: v => div(v.spotreba, v.lak_zak) },
  { g: "Na jednu zakázku", k: "obrat_zak", l: "Obrat na zakázku", fmt: "kc", dir: 1, f: v => div(v.obrat, v.lak_zak) },
  { g: "Výkon lakovny", k: "produktivita", l: "Produktivita lakovny (prodané / odchozené hod.)", fmt: "pct", dir: 1, f: v => div(v.lak_prod, v.lak_odch) },
  { g: "Výkon lakovny", k: "zak_lak_celkem", l: "Počet zakázek lakovna", fmt: "num", dir: 1, abs: true, f: v => v.lak_zak },
  { g: "Karosárna", k: "produktivita_kar", l: "Produktivita karosárny (prodané / odchozené hod.)", fmt: "pct", dir: 1, kar: true, f: v => div(v.kar_prod, v.kar_odch) },
  { g: "Karosárna", k: "zak_kar_celkem", l: "Počet zakázek karosárna", fmt: "num", dir: 1, kar: true, abs: true, f: v => v.kar_zak },
  { g: "Karosárna", k: "zak_kar", l: "Zakázky karosárny na karosáře", fmt: "num", dir: 1, kar: true, per: true, f: v => div(v.kar_zak, v.kar_zam) },
];
export const PAINT_KPIS = [
  { k: "plnic_mj", l: "Plnič na 1 MJ", fmt: "l", dir: -1, f: v => div(v.plnic, v.mj) },
  { k: "barva_mj", l: "Podkladová barva na 1 MJ", fmt: "l", dir: -1, f: v => div(v.barva, v.mj) },
  { k: "lak_mj", l: "Vrchní lak na 1 MJ", fmt: "l", dir: -1, f: v => div(v.lak, v.mj) },
  { k: "barva_podil", l: "Poměr barva / (barva + lak)", fmt: "pct", dir: 0, f: v => div(v.barva, v.barva == null || v.lak == null ? null : v.barva + v.lak) },
];
export const KPI_BY_KEY = Object.fromEntries([...KPIS, ...PAINT_KPIS].map(k => [k.k, k]));

// Součet vstupů za pobočky (celek partnera); počty lidí se sčítají přes pobočky
export function sumBranches(list) {
  const keys = new Set(list.flatMap(o => Object.keys(o || {})));
  const out = {};
  for (const k of keys) {
    const vals = list.map(o => o?.[k]).filter(v => v !== undefined);
    out[k] = vals.some(v => v == null) || !vals.length ? null : vals.reduce((a, b) => a + b, 0);
  }
  return out;
}

export function kpiValues(v, defs = KPIS) {
  const o = {};
  for (const d of defs) { const r = d.f(v || {}); o[d.k] = r == null || !isFinite(r) ? null : r; }
  return o;
}

// ---------- Benchmark ze všech uložených dat ----------
// Z každého partnera se vezmou zadaná období tak, aby se měsíce nepřekrývaly (přednost má delší období).
// Pro každou pobočku se spočítá KPI ze součtu všech jejích dat; benchmark = průměr poboček.
// Ukazatele závislé na délce období se přepočtou na měsíc a pak na délku zvoleného období.
export function nonOverlapping(entries) {
  const sorted = [...entries].sort((a, b) => monthCount(b.period_type) - monthCount(a.period_type));
  const taken = [], used = {};
  for (const e of sorted) {
    const [a, z] = monthsOf(e.period_type, e.period_no);
    const u = used[e.year] ||= new Set();
    let free = true;
    for (let m = a; m <= z; m++) if (u.has(m)) { free = false; break; }
    if (!free) continue;
    for (let m = a; m <= z; m++) u.add(m);
    taken.push(e);
  }
  return taken;
}

export function benchmark(allEntries, branchesByPartner, selType) {
  const perBranch = []; // { label, vals }
  const byPartner = {};
  for (const e of allEntries) (byPartner[e.partner_id] ||= []).push(e);
  for (const [pid, list] of Object.entries(byPartner)) {
    const brs = branchesByPartner[pid] || [];
    const use = nonOverlapping(list);
    for (const br of brs) {
      const rows = use.map(e => ({ v: e.data?.b?.[br.id], mc: monthCount(e.period_type) })).filter(r => r.v);
      if (!rows.length) continue;
      const vals = {};
      for (const d of KPIS) {
        if (d.abs) continue;
        const inputs = inputsOf(d);
        // jen období, kde jsou zadané všechny vstupy ukazatele
        const ok = rows.filter(r => inputs.every(k => r.v[k] != null));
        if (!ok.length) continue;
        const m = ok.reduce((a, r) => a + r.mc, 0);
        const sum = {};
        for (const k of inputs) sum[k] = AVG.has(k)
          ? ok.reduce((a, r) => a + r.v[k] * r.mc, 0) / m   // průměrný stav lidí
          : ok.reduce((a, r) => a + r.v[k], 0);
        let r = d.f(sum);
        if (r != null && d.per) r = r / m * monthCount(selType);
        if (r != null && isFinite(r)) vals[d.k] = r;
      }
      perBranch.push({ partner: pid, branch: br.name, vals });
    }
  }
  const out = {};
  for (const d of KPIS) {
    const xs = perBranch.map(p => p.vals[d.k]).filter(v => v != null);
    if (xs.length) out[d.k] = { v: xs.reduce((a, b) => a + b, 0) / xs.length, n: xs.length };
  }
  return out;
}

// které vstupy ukazatel používá (zjistí se zkusmo)
const inputCache = {};
export function inputsOf(d) {
  if (inputCache[d.k]) return inputCache[d.k];
  const used = new Set();
  const proxy = new Proxy({}, { get: (_, k) => { used.add(k); return 1; } });
  d.f(proxy);
  return inputCache[d.k] = [...used];
}

// Vlastní cíl: u ukazatelů závislých na délce období je zadaný za rok
export const targetFor = (d, targets, selType) => {
  const t = targets[d.k];
  if (t == null) return null;
  return d.per ? t / 12 * monthCount(selType) : t;
};

// Hodnocení proti cíli: 1 lepší, -1 horší, 0 bez hodnocení
export function rate(d, v, ref) {
  if (v == null || ref == null || !d.dir) return 0;
  if (Math.abs(v - ref) < Math.abs(ref) * 0.005) return 0;
  return (v > ref ? 1 : -1) * d.dir;
}

export function fmtKpi(v, fmt) {
  if (v == null || !isFinite(v)) return "—";
  if (fmt === "pct") return (v * 100).toLocaleString("cs-CZ", { maximumFractionDigits: 1 }) + " %";
  if (fmt === "x") return v.toLocaleString("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "×";
  if (fmt === "kc") return Math.round(v).toLocaleString("cs-CZ") + " Kč";
  if (fmt === "l") return v.toLocaleString("cs-CZ", { maximumFractionDigits: 3 }) + " l";
  return v.toLocaleString("cs-CZ", { maximumFractionDigits: 1 });
}
