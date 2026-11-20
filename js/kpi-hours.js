// KPI – odchozené a prodané hodiny: za celé středisko, nebo jmenovitě (řádky se jmény, součet se dopočítá)
// Zobrazení: jedna tabulka na oddělení – řádek = pobočka, při volbě „jmenovitě“ se pod ní rozbalí řádky se jmény.
import { DEPTS } from "./kpi-defs.js?v=20261120s";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtNum = v => v == null || v === "" || isNaN(v) ? "" : Number(v).toLocaleString("cs-CZ", { maximumFractionDigits: 4 });
export const parseNum = s => { const t = String(s ?? "").replace(/\s| /g, "").replace(",", "."); if (t === "") return null; const n = Number(t); return isNaN(n) || n < 0 ? NaN : n; };

const personRow = (r = {}) => `<tr class="hr-row">
  <td class="hr-ind"><input class="hr-name" maxlength="80" value="${esc(r.n || "")}" placeholder="Jméno a příjmení"></td>
  <td><button type="button" class="btn-del hr-rm" title="Odebrat řádek">✕ odebrat</button></td>
  <td><input class="kpi-num hr-o" inputmode="decimal" value="${esc(fmtNum(r.o))}"></td>
  <td><input class="kpi-num hr-p" inputmode="decimal" value="${esc(fmtNum(r.p))}"></td></tr>`;

// branches: [{id, name, painters?:[{name}]}], depts: ["lak","kar"], data: {b, h}
export function hoursHtml(branches, depts, data = {}) {
  return depts.map(dk => {
    const d = DEPTS[dk];
    return `<div class="hr-dept" data-dept="${dk}">
      <h4 class="kpi-h">Odchozené a prodané hodiny – ${d.label}</h4>
      <p class="f-note">U každé pobočky zvolte, zda hodiny zadáte souhrnně za celé středisko, nebo jmenovitě po zaměstnancích – součet se spočítá automaticky.</p>
      <div class="table-wrap kpi-table-wrap"><table class="res-table hr-tab">
        <colgroup><col class="hr-c1"><col class="hr-c2"><col class="hr-c3"><col class="hr-c3"></colgroup>
        <thead><tr><th>Pobočka</th><th>Způsob zadání</th><th>Odchozené hodiny</th><th>Prodané (fakturované) hodiny</th></tr></thead>
        ${branches.map(b => {
          const named = data.h?.[b.id]?.[dk];
          const mode = named?.length ? "named" : "center";
          const bv = data.b?.[b.id] || {};
          return `<tbody class="hr-card" data-hb="${b.id}" data-mode="${mode}" data-name="${esc(b.name)}" data-sugg="${esc(JSON.stringify(dk === "lak" ? (b.painters || []).map(x => x.name) : []))}">
            <tr class="hr-branch">
              <th scope="row">${esc(b.name)}</th>
              <td><span class="hr-switch"><label><input type="radio" name="hm-${dk}-${b.id}" value="center" ${mode === "center" ? "checked" : ""}> za středisko</label><label><input type="radio" name="hm-${dk}-${b.id}" value="named" ${mode === "named" ? "checked" : ""}> jmenovitě</label></span></td>
              <td><input class="kpi-num hr-co" inputmode="decimal" value="${esc(fmtNum(bv[d.o]))}"><span class="hr-so"></span></td>
              <td><input class="kpi-num hr-cp" inputmode="decimal" value="${esc(fmtNum(bv[d.p]))}"><span class="hr-sp"></span></td>
            </tr>
            ${(named || []).map(personRow).join("")}
            <tr class="hr-addrow"><td colspan="4"><button type="button" class="btn-logout hr-add">+ Přidat zaměstnance</button></td></tr>
          </tbody>`;
        }).join("")}
      </table></div></div>`;
  }).join("");
}

