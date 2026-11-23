// Školení – přehled proškolených podle značek (programů školení)
// Každý program (např. Škoda Auto + Porsche ČR) má vlastní sadu kurzů v databázi (tabulka training_courses).
// U kurzu je pro každou značku uvedeno, zda je povinný (P) nebo volitelný (V).
// Kvalifikační cesta je splněná, když má účastník všechny povinné kurzy své značky.
import { supabase } from "./supabase.js?v=20261121c";
import { exportPdf, exportXlsx } from "./export.js?v=20261121c";
import { importBoxHtml, bindImport } from "./training-import.js?v=20261123b";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const czDate = iso => iso ? iso.split("-").reverse().map((x, i) => i < 2 ? String(+x) : x).join(". ") : "";
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export const PROGRAMS = [
  {
    id: "skoda-porsche", name: "Škoda Auto a Porsche ČR", who: "Lakýrníci",
    logos: [{ src: "assets/logos/skoda.svg", alt: "Škoda Auto" }, { src: "assets/logos/porsche-cr.svg", alt: "Porsche ČR" }],
    brands: { skoda: "Škoda Auto", porsche: "Porsche ČR" }, defaultBrand: "skoda",
  },
];

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
  const recs = courses.length ? await loadAll("training_records", q => q.select("person_id,course_id,done_on,note").in("course_id", courses.map(c => c.id))) : [];
  const byPerson = new Map();
  for (const r of recs) if (ids.has(r.person_id)) { if (!byPerson.has(r.person_id)) byPerson.set(r.person_id, {}); byPerson.get(r.person_id)[r.course_id] = r; }
  for (const p of people) p.rec = byPerson.get(p.id) || {};
  return { courses, people };
}

// ---------- výpočet kvalifikace ----------
const ruleOf = (c, brand) => c.rules?.[brand] || null;  // "P" | "V" | null
function evalPerson(p, courses) {
  const req = courses.filter(c => ruleOf(c, p.brand) === "P");
  const missing = req.filter(c => !p.rec[c.id]?.done_on);
  const opt = courses.filter(c => ruleOf(c, p.brand) === "V" && p.rec[c.id]?.done_on);
  return { ok: !missing.length, missing, opt, doneReq: req.length - missing.length, req: req.length };
}

// ---------- úvodní stránka Školení ----------
export async function renderTrainingHome(app, attachTilt) {
  document.title = "Školení | INTERACTION";
  app.innerHTML = `
    <section class="hero"><h1>Školení</h1><p>Vyberte značku</p></section>
    <section class="grid grid-3">
      ${PROGRAMS.map(p => `
        <a class="tile" href="#skoleni-${p.id}" aria-label="Školení ${esc(p.name)}">
          <span class="tile-logo tile-logo-duo">${p.logos.map(l => `<img src="${l.src}" alt="${esc(l.alt)}">`).join("")}</span>
          <span class="tile-name">${esc(p.name)}</span>
          <span class="tile-stats" data-tstats="${p.id}">načítám…</span>
        </a>`).join("")}
    </section>`;
  if (attachTilt) app.querySelectorAll(".tile").forEach(attachTilt);
  for (const p of PROGRAMS) {
    const el = app.querySelector(`[data-tstats="${p.id}"]`);
    try {
      const { courses, people } = await loadProgram(p.id);
      const act = people.filter(x => x.active);
      const ok = act.filter(x => evalPerson(x, courses).ok).length;
      if (el) el.innerHTML = act.length ? `${esc(p.who)}: ${act.length} · <b class="c-ok">${ok} s kvalifikací</b>` : "zatím bez účastníků";
    } catch (e) { if (el) el.textContent = "chyba načtení"; }
  }
}

// ---------- seznam proškolených ----------
const filters = {}; // filtry zůstanou nastavené během práce v aplikaci
const defaultFilter = () => ({ q: "", dealer: "", course: "", has: "1", qual: "", brand: "", state: "active" });

