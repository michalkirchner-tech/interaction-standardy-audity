// KPI – excelová šablona pro partnera (vytvoření .xlsx) a načtení vyplněné tabulky zpět
import { zip } from "./export.js?v=20261120r";
import { LAK, KAR, PAINT, DEPTS, periodRange } from "./kpi-defs.js?v=20261120r";

const MAGIC = "interaction-kpi-sablona-v1";
const MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
const periodName = (t, n) => t === "M" ? MONTHS[n - 1] : t === "Q" ? `${n}. kvartál` : t === "H" ? `${n}. pololetí` : "celý rok";
const escX = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const col = i => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
const enc = s => new TextEncoder().encode(s);

// styly: 0 běžný, 1 nadpis, 2 záhlaví tabulky, 3 sekce, 4 popisek, 5 vstupní pole (odemčené), 6 poznámka, 7 jednotka
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.####"/></numFmts>
<fonts count="7"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="15"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF555555"/><name val="Calibri"/></font><font><sz val="9"/><color rgb="FF777777"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><i/><sz val="9"/><color rgb="FF0D4798"/><name val="Calibri"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1E1E1E"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE2E2E2"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF6CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE91929"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"><color rgb="FFB0B0B0"/></left><right style="thin"><color rgb="FFB0B0B0"/></right><top style="thin"><color rgb="FFB0B0B0"/></top><bottom style="thin"><color rgb="FFB0B0B0"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyFont="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyProtection="1"><protection locked="0"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="5" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyProtection="1"><protection locked="0"/></xf>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

