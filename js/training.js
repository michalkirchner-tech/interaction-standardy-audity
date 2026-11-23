// Školení – přehled proškolených podle značek (programů školení)
// Každý program (např. Škoda Auto + Porsche ČR) má vlastní sadu kurzů v databázi (tabulka training_courses).
// U kurzu je pro každou značku uvedeno, zda je povinný (P) nebo volitelný (V).
// Kvalifikační cesta je splněná, když má účastník všechny povinné kurzy své značky.
import { supabase } from "./supabase.js?v=20261121c";
import { exportPdf, exportXlsx } from "./export.js?v=20261121c";
import { importBoxHtml, bindImport } from "./training-import.js?v=20261123c";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const czDate = iso => iso ? iso.split("-").reverse().map((x, i) => i < 2 ? String(+x) : x).join(". ") : "";
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Program = jedna sada kurzů. Programy se stejnou „group“ sdílí dlaždici a zobrazí se jako záložky (např. Hyundai: karosáři / lakýrníci).
const HY_LOGO = [{ src: "assets/logos/hyundai.svg", alt: "Hyundai" }];
export const PROGRAMS = [
  {
    id: "skoda-porsche", group: "skoda-porsche", name: "Škoda Auto a Porsche ČR", who: "Lakýrníci",
    logos: [{ src: "assets/logos/skoda.svg", alt: "Škoda Auto" }, { src: "assets/logos/porsche-cr.svg", alt: "Porsche ČR" }],
    brands: { skoda: "Škoda Auto", porsche: "Porsche ČR" }, defaultBrand: "skoda",
  },
  { id: "hyundai-kar", group: "hyundai", name: "Hyundai", who: "Karosáři", logos: HY_LOGO, brands: { hyundai: "Hyundai" }, defaultBrand: "hyundai" },
  { id: "hyundai-lak", group: "hyundai", name: "Hyundai", who: "Lakýrníci", logos: HY_LOGO, brands: { hyundai: "Hyundai" }, defaultBrand: "hyundai" },
];
const groupOf = p => PROGRAMS.filter(x => x.group === p.group);
const isDone = r => !!(r?.done_on || r?.recognized); // splněno = datum nebo „uznáno“

// ---------- načtení dat ----------
async function loadAll(table, query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(supabase.from(table)).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}
async function loadProgram(pid) {
  const [courses, people] = await Promise.all([
    loadAll("training_courses", q => q.select("*").eq("program", pid).order("sort")),
    loadAll("training_people", q => q.select("*").eq("program", pid).order("last_name")),
  ]);
  const ids = new Set(people.map(p => p.id));
  const recs = courses.length ? await loadAll("training_records", q => q.select("person_id,course_id,done_on,note,recognized").in("course_id", courses.map(c => c.id))) : [];
  const byPerson = new Map();
  for (const r of recs) if (ids.has(r.person_id)) { if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, {}); byPerson.get(r.person_id)[r.course_id] = r; }
  for (const p of people) p.rec = byPerson.get(p.id) || {};
  return { courses, people };
}
async function loadDealers(pid) {
  const { data, error } = await supabase.from("training_dealers").select("*").eq("program", pid).order("dealer_no");
  if (error) return []; // přehled dealerů je doplňkový – chyba nesmí zablokovat seznam lidí
  return data;
}

// ---------- výpočet kvalifikace ----------
const ruleOf = (c, brand) => c.rules?.[brand] || null;  // "P" | "V" | null
function evalPerson(p, courses) {
  const req = courses.filter(c => ruleOf(c, p.brand) === "P");
  const missing = req.filter(c => !isDone(p.rec[c.id]));
  const opt = courses.filter(c => ruleOf(c, p.brand) === "V" && isDone(p.rec[c.id]));
  return { ok: !missing.length, missing, opt, doneReq: req.length - missing.length, req: req.length };
}

