// Školení – import prezenčního listu (.xlsx) – jen admin.
// 1) přečte soubor, rozpozná kurz (z názvu školení) a datum (první den školení),
// 2) každého účastníka spáruje s lidmi v databázi (jméno + dealer / číslo organizace),
// 3) ukáže náhled změn – uloží se až po potvrzení.
import { supabase } from "./supabase.js?v=20261121c";
import { readFirstSheet } from "./xlsx-read.js?v=20261123b";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const czDate = iso => iso ? iso.split("-").reverse().map((x, i) => i < 2 ? String(+x) : x).join(". ") : "";

// Jak poznat kurz z názvu školení (pořadí je důležité – „koloristika 2“ dřív než „koloristika“)
const COURSE_HINTS = {
  "skoda-porsche": [
    ["sp-priprava", ["priprava podkladu", "priprava"]],
    ["sp-efektivni", ["efektivni lakovani", "efektivni"]],
    ["sp-kolor2", ["koloristika 2", "koloristika ii"]],
    ["sp-kolor1", ["koloristika 1", "koloristika i", "koloristika"]],
    ["sp-mikro", ["mikro repair", "micro repair", "mikro", "micro"]],
    ["sp-matne", ["matne lakovani", "matn"]],
  ],
  "mitsubishi-kar": [
    ["mk-kar", ["skoleni karosaru", "karosar"]],
  ],
  "mitsubishi-lak": [
    ["ml-priprava", ["priprava podkladu", "priprava"]],
    ["ml-aplikace", ["aplikacni dovednosti", "aplikacni", "lakovani"]],
    ["ml-kolor1", ["koloristika 1", "koloristika i", "koloristika"]],
  ],
  "mitsubishi-sp": [
    ["ms-sp", ["servisnich poradcu", "servisni poradce", "skoleni techniku", "techniku"]],
  ],
  "hyundai-kar": [
    ["hk-spot", ["spot", "antikorozni", "tmeleni", "cinovani"]],
    ["hk-svar", ["svarovani", "lepeni", "odvrtavani"]],
  ],
  "hyundai-lak": [
    ["hl-priprava", ["priprava podkladu", "priprava"]],
    ["hl-aplikace", ["aplikacni dovednosti", "aplikacni"]],
    ["hl-kolor1", ["koloristika 1", "koloristika i", "koloristika"]],
  ],
};

function detectCourse(program, text) {
  const t = norm(text);
  for (const [id, keys] of COURSE_HINTS[program.id] || []) if (keys.some(k => new RegExp(`(^|[^a-z0-9])${k.replace(/ /g, "\\s+")}($|[^a-z0-9])`).test(t))) return id;
  return "";
}