export async function renderTrainingProgram(app, program, profile) {
  const isAdmin = profile?.role === "admin";
  document.title = `Školení ${program.name} | INTERACTION`;
  app.innerHTML = `
    <section class="brand-page wide-page">
      <a class="back" href="#skoleni">← Zpět na školení</a>
      <div class="brand-head">
        <span class="brand-head-duo">${program.logos.map(l => `<img src="${l.src}" alt="${esc(l.alt)}">`).join("")}</span>
        <div><h2>Školení – ${esc(program.name)}</h2><p>${esc(program.who)}: přehled absolvovaných kurzů a splnění kvalifikační cesty.</p></div>
      </div>
      ${isAdmin ? `<div class="tr-import">${importBoxHtml()}</div>` : ""}
      <div id="trBox"><div class="empty">Načítám…</div></div>
    </section>`;
  window.scrollTo(0, 0);
  const box = document.getElementById("trBox");
  const f = filters[program.id] || (filters[program.id] = defaultFilter());
  let data;

  const refresh = async () => {
    try { data = await loadProgram(program.id); }
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
      (!f.course || (f.has === "1") === !!p.rec[f.course]?.done_on)
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
    const note = r?.note && r.note !== p.inactive_note ? `<span class="muted">${esc(r.note)}</span>` : "";
    if (!rule) return `<td class="tr-c tr-na">netýká se${note}</td>`;
    return `<td class="tr-c ${rule === "P" ? "tr-miss" : "tr-none"}">${rule === "P" ? "chybí" : "—"}${note}</td>`;
  };

  const exportTable = list => {
    const head = ["Příjmení", "Jméno", "Dealer", "Číslo dealera", "Značka", ...data.courses.map(c => c.name), "Kvalifikační cesta", "Stav"];
    const rows = list.map(p => [p.last_name, p.first_name, p.dealer, p.dealer_no || "", program.brands[p.brand] || p.brand,
      ...data.courses.map(c => { const r = p.rec[c.id]; return r?.done_on ? czDate(r.done_on) : !ruleOf(c, p.brand) ? "netýká se" : ruleOf(c, p.brand) === "P" ? "chybí" : ""; }),
      p.ev.ok ? "splněna" : "chybí: " + p.ev.missing.map(c => c.name).join(", "), p.active ? "aktivní" : "neaktivní" + (p.inactive_note ? ` (${p.inactive_note})` : "")]);
    const desc = [f.q && `příjmení „${f.q}“`, f.dealer && `dealer „${f.dealer}“`, f.brand && program.brands[f.brand],
      f.qual && (f.qual === "ok" ? "kvalifikace splněna" : "kvalifikace nesplněna"),
      f.course && `${f.has === "1" ? "absolvoval" : "neabsolvoval"} ${data.courses.find(c => c.id === f.course)?.name}`,
      f.state === "inactive" ? "jen neaktivní" : f.state === "all" ? "aktivní i neaktivní" : ""].filter(Boolean).join(", ");
    return { title: `Školení ${program.name} – ${program.who.toLowerCase()}`, subtitle: `Stav k ${czDate(new Date().toISOString().slice(0, 10))}${desc ? " · filtr: " + desc : ""} · ${list.length} osob`,
      head, rows, rowClass: list.map(p => p.active ? "" : "st-inactive"), file: `Skoleni_${program.id}` };
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
          <label class="f-field"><span>Značka</span><select id="tfBrand">
            <option value="">Všechny</option>${Object.entries(program.brands).map(([b, n]) => `<option value="${b}"${f.brand === b ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>
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
                ${isAdmin ? `<label class="tr-brand">Značka: <select data-brand="${p.id}">${Object.entries(program.brands).map(([b, n]) => `<option value="${b}"${p.brand === b ? " selected" : ""}>${esc(n)}</option>`).join("")}</select></label>`
                  : `<span class="muted">${esc(program.brands[p.brand] || p.brand)}</span>`}
                ${p.active ? "" : `<span class="st-badge st-inactive">Neaktivní</span>${p.inactive_note ? `<span class="muted">${esc(p.inactive_note)}</span>` : ""}`}
                ${isAdmin ? (p.active ? `<button type="button" class="btn-delcust" data-deact="${p.id}">Označit jako neaktivní</button>` : `<button type="button" class="btn-actcust" data-act="${p.id}">Znovu aktivovat</button>`) : ""}</td>
              <td>${esc(p.dealer)}${p.dealer_no ? `<span class="muted">č. ${esc(p.dealer_no)}</span>` : ""}</td>
              <td>${p.ev.ok ? `<span class="st-badge st-ok">✓ Splněna</span>` : `<span class="st-badge st-expired">${p.ev.doneReq} z ${p.ev.req} povinných</span><span class="muted">chybí: ${esc(p.ev.missing.map(c => c.name).join(", "))}</span>`}
                ${p.ev.opt.length ? `<span class="muted">volitelné: ${esc(p.ev.opt.map(c => c.name).join(", "))}</span>` : ""}</td>
              ${data.courses.map(c => cell(p, c)).join("")}
            </tr>`).join("")}</tbody></table></div>` : `<div class="empty">Zvoleným filtrům neodpovídá nikdo.</div>`}
      </div>`;

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