// ---------- úvodní stránka Školení ----------
export async function renderTrainingHome(app, attachTilt) {
  document.title = "Školení | INTERACTION";
  app.innerHTML = `
    <section class="hero"><h1>Školení</h1><p>Vyberte značku</p></section>
    <section class="grid grid-3">
      ${PROGRAMS.filter(p => groupOf(p)[0] === p).map(p => `
        <a class="tile" href="#skoleni-${p.id}" aria-label="Školení ${esc(p.name)}">
          <span class="tile-logo${p.logos.length > 1 ? " tile-logo-duo" : " wide"}">${p.logos.map(l => `<img src="${l.src}" alt="${esc(l.alt)}">`).join("")}</span>
          <span class="tile-name">${esc(p.name)}</span>
          <span class="tile-stats">${groupOf(p).map(g => `<span class="tr-tstat" data-tstats="${g.id}">${esc(g.who)}: načítám…</span>`).join("")}</span>
        </a>`).join("")}
    </section>`;
  if (attachTilt) app.querySelectorAll(".tile").forEach(attachTilt);
  await Promise.all(PROGRAMS.map(async p => {
    const el = app.querySelector(`[data-tstats="${p.id}"]`);
    try {
      const { courses, people } = await loadProgram(p.id);
      const act = people.filter(x => x.active);
      const ok = act.filter(x => evalPerson(x, courses).ok).length;
      if (el) el.innerHTML = act.length ? `${esc(p.who)}: ${act.length} · <b class="c-ok">${ok} s kvalifikací</b>` : `${esc(p.who)}: zatím bez účastníků`;
    } catch (e) { if (el) el.textContent = `${p.who}: chyba načtení`; }
  }));
}

// ---------- seznam proškolených ----------
const filters = {}; // filtry zůstanou nastavené během práce v aplikaci
const defaultFilter = () => ({ q: "", dealer: "", course: "", has: "1", qual: "", brand: "", state: "active" });