export function bindHours(root, onChange = () => {}) {
  const recalc = card => {
    const sum = cls => { const xs = [...card.querySelectorAll(cls)].map(i => parseNum(i.value)).filter(v => v != null && !isNaN(v)); return xs.length ? xs.reduce((a, b) => a + b, 0) : null; };
    card.querySelector(".hr-so").textContent = "Součet: " + (fmtNum(sum(".hr-o")) || "0");
    card.querySelector(".hr-sp").textContent = "Součet: " + (fmtNum(sum(".hr-p")) || "0");
  };
  const bindNum = (i, card) => {
    i.oninput = () => { i.classList.toggle("kpi-bad", isNaN(parseNum(i.value))); if (card) recalc(card); onChange(); };
    i.onblur = () => { const v = parseNum(i.value); if (v != null && !isNaN(v)) i.value = fmtNum(v); };
  };
  const bindRow = (card, tr) => {
    tr.querySelectorAll(".kpi-num").forEach(i => bindNum(i, card));
    tr.querySelector(".hr-name").oninput = onChange;
    tr.querySelector(".hr-rm").onclick = () => { tr.remove(); recalc(card); onChange(); };
  };
  root.querySelectorAll(".hr-card").forEach(card => {
    const addRow = card.querySelector(".hr-addrow");
    card.querySelectorAll(".hr-row").forEach(tr => bindRow(card, tr));
    card.querySelectorAll(".hr-co, .hr-cp").forEach(i => bindNum(i));
    const addRows = list => { list.forEach(r => { addRow.insertAdjacentHTML("beforebegin", personRow(r)); bindRow(card, addRow.previousElementSibling); }); recalc(card); };
    card.querySelector(".hr-add").onclick = () => { addRows([{}]); addRow.previousElementSibling.querySelector(".hr-name").focus(); onChange(); };
    card.querySelectorAll("input[type=radio]").forEach(r => r.onchange = () => {
      card.dataset.mode = r.value;
      if (r.value === "named" && !card.querySelector(".hr-row")) {
        const sugg = JSON.parse(card.dataset.sugg || "[]");
        addRows(sugg.length ? sugg.map(n => ({ n })) : [{}, {}, {}]);
      }
      onChange();
    });
    recalc(card);
  });
}

// Vrátí { b: {branchId: {lak_odch, lak_prod, ...}}, h: {branchId: {lak:[{n,o,p}]}}, errors: [] }
export function collectHours(root) {
  const out = { b: {}, h: {}, errors: [] };
  root.querySelectorAll(".hr-dept").forEach(dep => {
    const dk = dep.dataset.dept, d = DEPTS[dk];
    dep.querySelectorAll(".hr-card").forEach(card => {
      const id = card.dataset.hb, name = card.dataset.name;
      const set = (k, v) => { if (v != null) (out.b[id] ||= {})[k] = v; };
      if (card.dataset.mode === "center") {
        const o = parseNum(card.querySelector(".hr-co").value), p = parseNum(card.querySelector(".hr-cp").value);
        if (isNaN(o) || isNaN(p)) out.errors.push(`${d.label} – ${name}: neplatné číslo v hodinách`);
        set(d.o, isNaN(o) ? null : o); set(d.p, isNaN(p) ? null : p);
        return;
      }
      const rows = [];
      card.querySelectorAll(".hr-row").forEach(tr => {
        const n = tr.querySelector(".hr-name").value.trim(), o = parseNum(tr.querySelector(".hr-o").value), p = parseNum(tr.querySelector(".hr-p").value);
        if (o == null && p == null) return;               // řádek bez hodin (i se jménem) se neukládá
        if (isNaN(o) || isNaN(p)) { out.errors.push(`${d.label} – ${name}${n ? ", " + n : ""}: neplatné číslo v hodinách`); return; }
        if (!n) { out.errors.push(`${d.label} – ${name}: u řádku s hodinami chybí jméno`); return; }
        rows.push({ n, o, p });
      });
      if (!rows.length) return;
      (out.h[id] ||= {})[dk] = rows;
      const sum = k => { const xs = rows.map(r => r[k]).filter(v => v != null); return xs.length ? xs.reduce((a, b) => a + b, 0) : null; };
      set(d.o, sum("o")); set(d.p, sum("p"));
    });
  });
  return out;
}