// req = { partner:{id,name,has_kar,has_painters,kpi_branches[{id,name,kpi_painters}]}, year, type, no, branchIds:[] }
export function buildTemplate(req) {
  const p = req.partner;
  const brs = p.kpi_branches.filter(b => req.branchIds.includes(b.id));
  const per = `${periodName(req.type, req.no)} ${req.year}`;
  const rows = [];       // [{ r, cells:[{c, v, s, num}] , ht }]
  const map = [];        // [ref, "b|p", id, key, label]
  let r = 0;
  const add = (cells, ht) => { r++; rows.push({ r, cells, ht }); return r; };
  const ncol = Math.max(2 + brs.length, 4);
  add([{ c: 0, v: `Podklady pro KPI – ${p.name}`, s: 1 }], 22);
  const banner = add([{ c: 0, v: `VYPLŇUJETE ÚDAJE ZA OBDOBÍ:  ${per.toUpperCase()}   (${periodRange(req.year, req.type, req.no)})   –   ${{ lak: "LAKOVNA", kar: "KAROSÁRNA (KLEMPÍRNA)", all: "LAKOVNA A KAROSÁRNA" }[req.scope || (p.has_kar ? "all" : "lak")]}`, s: 8 }, ...Array.from({ length: ncol - 1 }, (_, i) => ({ c: i + 1, v: "", s: 8 }))], 28);
  add([{ c: 0, v: "Vyplňte prosím jen žlutá pole. Čísla pište bez měny (Kč) – desetinná místa s čárkou. Pokud údaj nesledujete, pole nechte prázdné. Řádky ani sloupce prosím nepřidávejte a list nepřejmenovávejte – tabulka se pak automaticky načte zpět.", s: 6 }], 46);
  const merges = [`A2:${col(ncol - 1)}2`, `A3:${col(ncol - 1)}3`];
  add([]);
  add([{ c: 0, v: "Ukazatel", s: 2 }, { c: 1, v: "Jednotka", s: 2 }, ...brs.map((b, i) => ({ c: 2 + i, v: b.name, s: 2 }))], 20);
  const section = (title, defs) => {
    add([{ c: 0, v: title, s: 3 }, { c: 1, v: "", s: 3 }, ...brs.map((_, i) => ({ c: 2 + i, v: "", s: 3 }))]);
    for (const m of defs.filter(m => !m.adminOnly)) {
      const rr = r + 1;
      add([{ c: 0, v: m.l + (m.avg ? " (průměrný stav za období)" : "") + (m.hours ? " – souhrnně za celé středisko" : ""), s: 4 }, { c: 1, v: m.u, s: 7 },
        ...brs.map((b, i) => { map.push([`${col(2 + i)}${rr}`, "b", b.id, m.k, m.l]); return { c: 2 + i, v: null, s: 5 }; })], m.avg || m.hours ? 32 : 18);
      if (m.hint) { add([{ c: 0, v: "↑ " + m.hint, s: 9 }], 16); merges.push(`A${r}:${col(ncol - 1)}${r}`); }
    }
  };
  const scope = req.scope || (p.has_kar ? "all" : "lak");
  const depts = scope === "all" ? ["lak", "kar"] : [scope];
  if (depts.includes("lak")) section("Lakovna", LAK);
  if (depts.includes("kar")) section("Karosárna (klempírna)", KAR);
  // hodiny jmenovitě – místo souhrnu za středisko
  for (const dk of depts) {
    const d = DEPTS[dk];
    add([]);
    add([{ c: 0, v: `Odchozené a prodané hodiny jmenovitě – ${d.label}`, s: 1 }], 20);
    add([{ c: 0, v: `Nepovinné. Pokud hodiny zadáte jmenovitě, nechte řádky „souhrnně za celé středisko“ výše prázdné – součet se spočítá automaticky. Jména lze přepsat i doplnit.`, s: 6 }], 30);
    merges.push(`A${r}:${col(ncol - 1)}${r}`);
    for (const b of brs) {
      add([{ c: 0, v: `${b.name} – ${d.who}`, s: 2 }, { c: 1, v: "", s: 2 }, { c: 2, v: "Odchozené hod.", s: 2 }, { c: 3, v: "Prodané hod.", s: 2 }], 18);
      const sugg = dk === "lak" ? (b.kpi_painters || []).map(x => x.name) : [];
      const n = Math.max(8, sugg.length + 3);
      for (let i = 0; i < n; i++) {
        const rr = r + 1;
        map.push([`A${rr}`, "hrow", b.id, dk, `C${rr}|D${rr}`]);
        add([{ c: 0, v: sugg[i] || null, s: 10 }, { c: 1, v: "", s: 4 }, { c: 2, v: null, s: 5 }, { c: 3, v: null, s: 5 }], 18);
      }
    }
  }
  add([]);
  const whoRow = add([{ c: 0, v: "Vyplnil(a) – jméno a příjmení", s: 4 }, { c: 1, v: null, s: 5 }], 18);
  merges.push(`B${whoRow}:${col(Math.max(2, ncol - 1))}${whoRow}`);
  map.push([`B${whoRow}`, "who", "", "", "Vyplnil(a)"]);

  const cellXml = (rr, x) => {
    const ref = col(x.c) + rr;
    if (x.v == null || x.v === "") return `<c r="${ref}" s="${x.s}"/>`;
    return `<c r="${ref}" t="inlineStr" s="${x.s}"><is><t xml:space="preserve">${escX(x.v)}</t></is></c>`;
  };
  const widths = [52, 11, ...Array(Math.max(0, ncol - 2)).fill(18)];
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rows.map(x => `<row r="${x.r}"${x.ht ? ` ht="${x.ht}" customHeight="1"` : ""}>${x.cells.map(c => cellXml(x.r, c)).join("")}</row>`).join("")}</sheetData>
<sheetProtection sheet="1" objects="1" scenarios="1" formatColumns="0" formatRows="0" selectLockedCells="0" selectUnlockedCells="0"/>
<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>
<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  const meta = [[MAGIC], [p.id], [req.year], [req.type], [req.no], [req.branchIds.join(",")], [p.name], [per], [], ...map];
  const metaSheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${meta.map((row, i) => `<row r="${i + 1}">${row.map((v, j) => `<c r="${col(j)}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${escX(v)}</t></is></c>`).join("")}</row>`).join("")}</sheetData>
<sheetProtection sheet="1" objects="1" scenarios="1"/></worksheet>`;
  const files = [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookProtection lockStructure="1"/><sheets><sheet name="KPI" sheetId="1" r:id="rId1"/><sheet name="_meta" sheetId="2" state="veryHidden" r:id="rId2"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", STYLES],
    ["xl/worksheets/sheet1.xml", sheet],
    ["xl/worksheets/sheet2.xml", metaSheet],
  ];
  const safe = s => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return { blob: zip(files.map(([name, s]) => ({ name, data: enc(s) }))), filename: `KPI_${safe(p.name)}_${safe(per)}.xlsx` };
}

// ---------- Čtení .xlsx ----------
async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("soubor není platný .xlsx (Excel 2007 a novější)");
  const n = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = {}, dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) throw new Error("poškozený soubor");
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
    const nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), lo = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nl));
    off += 46 + nl + el + cl;
    if (!/^(xl\/(workbook\.xml|sharedStrings\.xml|worksheets\/[^/]+\.xml|_rels\/workbook\.xml\.rels))$/.test(name)) continue;
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = u8.subarray(ds, ds + csize);
    let data;
    if (method === 0) data = raw;
    else if (method === 8) data = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer());
    else throw new Error("nepodporovaná komprese souboru");
    out[name] = dec.decode(data);
  }
  return out;
}

const xml = s => new DOMParser().parseFromString(s, "application/xml");
const byTag = (node, tag) => [...node.getElementsByTagNameNS("*", tag)];

function readSheet(text, shared) {
  const cells = {};
  for (const c of byTag(xml(text), "c")) {
    const t = c.getAttribute("t"), v = byTag(c, "v")[0]?.textContent;
    let val = null;
    if (t === "s") val = shared[+v] ?? "";
    else if (t === "inlineStr") val = byTag(c, "t").map(x => x.textContent).join("");
    else if (t === "str" || t === "b" || t === "e") val = v ?? "";
    else if (v != null) val = Number(v);
    cells[c.getAttribute("r")] = val;
  }
  return cells;
}

const parseNum = v => {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const t = String(v).replace(/\s| |Kč|kc/gi, "").replace(",", ".");
  if (t === "") return null;
  const n = Number(t); return isNaN(n) ? NaN : n;
};

// Vrací { partnerId, year, type, no, branchIds, partnerName, period, who, data:{b,p}, problems:[], count }
export async function readTemplate(file) {
  const files = await unzip(await file.arrayBuffer());
  const shared = files["xl/sharedStrings.xml"] ? byTag(xml(files["xl/sharedStrings.xml"]), "si").map(si => byTag(si, "t").map(t => t.textContent).join("")) : [];
  const wb = xml(files["xl/workbook.xml"] || "");
  const rels = xml(files["xl/_rels/workbook.xml.rels"] || "");
  const target = name => {
    const sh = byTag(wb, "sheet").find(s => s.getAttribute("name") === name);
    if (!sh) return null;
    const rid = sh.getAttribute("r:id") || sh.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rel = byTag(rels, "Relationship").find(r => r.getAttribute("Id") === rid);
    return rel && "xl/" + rel.getAttribute("Target").replace(/^\/?xl\//, "").replace(/^\//, "");
  };
  const metaPath = target("_meta"), mainPath = target("KPI");
  if (!metaPath || !files[metaPath]) throw new Error("tabulka nebyla vytvořena touto aplikací (chybí skrytý list s údaji o partnerovi)");
  if (!mainPath || !files[mainPath]) throw new Error("chybí list „KPI“ – nebyl přejmenován?");
  const meta = readSheet(files[metaPath], shared), main = readSheet(files[mainPath], shared);
  if (meta.A1 !== MAGIC) throw new Error("tabulka nebyla vytvořena touto aplikací");
  const res = { partnerId: String(meta.A2), year: Number(meta.A3), type: String(meta.A4), no: Number(meta.A5), branchIds: String(meta.A6 || "").split(",").filter(Boolean),
    partnerName: meta.A7, period: meta.A8, who: "", data: { b: {}, p: {} }, problems: [], count: 0 };
  const named = {}; // id -> dept -> rows
  for (let r = 10; meta["A" + r] != null; r++) {
    const [ref, kind, id, key, label] = ["A", "B", "C", "D", "E"].map(c => meta[c + r]);
    const raw = main[ref];
    if (kind === "hrow") {
      const [oRef, pRef] = String(label).split("|");
      const n = raw == null ? "" : String(raw).trim(), o = parseNum(main[oRef]), pv = parseNum(main[pRef]);
      if (o == null && pv == null) continue;             // jen jméno bez hodin se ignoruje
      if (isNaN(o) || isNaN(pv) || o < 0 || pv < 0) { res.problems.push(`řádek ${ref.slice(1)} (hodiny jmenovitě${n ? ", " + n : ""}): neplatné číslo`); continue; }
      if (!n) { res.problems.push(`řádek ${ref.slice(1)} (hodiny jmenovitě): u hodin chybí jméno`); continue; }
      ((named[id] ||= {})[key] ||= []).push({ n: n.slice(0, 80), o, p: pv });
      continue;
    }
    if (kind === "who") { res.who = raw == null ? "" : String(raw).trim(); continue; }
    const v = parseNum(raw);
    if (v == null) continue;
    if (isNaN(v) || v < 0) { res.problems.push(`${ref} (${label}): „${raw}“ není platné kladné číslo`); continue; }
    (res.data[kind][id] ||= {})[key] = v;
    res.count++;
  }
  // součty jmenovitých hodin nahradí souhrn za středisko
  res.data.h = named;
  for (const [id, deps] of Object.entries(named)) for (const [dk, rows] of Object.entries(deps)) {
    const d = DEPTS[dk];
    for (const [k, f] of [[d.o, "o"], [d.p, "p"]]) {
      const xs = rows.map(x => x[f]).filter(v => v != null);
      if (!xs.length) continue;
      const sum = xs.reduce((a, b) => a + b, 0), prev = res.data.b[id]?.[k];
      if (prev != null && prev !== sum) res.problems.push(`${d.label}: vyplněn souhrn za středisko (${prev}) i jmenovité hodiny – použije se součet jmenovitých (${sum})`);
      if (prev == null) res.count++;
      (res.data.b[id] ||= {})[k] = sum;
    }
  }
  return res;
}
