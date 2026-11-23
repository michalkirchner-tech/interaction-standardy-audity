// Čtení prvního listu souboru .xlsx v prohlížeči (bez externích knihoven).
// Vrací pole řádků, každý řádek je pole hodnot (text / číslo / null).

async function unzip(buf) {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("soubor není platný .xlsx (Excel 2007 a novější). Starší .xls nejdřív v Excelu uložte jako .xlsx.");
  const n = dv.getUint16(eocd + 10, true);
  let off = dv.getUint32(eocd + 16, true);
  const out = {}, dec = new TextDecoder();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(off, true) !== 0x02014b50) throw new Error("poškozený soubor");
    const method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
    const nl = dv.getUint16(off + 28, true), el = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), lo = dv.getUint32(off + 42, true);
    const name = dec.decode(u8.subarray(off + 46, off + 46 + nl));
    off += 46 + nl + el + cl;
    if (!/^xl\/(workbook\.xml|sharedStrings\.xml|worksheets\/[^/]+\.xml|_rels\/workbook\.xml\.rels)$/.test(name)) continue;
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
const colIdx = ref => { const m = /^([A-Z]+)/.exec(ref)[1]; let n = 0; for (const ch of m) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export async function readFirstSheet(file) {
  const files = await unzip(await file.arrayBuffer());
  const shared = files["xl/sharedStrings.xml"] ? byTag(xml(files["xl/sharedStrings.xml"]), "si").map(si => byTag(si, "t").map(t => t.textContent).join("")) : [];
  // první list podle pořadí v sešitu
  let path = null;
  const wb = files["xl/workbook.xml"] && xml(files["xl/workbook.xml"]);
  const rels = files["xl/_rels/workbook.xml.rels"] && xml(files["xl/_rels/workbook.xml.rels"]);
  const first = wb && byTag(wb, "sheet")[0];
  if (first && rels) {
    const rid = first.getAttribute("r:id") || first.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rel = byTag(rels, "Relationship").find(r => r.getAttribute("Id") === rid);
    if (rel) path = "xl/" + rel.getAttribute("Target").replace(/^\/?xl\//, "").replace(/^\//, "");
  }
  if (!path || !files[path]) path = Object.keys(files).filter(k => k.startsWith("xl/worksheets/")).sort()[0];
  if (!path) throw new Error("v souboru není žádný list");
  const rows = [];
  for (const row of byTag(xml(files[path]), "row")) {
    const r = +row.getAttribute("r") - 1;
    const arr = rows[r] = [];
    for (const c of byTag(row, "c")) {
      const t = c.getAttribute("t"), v = byTag(c, "v")[0]?.textContent;
      let val = null;
      if (t === "s") val = shared[+v] ?? "";
      else if (t === "inlineStr") val = byTag(c, "t").map(x => x.textContent).join("");
      else if (t === "str" || t === "b" || t === "e") val = v ?? "";
      else if (v != null) val = Number(v);
      arr[colIdx(c.getAttribute("r"))] = val;
    }
  }
  return Array.from(rows, r => r || []);
}
