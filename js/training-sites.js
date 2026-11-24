// Školení – přehled po pobočkách (Stellantis).
// Jedna pobočka (adresa) = jeden řádek, u ní všechny značky a jména proškolených podle jednotlivých školení.
// Termíny školení se doplní později z prezenčních listů – do té doby „absolvoval, termín bude doplněn“.
import { supabase } from "./supabase.js?v=20261121c";
import { exportPdf, exportXlsx } from "./export.js?v=20261121c";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const czDate = iso => iso ? iso.split("-").reverse().map((x, i) => i < 2 ? String(+x) : x).join(". ") : "";
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const sortName = s => s.name.replace(/^[^\p{L}\d]+/u, ""); // „"K H K" ŽATEC“ řadit pod K
const isDone = r => !!(r?.done_on || r?.recognized || r?.done);

async function loadAll(table, query) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await query(supabase.from(table)).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

export async function loadSites(pid) {
  const [courses, sites, people] = await Promise.all([
    loadAll("training_courses", q => q.select("*").eq("program", pid).order("sort")),
    loadAll("training_sites", q => q.select("*").eq("program", pid).order("name")),
    loadAll("training_people", q => q.select("id,first_name,last_name,site_id,active,note").eq("program", pid)),
  ]);
  const recs = courses.length ? await loadAll("training_records", q => q.select("person_id,course_id,done_on,done,recognized,note").in("course_id", courses.map(c => c.id))) : [];
  const byId = new Map(people.map(p => [p.id, p]));
  const bySite = new Map(sites.map(s => [s.id, s]));
  for (const s of sites) { s.c = {}; for (const c of courses) s.c[c.id] = []; }
  for (const r of recs) {
    const p = byId.get(r.person_id); if (!p || !isDone(r)) continue;
    const s = bySite.get(p.site_id); if (!s || !s.c[r.course_id]) continue;
    s.c[r.course_id].push({ p, r });
  }
  for (const s of sites) {
    for (const k in s.c) s.c[k].sort((a, b) => a.p.last_name.localeCompare(b.p.last_name, "cs"));
    s.full = courses.every(c => s.c[c.id].some(x => x.p.active));
  }
  return { courses, sites };
}

const filters = {};
const defaultFilter = () => ({ q: "", dealer: "", brand: "", course: "", has: "1", full: "" });

