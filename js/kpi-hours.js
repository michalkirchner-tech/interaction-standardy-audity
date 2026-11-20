// KPI – odchozené a prodané hodiny: za celé středisko, nebo jmenovitě (řádky se jmény, součet se dopočítá)
import { DEPTS } from "./kpi-defs.js?v=20261120p";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtNum = v => v == null || v === "" || isNaN(v) ? "" : Number(v).toLocaleString("cs-CZ", { maximumFractionDigits: 4 });
export const parseNum = s => { const t = String(s ?? "").replace(/\s| /g, "").replace(",", "."); if (t === "") return null; const n = Number(t); return isNaN(n) || n < 0 ? NaN : n; };

const row = (r = {}) => `<tr class="hr-row">
  <td><input class="hr-name" maxlength="80" value="${esc(r.n || "")}" placeholder="Jméno a příjmení"></td>
  <td><input class="kpi-num hr-o" inputmode="decimal" value="${esc(fmtNum(r.o))}"></td>
  <td><input class="kpi-num hr-p" inputmode="decimal" value="${esc(fmtNum(r.p))}"></td>
  <td><button type="button" class="btn-del hr-rm" title="Odebrat řádek">✕</button></td></tr>`;

// branches: [{id, name, painters?:[{name}]}], depts: ["lak","kar"], data: {b, h}
export function hoursHtml(branches, depts, data = {}) {
  return depts.map(dk => {
    const d = DEPTS[dk];
    return `<div class="hr-dept" data-dept="${dk}">
      <h4 class="kpi-h">Odchozené a prodané hodiny – ${d.label}</h4>
      <p class="f-note">U každé pobočky zvolte, zda hodiny zadáte souhrnně za celé středisko, nebo jmenovitě po zaměstnancích (součet se spočítá automaticky).</p>
      <div class="hr-grid">${branches.map(b => {
        const named = data.h?.[b.id]?.[dk];
        const mode = named?.length ? "named" : "center";
        const bv = data.b?.[b.id] || {};
        return `<div class="hr-card" data-hb="${b.id}" data-mode="${mode}" data-sugg="${esc(JSON.stringify(dk === "lak" ? (b.painters || []).map(x => x.name) : []))}">
          <div class="hr-head"><strong>${esc(b.name)}</strong>
            <span class="hr-switch"><label><input type="radio" name="hm-${dk}-${b.id}" value="center" ${mode === "center" ? "checked" : ""}> za celé středisko</label>
            <label><input type="radio" name="hm-${dk}-${b.id}" value="named" ${mode === "named" ? "checked" : ""}> jmenovitě</label></span></div>
          <div class="hr-center">
            <label>Odchozené hodiny<input class="kpi-num hr-co" inputmode="decimal" value="${esc(fmtNum(bv[d.o]))}"></label>
            <label>Prodané (fakturované) hodiny<input class="kpi-num hr-cp" inputmode="decimal" value="${esc(fmtNum(bv[d.p]))}"></label>
          </div>
          <div class="hr-named">
            <table class="res-table hr-table"><thead><tr><th>${d.who}</th><th>Odchozené hod.</th><th>Prodané hod.</th><th></th></tr></thead>
              <tbody>${(named || []).map(row).join("")}</tbody>
              <tfoot><tr><th>Součet</th><td class="hr-so"></td><td class="hr-sp"></td><td></td></tr></tfoot></table>
            <button type="button" class="btn-logout hr-add">+ Přidat řádek</button>
          </div>
        </div>`;
      }).join("")}</div></div>`;
  }).join("");
}

export function bindHours(root, onChange = () => {}) {
  const recalc = card => {
    const sum = cls => { const xs = [...card.querySelectorAll(cls)].map(i => parseNum(i.value)).filter(v => v != null && !isNaN(v)); return xs.length ? xs.reduce((a, b) => a + b, 0) : null; };
    card.querySelector(".hr-so").textContent = fmtNum(sum(".hr-o")) || "—";
    card.querySelector(".hr-sp").textContent = fmtNum(sum(".hr-p")) || "—";
  };
  const bindNum = i => {
    i.oninput = () => { i.classList.toggle("kpi-bad", isNaN(parseNum(i.value))); const c = i.closest(".hr-card"); if (c) recalc(c); onChange(); };
    i.onblur = () => { const v = parseNum(i.value); if (v != null && !isNaN(v)) i.value = fmtNum(v); };
  };
  const bindRow = (card, tr) => {
    tr.querySelectorAll(".kpi-num").forEach(bindNum);
    tr.querySelector(".hr-name").oninput = onChange;
    tr.querySelector(".hr-rm").onclick = () => { tr.remove(); recalc(card); onChange(); };
  };
  root.querySelectorAll(".hr-card").forEach(card => {
    const tb = card.querySelector("tbody");
    tb.querySelectorAll("tr").forEach(tr => bindRow(card, tr));
    card.querySelectorAll(".hr-center .kpi-num").forEach(bindNum);
    const addRows = list => { list.forEach(r => { tb.insertAdjacentHTML("beforeend", row(r)); bindRow(card, tb.lastElementChild); }); recalc(card); };
    card.querySelector(".hr-add").onclick = () => { addRows([{}]); tb.lastElementChild.querySelector(".hr-name").focus(); onChange(); };
    card.querySelectorAll("input[type=radio]").forEach(r => r.onchange = () => {
      card.dataset.mode = r.value;
      if (r.value === "named" && !tb.children.length) {
        const sugg = JSON.parse(card.dataset.sugg || "[]");
        addRows(sugg.length ? sugg.map(n => ({ n })) : [{}, {}, {}]);
      }
      onChange();
    });
    recalc(card);
  });
}

// Vrátí { b: {branchId: {lak_odch, lak_prod, ...}}, h: {branchId: {lak:[{n,o,p}]}}, clearH: [[branchId, dept]], errors: [] }
export function collectHours(root) {
  const out = { b: {}, h: {}, clearH: [], errors: [] };
  root.querySelectorAll(".hr-dept").forEach(dep => {
    const dk = dep.dataset.dept, d = DEPTS[dk];
    dep.querySelectorAll(".hr-card").forEach(card => {
      const id = card.dataset.hb, name = card.querySelector("strong").textContent;
      const set = (k, v) => { if (v != null) (out.b[id] ||= {})[k] = v; };
      if (card.dataset.mode === "center") {
        const o = parseNum(card.querySelector(".hr-co").value), p = parseNum(card.querySelector(".hr-cp").value);
        if (isNaN(o) || isNaN(p)) out.errors.push(`${d.label} – ${name}: neplatné číslo v hodinách`);
        set(d.o, isNaN(o) ? null : o); set(d.p, isNaN(p) ? null : p);
        out.clearH.push([id, dk]);
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
      if (!rows.length) { out.clearH.push([id, dk]); return; }
      (out.h[id] ||= {})[dk] = rows;
      const sum = k => { const xs = rows.map(r => r[k]).filter(v => v != null); return xs.length ? xs.reduce((a, b) => a + b, 0) : null; };
      set(d.o, sum("o")); set(d.p, sum("p"));
    });
  });
  return out;
}