export async function renderTrainingProgram(app, program, profile) {
  const isAdmin = profile?.role === "admin";
  const multi = Object.keys(program.brands).length > 1; // výběr značky jen tam, kde program má víc značek (Škoda / Porsche)
  const tabs = groupOf(program);
  document.title = `Školení ${program.name} – ${program.who} | INTERACTION`;
  app.innerHTML = `
    <section class="brand-page wide-page">
      <a class="back" href="#skoleni">← Zpět na školení</a>
      <div class="brand-head">
        <span class="brand-head-duo">${program.logos.map(l => `<img src="${l.src}" alt="${esc(l.alt)}">`).join("")}</span>
        <div><h2>Školení – ${esc(program.name)}</h2><p>${esc(program.who)}: přehled absolvovaných kurzů a splnění kvalifikační cesty.</p></div>
      </div>
      ${tabs.length > 1 ? `<nav class="tr-tabs">${tabs.map(t => `<a href="#skoleni-${t.id}" class="${t.id === program.id ? "on" : ""}">${esc(t.who)}</a>`).join("")}</nav>` : ""}
      ${isAdmin ? `<div class="tr-import">${importBoxHtml(program)}</div>` : ""}
      <div id="trBox"><div class="empty">Načítám…</div></div>
    </section>`;
  window.scrollTo(0, 0);
  const box = document.getElementById("trBox");
  const f = filters[program.id] || (filters[program.id] = defaultFilter());
  let data;

  const refresh = async () => {
    try { data = await loadProgram(program.id); data.dealers = await loadDealers(program.id); }
    catch (e) { box.innerHTML = `<div class="empty">Data se nepodařilo načíst: ${esc(e.message)}</div>`; return; }
    for (const p of data.people) p.ev = evalPerson(p, data.courses);
    draw();
  };

  const filtered = () => {
    const q = norm(f.q), d = norm(f.dealer);
    return data.people.filter(p =>
      (f.state === "all" || (f.state === "active") === !!p.active) &&
      (!q || norm(p.last_name).includes(q)) &&
      (!d || norm(p.dealer).includes(d) || norm(p.dealer_no).includes(d)) &&
      (!f.brand || p.brand === f.brand) &&
      (!f.qual || (f.qual === "ok") === p.ev.ok) &&
      (!f.course || (f.has === "1") === isDone(p.rec[f.course]))
    ).sort((a, b) => a.last_name.localeCompare(b.last_name, "cs") || a.first_name.localeCompare(b.first_name, "cs"));
  };

  const ruleLabel = c => {
    const parts = Object.entries(program.brands).map(([b, n]) => [n, ruleOf(c, b)]).filter(x => x[1]);
    const same = parts.every(x => x[1] === parts[0][1]);
    const word = r => r === "P" ? "povinný" : "volitelný";
    return same ? word(parts[0][1]) : parts.map(([n, r]) => `${n.replace("Škoda Auto", "ŠA").replace("Porsche ČR", "PoČR")}: ${word(r)}`).join(" · ");
  };

  const cell = (p, c) => {
    const r = p.rec[c.id], rule = ruleOf(c, p.brand);
    if (r?.done_on) return `<td class="tr-c tr-done${rule === "V" ? " tr-opt" : ""}">${czDate(r.done_on)}</td>`;
    if (r?.recognized) return `<td class="tr-c tr-done tr-rec" title="${esc(r.note || "")}">uznáno${r.note ? `<span class="muted">${esc(r.note)}</span>` : ""}</td>`;
    const note = r?.note && r.note !== p.inactive_note ? `<span class="muted">${esc(r.note)}</span>` : "";
    if (!rule) return `<td class="tr-c tr-na">netýká se${note}</td>`;
    return `<td class="tr-c ${rule === "P" ? "tr-miss" : "tr-none"}">${rule === "P" ? "chybí" : "—"}${note}</td>`;
  };

  const exportTable = list => {
    const head = ["Příjmení", "Jméno", "Dealer", "Číslo dealera", ...(multi ? ["Značka"] : []), ...data.courses.map(c => c.name), "Kvalifikační cesta", "Poznámka", "Stav"];
    const rows = list.map(p => [p.last_name, p.first_name, p.dealer, p.dealer_no || "", ...(multi ? [program.brands[p.brand] || p.brand] : []),
      ...data.courses.map(c => { const r = p.rec[c.id]; return r?.done_on ? czDate(r.done_on) : r?.recognized ? "uznáno" : !ruleOf(c, p.brand) ? "netýká se" : ruleOf(c, p.brand) === "P" ? "chybí" : ""; }),
      p.ev.ok ? "splněna" : "chybí: " + p.ev.missing.map(c => c.name).join(", "), p.note || "", p.active ? "aktivní" : "neaktivní" + (p.inactive_note ? ` (${p.inactive_note})` : "")]);
    const desc = [f.q && `příjmení „${f.q}“`, f.dealer && `dealer „${f.dealer}“`, f.brand && program.brands[f.brand],
      f.qual && (f.qual === "ok" ? "kvalifikace splněna" : "kvalifikace nesplněna"),
      f.course && `${f.has === "1" ? "absolvoval" : "neabsolvoval"} ${data.courses.find(c => c.id === f.course)?.name}`,
      f.state === "inactive" ? "jen neaktivní" : f.state === "all" ? "aktivní i neaktivní" : ""].filter(Boolean).join(", ");
    return { title: `Školení ${program.name} – ${program.who.toLowerCase()}`, subtitle: `Stav k ${czDate(new Date().toISOString().slice(0, 10))}${desc ? " · filtr: " + desc : ""} · ${list.length} osob`,
      head, rows, rowClass: list.map(p => p.active ? "" : "st-inactive"), file: `Skoleni_${program.id}` };
  };

  // Dealeři bez vlastních proškolených pracovníků (realizuje jinde, doložené certifikáty, neplní podle HMCZ)
  const ST = { jinde: ["st-ok", "✓ Realizuje u jiného dealera"], dolozeno: ["st-ok", "✓ Doloženy certifikáty"], bez: ["st-expired", "Bez proškolených"] };
  const dealersHtml = () => {
    const d = norm(f.dealer);
    const rows = (data.dealers || []).filter(x => !d || norm(x.dealer).includes(d) || norm(x.dealer_no).includes(d));
    if (!rows.length) return "";
    const names = new Map(); for (const p of data.people) if (p.dealer_no && !names.has(p.dealer_no)) names.set(p.dealer_no, p.dealer);
    for (const x of data.dealers) if (x.dealer_no && !names.has(x.dealer_no)) names.set(x.dealer_no, x.dealer);
    const note = s => esc(s || "").replace(/\b(1\d{4})\b/g, (m) => names.has(m) ? `${m} (${esc(names.get(m))})` : m).replace(/\bHOD\b/, "HOD (Hodonín)");
    const order = x => x.status === "jinde" || x.status === "dolozeno" ? 2 : x.status === "bez" ? 0 : 1;
    rows.sort((a, b) => order(a) - order(b) || String(a.dealer_no).localeCompare(String(b.dealer_no)));
    return `
      <div class="res-card tr-dealers">
        <h3>Dealeři bez vlastních proškolených ${esc({ "Karosáři": "karosářů", "Lakýrníci": "lakýrníků" }[program.who] || "pracovníků")}</h3>
        <p>Dealeři, kteří v seznamu nemají vlastní proškolené pracovníky – realizují opravy u jiného dealera, doložili certifikáty jiného dodavatele, nebo zatím nesplňují.</p>
        <div class="table-wrap"><table class="res-table"><thead><tr><th>Dealer</th><th>Stav</th><th>Poznámka</th></tr></thead><tbody>
        ${rows.map(x => `<tr><td><strong>${esc(x.dealer)}</strong>${x.dealer_no ? `<span class="muted">č. ${esc(x.dealer_no)}</span>` : ""}</td>
          <td>${x.status && ST[x.status] ? `<span class="st-badge ${ST[x.status][0]}">${ST[x.status][1]}</span>` : ""}${x.neplni ? ` <span class="st-badge st-expired">Neplní (podle HMCZ)</span>` : ""}</td>
          <td>${note(x.note)}</td></tr>`).join("")}
        </tbody></table></div>
      </div>`;
  };

  const draw = () => {
    const list = filtered();
    const act = data.people.filter(p => p.active);
    const nOk = act.filter(p => p.ev.ok).length;
    const dealers = [...new Set(data.people.map(p => p.dealer).filter(Boolean))].sort((a, b) => a.localeCompare(b, "cs"));
    const focus = document.activeElement?.id, selStart = document.activeElement?.selectionStart;
    box.innerHTML = `
      <div class="kpis kpis-3">
        <div class="kpi"><span class="kpi-n">${act.length}</span><span class="kpi-l">Aktivních účastníků${data.people.length - act.length ? `<small class="kpi-sub">+ ${data.people.length - act.length} neaktivních</small>` : ""}</span></div>
        <div class="kpi kpi-ok"><span class="kpi-n">${nOk}</span><span class="kpi-l">Kvalifikační cesta splněna</span></div>
        <div class="kpi kpi-expired"><span class="kpi-n">${act.length - nOk}</span><span class="kpi-l">Kvalifikace nesplněna</span></div>
      </div>
      <div class="res-card">
        <div class="res-filters">
          <label class="f-field"><span>Příjmení</span><input type="search" id="tfQ" class="f-input" placeholder="např. Novák" value="${esc(f.q)}"></label>
          <label class="f-field"><span>Dealer</span><input type="search" id="tfDealer" class="f-input" list="tfDealers" placeholder="název nebo číslo dealera" value="${esc(f.dealer)}"></label>
          <datalist id="tfDealers">${dealers.map(d => `<option value="${esc(d)}">`).join("")}</datalist>
          <label class="f-field"><span>Kvalifikační cesta</span><select id="tfQual">
            ${[["", "Všichni"], ["ok", "Splněna"], ["no", "Nesplněna"]].map(([v, t]) => `<option value="${v}"${f.qual === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
          <label class="f-field"><span>Kurz</span><select id="tfCourse">
            <option value="">Všechny kurzy</option>${data.courses.map(c => `<option value="${c.id}"${f.course === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
          ${f.course ? `<label class="f-field"><span>Kurz absolvoval</span><select id="tfHas">
            ${[["1", "Ano – má kurz"], ["0", "Ne – kurz nemá"]].map(([v, t]) => `<option value="${v}"${f.has === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>` : ""}
          ${multi ? `<label class="f-field"><span>Značka</span><select id="tfBrand">
            <option value="">Všechny</option>${Object.entries(program.brands).map(([b, n]) => `<option value="${b}"${f.brand === b ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>` : ""}
          <label class="f-field"><span>Stav</span><select id="tfState">
            ${[["active", "Aktivní"], ["inactive", "Neaktivní"], ["all", "Aktivní i neaktivní"]].map(([v, t]) => `<option value="${v}"${f.state === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        </div>
        <div class="res-toolbar"><span class="f-note tr-count">Zobrazeno ${list.length} z ${data.people.length} osob${JSON.stringify(f) !== JSON.stringify(defaultFilter()) ? ` · <button type="button" class="btn-link" id="tfReset">zrušit filtry</button>` : ""}</span>
          <span class="res-exp">${list.length ? `<button type="button" class="btn-exp" data-export="pdf">Export do PDF</button><button type="button" class="btn-exp" data-export="xlsx">Export do Excelu</button>` : ""}</span></div>
        ${list.length ? `
        <div class="table-wrap"><table class="res-table tr-table">
          <thead><tr><th>Účastník</th><th>Dealer</th><th>Kvalifikační cesta</th>
            ${data.courses.map(c => `<th class="th-lvl" title="${esc([c.code, c.days ? c.days + (c.days == 1 ? " den" : " dny") : ""].filter(Boolean).join(" · "))}">${esc(c.name)}<small>${esc(ruleLabel(c))}</small></th>`).join("")}</tr></thead>
          <tbody>${list.map(p => `
            <tr class="${p.active ? "" : "st-inactive"}">
              <td><strong>${esc(p.last_name)}</strong> ${esc(p.first_name)}
                ${!multi ? "" : isAdmin ? `<label class="tr-brand">Značka: <select data-brand="${p.id}">${Object.entries(program.brands).map(([b, n]) => `<option value="${b}"${p.brand === b ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`
                  : `<span class="muted">${esc(program.brands[p.brand] || p.brand)}</span>`}
                ${p.note ? `<span class="muted tr-pnote">${esc(p.note)}</span>` : ""}
                ${p.active ? "" : `<span class="st-badge st-inactive">Neaktivní</span>${p.inactive_note ? `<span class="muted">${esc(p.inactive_note)}</span>` : ""}`}
                ${isAdmin ? (p.active ? `<button type="button" class="btn-delcust" data-deact="${p.id}">Označit jako neaktivní</button>` : `<button type="button" class="btn-actcust" data-act="${p.id}">Znovu aktivovat</button>`) : ""}</td>
              <td>${esc(p.dealer)}${p.dealer_no ? `<span class="muted">č. ${esc(p.dealer_no)}</span>` : ""}</td>
              <td>${p.ev.ok ? `<span class="st-badge st-ok">✓ Splněna</span>` : `<span class="st-badge st-expired">${p.ev.doneReq} z ${p.ev.req} povinných</span><span class="muted">chybí: ${esc(p.ev.missing.map(c => c.name).join(", "))}</span>`}
                ${p.ev.opt.length ? `<span class="muted">volitelné: ${esc(p.ev.opt.map(c => c.name).join(", "))}</span>` : ""}</td>
              ${data.courses.map(c => cell(p, c)).join("")}
            </tr>`).join("")}</tbody></table></div>` : `<div class="empty">Zvoleným filtrům neodpovídá nikdo.</div>`}
      </div>
      ${dealersHtml()}`;

    const bind = (id, key, ev = "change") => { const el = document.getElementById(id); if (el) el.addEventListener(ev, () => { f[key] = el.value; draw(); }); };
    bind("tfQ", "q", "input"); bind("tfDealer", "dealer", "input"); bind("tfQual", "qual"); bind("tfHas", "has"); bind("tfBrand", "brand"); bind("tfState", "state");
    const course = document.getElementById("tfCourse");
    course.onchange = () => { f.course = course.value; if (!f.course) f.has = "1"; draw(); };
    const reset = document.getElementById("tfReset"); if (reset) reset.onclick = () => { Object.assign(f, defaultFilter()); draw(); };
    if (focus && document.getElementById(focus)) { const el = document.getElementById(focus); el.focus(); if (selStart != null && el.setSelectionRange) try { el.setSelectionRange(selStart, selStart); } catch (_) {} }

    box.querySelectorAll("[data-export]").forEach(btn => btn.onclick = () => {
      const t = exportTable(list);
      if (btn.dataset.export === "pdf") exportPdf(t); else exportXlsx(t, t.file + ".xlsx");
    });

    if (!isAdmin) return;
    box.querySelectorAll("[data-brand]").forEach(sel => sel.onchange = async () => {
      sel.disabled = true;
      const { data: r, error } = await supabase.from("training_people").update({ brand: sel.value, updated_at: new Date().toISOString() }).eq("id", sel.dataset.brand).select("id");
      if (error || !r?.length) { alert("Změna značky se nepodařila" + (error ? ": " + error.message : ".")); }
      refresh();
    });
    box.querySelectorAll("[data-deact]").forEach(btn => btn.onclick = async () => {
      const p = data.people.find(x => x.id === btn.dataset.deact);
      const why = prompt(`Označit ${p.first_name} ${p.last_name} (${p.dealer}) jako neaktivního?\n\nZáznamy o kurzech zůstanou zachované a kdykoli ho můžete znovu aktivovat.\nDůvod (nepovinné, např. „už nepracuje“, „pokračuje jinde“):`, "už nepracuje");
      if (why === null) return;
      await setActive(p.id, false, why.trim() || null);
    });
    box.querySelectorAll("[data-act]").forEach(btn => btn.onclick = async () => {
      const p = data.people.find(x => x.id === btn.dataset.act);
      if (!confirm(`Znovu aktivovat ${p.first_name} ${p.last_name} (${p.dealer})?`)) return;
      await setActive(p.id, true, null);
    });
  };

  const setActive = async (id, active, note) => {
    const { data: r, error } = await supabase.from("training_people").update({ active, inactive_note: note, updated_at: new Date().toISOString() }).eq("id", id).select("id");
    if (error || !r?.length) alert("Změna se nepodařila" + (error ? ": " + error.message : "."));
    refresh();
  };

  if (isAdmin) bindImport(program, () => data, refresh);
  refresh();
}