export function renderSites(app, program, profile) {
  document.title = `Školení ${program.name} | INTERACTION`;
  app.innerHTML = `
    <section class="brand-page wide-page">
      <a class="back" href="#skoleni">← Zpět na školení</a>
      <div class="brand-head">
        <span class="brand-head-duo">${program.logos.map(l => `<img src="${l.src}" alt="${esc(l.alt)}">`).join("")}</span>
        <div><h2>Školení – ${esc(program.name)}</h2><p>Přehled poboček: kdo absolvoval školení servisního poradce a školení karoserie I. a II. Pobočka s více značkami je v jednom řádku.</p></div>
      </div>
      <div id="trBox"><div class="empty">Načítám…</div></div>
    </section>`;
  window.scrollTo(0, 0);
  const box = document.getElementById("trBox");
  const f = filters[program.id] || (filters[program.id] = defaultFilter());
  let data;

  const brands = () => [...new Set(data.sites.flatMap(s => s.brands))].sort((a, b) => a.localeCompare(b, "cs"));
  const filtered = () => {
    const q = norm(f.q), d = norm(f.dealer);
    return data.sites.filter(s =>
      (!q || Object.values(s.c).some(l => l.some(x => norm(x.p.last_name).includes(q)))) &&
      (!d || norm(s.name).includes(d) || norm(s.city).includes(d) || norm(s.street).includes(d) || s.codes.some(c => norm(c).includes(d))) &&
      (!f.brand || s.brands.includes(f.brand)) &&
      (!f.course || (f.has === "1") === s.c[f.course].some(x => x.p.active)) &&
      (!f.full || (f.full === "ok") === s.full)
    ).sort((a, b) => sortName(a).localeCompare(sortName(b), "cs") || String(a.city).localeCompare(String(b.city), "cs"));
  };

  const personHtml = x => {
    const hit = f.q && norm(x.p.last_name).includes(norm(f.q));
    const when = x.r.done_on ? czDate(x.r.done_on) : x.r.recognized ? "uznáno" : "termín bude doplněn";
    return `<span class="st-person${hit ? " hit" : ""}${x.p.active ? "" : " off"}">${esc(x.p.first_name)} <strong>${esc(x.p.last_name)}</strong><small>${esc(when)}${x.p.active ? "" : " · neaktivní"}</small></span>`;
  };

  const exportTable = list => {
    const head = ["Dealer", "Adresa", "Město", "Značky", ...data.courses.map(c => c.name), "Všechna školení"];
    const who = (s, c) => s.c[c.id].map(x => `${x.p.first_name} ${x.p.last_name}${x.r.done_on ? " (" + czDate(x.r.done_on) + ")" : ""}`).join(", ") || "—";
    const rows = list.map(s => [s.name, s.street || "", s.city || "", s.brands.join(", "), ...data.courses.map(c => who(s, c)), s.full ? "ano" : "ne"]);
    const desc = [f.q && `příjmení „${f.q}“`, f.dealer && `dealer „${f.dealer}“`, f.brand && `značka ${f.brand}`,
      f.course && `${f.has === "1" ? "má" : "nemá"} ${data.courses.find(c => c.id === f.course)?.name}`,
      f.full && (f.full === "ok" ? "všechna školení" : "chybí některé školení")].filter(Boolean).join(", ");
    return { title: `Školení ${program.name} – přehled poboček`, subtitle: `Stav k ${czDate(new Date().toISOString().slice(0, 10))}${desc ? " · filtr: " + desc : ""} · ${list.length} poboček`,
      head, rows, file: `Skoleni_${program.id}` };
  };

  const draw = () => {
    const list = filtered();
    const cnt = c => data.sites.filter(s => s.c[c.id].some(x => x.p.active)).length;
    const focus = document.activeElement?.id, selStart = document.activeElement?.selectionStart;
    box.innerHTML = `
      <div class="kpis">
        <div class="kpi"><span class="kpi-n">${data.sites.length}</span><span class="kpi-l">Poboček<small class="kpi-sub">${data.sites.filter(s => s.full).length} má všechna školení</small></span></div>
        ${data.courses.map(c => `<div class="kpi"><span class="kpi-n">${cnt(c)}</span><span class="kpi-l">${esc(c.name)}<small class="kpi-sub">poboček s proškoleným</small></span></div>`).join("")}
      </div>
      <div class="res-card">
        <div class="res-filters">
          <label class="f-field"><span>Příjmení</span><input type="search" id="tfQ" class="f-input" placeholder="např. Novák" value="${esc(f.q)}"></label>
          <label class="f-field"><span>Dealer</span><input type="search" id="tfDealer" class="f-input" placeholder="název, město nebo kód" value="${esc(f.dealer)}"></label>
          <label class="f-field"><span>Značka</span><select id="tfBrand"><option value="">Všechny</option>${brands().map(b => `<option${f.brand === b ? " selected" : ""}>${esc(b)}</option>`).join("")}</select></label>
          <label class="f-field"><span>Školení</span><select id="tfCourse"><option value="">Všechna školení</option>${data.courses.map(c => `<option value="${c.id}"${f.course === c.id ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
          ${f.course ? `<label class="f-field"><span>Pobočka</span><select id="tfHas">${[["1", "Má proškoleného"], ["0", "Nemá proškoleného"]].map(([v, t]) => `<option value="${v}"${f.has === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>` : ""}
          <label class="f-field"><span>Stav pobočky</span><select id="tfFull">${[["", "Všechny"], ["ok", "Má všechna školení"], ["no", "Chybí některé školení"]].map(([v, t]) => `<option value="${v}"${f.full === v ? " selected" : ""}>${t}</option>`).join("")}</select></label>
        </div>
        <div class="res-toolbar"><span class="f-note tr-count">Zobrazeno ${list.length} z ${data.sites.length} poboček${JSON.stringify(f) !== JSON.stringify(defaultFilter()) ? ` · <button type="button" class="btn-link" id="tfReset">zrušit filtry</button>` : ""}</span>
          <span class="res-exp">${list.length ? `<button type="button" class="btn-exp" data-export="pdf">Export do PDF</button><button type="button" class="btn-exp" data-export="xlsx">Export do Excelu</button>` : ""}</span></div>
        ${list.length ? `
        <div class="table-wrap"><table class="res-table tr-table st-sites">
          <thead><tr><th>Dealer / pobočka</th>${data.courses.map(c => `<th>${esc(c.name)}</th>`).join("")}</tr></thead>
          <tbody>${list.map(s => `<tr>
            <td><strong>${esc(s.name)}</strong><span class="muted">${esc([s.street, s.city].filter(Boolean).join(", "))}</span>
              <span class="st-brands">${s.brands.map(b => `<span class="st-brand">${esc(b)}</span>`).join("")}</span></td>
            ${data.courses.map(c => `<td>${s.c[c.id].length ? s.c[c.id].map(personHtml).join("") : `<span class="tr-miss">chybí</span>`}</td>`).join("")}
          </tr>`).join("")}</tbody></table></div>` : `<div class="empty">Zvoleným filtrům neodpovídá žádná pobočka.</div>`}
      </div>`;

    const bind = (id, key, ev = "change") => { const el = document.getElementById(id); if (el) el.addEventListener(ev, () => { f[key] = el.value; draw(); }); };
    bind("tfQ", "q", "input"); bind("tfDealer", "dealer", "input"); bind("tfBrand", "brand"); bind("tfHas", "has"); bind("tfFull", "full");
    const course = document.getElementById("tfCourse");
    course.onchange = () => { f.course = course.value; if (!f.course) f.has = "1"; draw(); };
    const reset = document.getElementById("tfReset"); if (reset) reset.onclick = () => { Object.assign(f, defaultFilter()); draw(); };
    if (focus && document.getElementById(focus)) { const el = document.getElementById(focus); el.focus(); if (selStart != null && el.setSelectionRange) try { el.setSelectionRange(selStart, selStart); } catch (_) {} }
    box.querySelectorAll("[data-export]").forEach(btn => btn.onclick = () => {
      const t = exportTable(list);
      if (btn.dataset.export === "pdf") exportPdf(t); else exportXlsx(t, t.file + ".xlsx");
    });
  };

  (async () => {
    try { data = await loadSites(program.id); draw(); }
    catch (e) { box.innerHTML = `<div class="empty">Data se nepodařilo načíst: ${esc(e.message)}</div>`; }
  })();
}