function detectDate(title, filename) {
  const ok = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` : "";
  // v názvu školení: „… 261119-20 …“ = 19. 11. 2026
  const a = /(?:^|\D)(\d{2})(\d{2})(\d{2})(?:-\d{1,2})?(?:\D|$)/.exec(title || "");
  if (a) { const r = ok(2000 + +a[1], +a[2], +a[3]); if (r) return r; }
  // v názvu souboru nebo školení: „19.-20.11.2026“ nebo „19.11.2026“
  for (const s of [filename, title]) {
    const b = /(\d{1,2})\.\s*(?:-\s*\d{1,2}\.\s*)?(\d{1,2})\.\s*(\d{4})/.exec(s || "");
    if (b) { const r = ok(+b[3], +b[2], +b[1]); if (r) return r; }
  }
  return "";
}

// Najde řádek záhlaví (Název / Číslo uživatele / …) a vrátí účastníky
function parseSheet(rows) {
  const title = rows.find(r => r.some(v => typeof v === "string" && v.trim()))?.find(v => typeof v === "string" && v.trim()) || "";
  let h = -1, col = {};
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const cells = rows[i].map(v => norm(v));
    const name = cells.findIndex(c => c === "nazev" || c === "jmeno" || c === "jmeno a prijmeni" || c === "ucastnik");
    if (name >= 0 && cells.some(c => c.startsWith("cislo uzivatele") || c.includes("organizace"))) {
      h = i;
      col = { name, user: cells.findIndex(c => c.startsWith("cislo uzivatele")), org: cells.findIndex(c => c.startsWith("nazev primarni organizace") || c === "organizace" || c === "dealer"), code: cells.findIndex(c => c.startsWith("kod organizace")) };
      break;
    }
  }
  if (h < 0) throw new Error("nenašel jsem záhlaví tabulky (sloupec „Název“ a „Číslo uživatele“ / „Název primární organizace“)");
  const code = /kod:\s*([^\s]+)/i.exec(norm(rows.slice(0, h).flat().filter(Boolean).join(" ")))?.[1] || "";
  const people = [];
  for (const r of rows.slice(h + 1)) {
    const full = String(r[col.name] ?? "").replace(/\s+/g, " ").trim();
    if (!full) continue;
    const user = String(r[col.user] ?? "").trim(), orgCode = String(r[col.code] ?? "").trim();
    const vw = /^vw$/i.test(user) || /^vw$/i.test(orgCode); // „VW“ = Porsche ČR (má význam jen u programu Škoda / Porsche)
    const org = String(r[col.org] ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
    const parts = full.split(" ");
    people.push({ full, first: parts.slice(0, -1).join(" "), last: parts.at(-1), org, orgCode: vw ? "" : orgCode, vw });
  }
  if (!people.length) throw new Error("v tabulce nejsou žádní účastníci");
  return { title, code, people };
}

// Spárování s lidmi v databázi
function dealerScore(p, x) {
  let s = 0;
  if (x.orgCode && p.dealer_no && norm(p.dealer_no) === norm(x.orgCode)) s += 3;
  const a = new Set(norm(p.dealer).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !["auto", "s.r.o", "sro", "a.s"].includes(w)));
  const b = norm(x.org).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !["auto", "s.r.o", "sro", "a.s"].includes(w));
  s += b.filter(w => a.has(w)).length;
  return s;
}
function matchPerson(x, people) {
  const n = norm(x.full);
  const exact = people.filter(p => norm(p.first_name + " " + p.last_name) === n || norm(p.last_name + " " + p.first_name) === n);
  const similar = people.filter(p => !exact.includes(p) && norm(p.last_name).split(" ")[0] === norm(x.last) && dealerScore(p, x) > 0);
  const rank = list => list.map(p => ({ p, s: dealerScore(p, x) })).sort((a, b) => b.s - a.s);
  const ex = rank(exact);
  let pick = "new";
  if (ex.length) pick = ex[0].p.id; // při více shodách ta s nejlepší shodou dealera – admin může změnit
  return { pick, candidates: [...ex.map(e => e.p), ...rank(similar).map(e => e.p)], ambiguous: ex.length > 1 || (!ex.length && similar.length > 0) };
}

export function importBoxHtml(program) {
  const hasVwNote = program?.brands?.porsche ? " „VW“ místo čísla uživatele = lakýrník Porsche ČR." : "";
  return `
    <div class="import-box">
      <div><strong>Nahrát prezenční list (admin)</strong><span class="muted">Soubor .xlsx s tabulkou účastníků (sloupce Název, Číslo uživatele / Název primární organizace). Kurz a datum (první den školení) se rozpoznají automaticky, před uložením uvidíte náhled.${hasVwNote}</span></div>
      <label class="btn-import">Vybrat prezenční list<input type="file" id="trImportFile" accept=".xlsx" hidden></label>
      <div id="trImportOut" class="import-out"></div>
    </div>`;
}

export function bindImport(program, getData, onSaved) {
  const hasVw = !!program.brands.porsche;
  const input = document.getElementById("trImportFile");
  const out = document.getElementById("trImportOut");
  if (!input) return;
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    out.innerHTML = "Načítám…";
    let parsed;
    try { parsed = parseSheet(await readFirstSheet(file)); }
    catch (e) { out.innerHTML = `<span class="c-exp">Soubor nelze načíst: ${esc(e.message)}</span>`; input.value = ""; return; }
    const { courses, people } = getData();
    const st = {
      course: detectCourse(program, parsed.title) || detectCourse(program, file.name),
      date: detectDate(parsed.title, file.name),
      rows: parsed.people.map(x => ({ x, ...matchPerson(x, people), on: true })),
    };
    const byId = new Map(people.map(p => [p.id, p]));
    const personLabel = p => `${p.last_name} ${p.first_name} – ${p.dealer}${p.dealer_no ? " (" + p.dealer_no + ")" : ""}${p.active ? "" : " – neaktivní"}`;

    const changes = r => {
      if (r.pick === "new") return [`<b>nový účastník</b> – ${esc(r.x.last)} ${esc(r.x.first)}, ${esc(r.x.org)}${hasVw ? ", " + (r.x.vw ? "Porsche ČR" : "Škoda Auto") : ""}`, `zapíše se ${esc(courses.find(c => c.id === st.course)?.name || "kurz")} ${czDate(st.date)}`];
      const p = byId.get(r.pick), list = [];
      if (hasVw && r.x.vw && p.brand !== "porsche") list.push(`značka: ${esc(program.brands[p.brand] || p.brand)} → <b>Porsche ČR</b>`);
      if (!p.active) list.push(`<b>znovu aktivovat</b> (byl neaktivní${p.inactive_note ? ": " + esc(p.inactive_note) : ""})`);
      const prev = p.rec[st.course]?.done_on;
      if (prev && prev === st.date) list.push(`kurz už má zapsaný se stejným datem`);
      else if (prev) list.push(`kurz už má z ${czDate(prev)} – přepíše se na ${czDate(st.date)}`);
      else list.push(`zapíše se ${esc(courses.find(c => c.id === st.course)?.name || "kurz")} ${czDate(st.date)}`);
      return list;
    };

    const draw = () => {
      const cName = courses.find(c => c.id === st.course)?.name;
      const n = st.rows.filter(r => r.on).length;
      out.innerHTML = `
        <div class="tri-head">
          <div class="tri-src"><span class="muted">Školení v souboru:</span> <strong>${esc(parsed.title || file.name)}</strong>${parsed.code ? ` <span class="muted">kód ${esc(parsed.code.toUpperCase())}</span>` : ""}</div>
          <label class="f-field"><span>Zapsat jako kurz</span><select id="triCourse"><option value="">— vyberte kurz —</option>${courses.map(c => `<option value="${c.id}"${c.id === st.course ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
          <label class="f-field"><span>Datum absolvování</span><input type="date" id="triDate" class="f-input" value="${st.date}"></label>
        </div>
        ${!st.course ? `<p class="c-exp">Kurz se nepodařilo rozpoznat – vyberte ho prosím.</p>` : ""}${!st.date ? `<p class="c-exp">Datum se nepodařilo rozpoznat – zadejte ho prosím.</p>` : ""}
        <div class="table-wrap"><table class="res-table small tri-table"><thead><tr><th>Zapsat</th><th>Účastník v listu</th><th>Přiřadit k osobě v seznamu</th><th>Co se změní</th></tr></thead><tbody>
        ${st.rows.map((r, i) => `<tr class="${r.on ? "" : "tri-off"}">
          <td><input type="checkbox" data-on="${i}"${r.on ? " checked" : ""}></td>
          <td><strong>${esc(r.x.full)}</strong><span class="muted">${esc(r.x.org)}${r.x.orgCode ? " (" + esc(r.x.orgCode) + ")" : ""}${hasVw && r.x.vw ? " · <b>VW → Porsche ČR</b>" : ""}</span></td>
          <td><select data-pick="${i}" class="tri-pick">
              ${r.candidates.map(p => `<option value="${p.id}"${r.pick === p.id ? " selected" : ""}>${esc(personLabel(p))}</option>`).join("")}
              <option value="new"${r.pick === "new" ? " selected" : ""}>➕ Nový účastník</option></select>
            ${r.ambiguous ? `<span class="muted c-soon">${r.candidates.length > 1 ? "Více lidí se stejným nebo podobným jménem – zkontrolujte." : "Podobné jméno v seznamu – je to stejný člověk?"}</span>` : ""}</td>
          <td>${changes(r).map(c => `<span class="tri-chg">${c}</span>`).join("")}</td>
        </tr>`).join("")}
        </tbody></table></div>
        <button type="button" class="btn-save" id="triSave"${!st.course || !st.date || !n ? " disabled" : ""}>Uložit ${n} ${n === 1 ? "účastníka" : "účastníků"}${cName ? ` – ${esc(cName)}, ${czDate(st.date)}` : ""}</button>
        <button type="button" class="btn-logout" id="triCancel">Zrušit</button>`;
      document.getElementById("triCourse").onchange = e => { st.course = e.target.value; draw(); };
      document.getElementById("triDate").onchange = e => { st.date = e.target.value; draw(); };
      out.querySelectorAll("[data-on]").forEach(c => c.onchange = () => { st.rows[+c.dataset.on].on = c.checked; draw(); });
      out.querySelectorAll("[data-pick]").forEach(s => s.onchange = () => { st.rows[+s.dataset.pick].pick = s.value; draw(); });
      document.getElementById("triCancel").onclick = () => { out.innerHTML = ""; input.value = ""; };
      document.getElementById("triSave").onclick = save;
    };

    const save = async () => {
      const btn = document.getElementById("triSave"); btn.disabled = true; btn.textContent = "Ukládám…";
      const now = new Date().toISOString(), msgs = [];
      const picks = st.rows.filter(r => r.on && r.pick !== "new").map(r => r.pick);
      if (new Set(picks).size !== picks.length) { alert("Jedna osoba ze seznamu je přiřazená ke dvěma řádkům listu – opravte prosím přiřazení."); draw(); return; }
      for (const r of st.rows.filter(r => r.on)) {
        try {
          let id = r.pick;
          if (id === "new") {
            const { data, error } = await supabase.from("training_people").insert({ program: program.id, first_name: r.x.first, last_name: r.x.last, dealer: r.x.org, dealer_no: r.x.orgCode || null, brand: hasVw && r.x.vw ? "porsche" : program.defaultBrand }).select("id").single();
            if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "osoba se stejným jménem u stejného dealera už v seznamu je – vyberte ji místo „Nový účastník“" : error.message);
            id = data.id;
          } else {
            const p = byId.get(id), patch = {};
            if (hasVw && r.x.vw && p.brand !== "porsche") patch.brand = "porsche";
            if (!p.active) { patch.active = true; patch.inactive_note = null; }
            if (!p.dealer_no && r.x.orgCode) patch.dealer_no = r.x.orgCode;
            if (Object.keys(patch).length) {
              const { error } = await supabase.from("training_people").update({ ...patch, updated_at: now }).eq("id", id);
              if (error) throw error;
            }
          }
          const { error } = await supabase.from("training_records").upsert({ person_id: id, course_id: st.course, done_on: st.date, note: null, updated_at: now }, { onConflict: "person_id,course_id" });
          if (error) throw error;
          msgs.push(`✓ ${esc(r.x.full)}${r.pick === "new" ? " – přidán do seznamu" : ""}`);
        } catch (e) { msgs.push(`<span class="c-exp">✗ ${esc(r.x.full)} – ${esc(e.message)}</span>`); }
      }
      input.value = "";
      await onSaved();
      const o2 = document.getElementById("trImportOut");
      if (o2) o2.innerHTML = `<strong>Prezenční list uložen (${esc(courses.find(c => c.id === st.course)?.name)}, ${czDate(st.date)}):</strong><br>${msgs.join("<br>")}`;
    };
    draw();
  };
}
