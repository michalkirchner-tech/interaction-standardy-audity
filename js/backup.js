// Zálohy dat – jen pro administrátora
import { supabase } from "./supabase.js?v=20261119d";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const BRAND = { arval: "Arval", stellantis: "Stellantis", mitsubishi: "Mitsubishi", hyundai: "Hyundai" };
const ACTION = { INSERT: "Nový záznam", UPDATE: "Úprava", DELETE: "Smazání" };
const REMIND_DAYS = 30;
const fmt = iso => { const d = new Date(iso); return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
const fmtD = iso => { if (!iso) return "—"; const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : "")); return `${d.getDate()}. ${d.getMonth() + 1}. ${d.getFullYear()}`; };
const daysSince = iso => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);

export async function lastBackup() {
  const { data, error } = await supabase.from("backup_log").select("created_at,audits_count").order("created_at", { ascending: false }).limit(1);
  if (error) throw error;
  return data[0] || null;
}

// Upozornění na úvodní stránce pro admina
export async function backupReminderHtml() {
  try {
    const last = await lastBackup();
    if (last && daysSince(last.created_at) < REMIND_DAYS) return "";
    const txt = last ? `Poslední záloha dat byla stažena před ${daysSince(last.created_at)} dny.` : "Záloha dat zatím nebyla stažena.";
    return `<div class="backup-remind"><span>💾 ${txt} Doporučujeme stáhnout zálohu alespoň jednou za měsíc.</span><a href="#zalohy">Přejít na zálohy</a></div>`;
  } catch { return ""; }
}

async function loadAll() {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("audits").select("*").order("created_at").range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) return out;
  }
}

async function downloadBackup(btn, refresh) {
  btn.disabled = true; btn.textContent = "Připravuji zálohu…";
  try {
    const audits = (await loadAll()).map(({ next_audit_date, ...r }) => r);
    const now = new Date();
    const payload = { app: "interaction-standardy-audity", format: 1, created_at: now.toISOString(), count: audits.length, audits };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `zaloha_standardy_audity_${now.toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("backup_log").insert({ audits_count: audits.length, created_by: user.id });
    if (error) throw error;
    await refresh();
  } catch (e) { alert("Zálohu se nepodařilo vytvořit: " + e.message); }
  finally { btn.disabled = false; btn.textContent = "Stáhnout zálohu"; }
}

async function readBackupFile(file) {
  let obj;
  try { obj = JSON.parse(await file.text()); } catch { throw new Error("Soubor není platná záloha (nejde přečíst jako JSON)."); }
  if (obj?.app !== "interaction-standardy-audity" || !Array.isArray(obj.audits)) throw new Error("Soubor není záloha z aplikace Standardy a audity.");
  const bad = obj.audits.filter(r => !r.id || !r.brand || !r.partner || !r.audit_date);
  if (bad.length) throw new Error(`Záloha obsahuje ${bad.length} neúplných záznamů – obnovu nelze provést.`);
  return obj;
}

export async function renderBackups(app) {
  document.title = "Zálohy dat | INTERACTION";
  app.innerHTML = `
    <section class="brand-page wide-page">
      <a class="back" href="#">← Zpět na úvodní stránku</a>
      <div class="brand-head"><div class="bk-icon">💾</div><div><h2>Zálohy dat</h2><p>Stažení zálohy všech auditů, obnova ze zálohy a historie změn. Tuto stránku vidí jen administrátor.</p></div></div>
      <div class="bk-grid">
        <div class="res-card">
          <h3>1. Stáhnout zálohu</h3>
          <p>Stáhne všechny uložené audity (včetně kompletního JSON každého formuláře) do jednoho souboru. Soubor uložte mimo aplikaci – např. na OneDrive nebo firemní disk.</p>
          <div id="bkInfo" class="bk-info">Načítám…</div>
          <button type="button" class="btn-save" id="bkDownload">Stáhnout zálohu</button>
        </div>
        <div class="res-card">
          <h3>2. Obnovit ze zálohy</h3>
          <p>Nahrajte dříve stažený soubor zálohy. Nejdřív uvidíte, co obsahuje – nic se nezmění, dokud obnovu nepotvrdíte.</p>
          <label class="btn-import">Vybrat soubor zálohy<input type="file" id="bkFile" accept=".json,application/json" hidden></label>
          <div id="bkRestore" class="bk-info"></div>
        </div>
      </div>
      <div class="res-card" style="margin-top:18px">
        <h3>3. Historie změn</h3>
        <p>Každé uložení, přepsání nebo smazání auditu se automaticky zaznamená. Když se něco omylem přepíše nebo smaže, můžete vrátit předchozí verzi.</p>
        <div id="bkHist"><div class="empty">Načítám…</div></div>
      </div>
    </section>`;

  const info = document.getElementById("bkInfo"), hist = document.getElementById("bkHist");
  const refresh = async () => {
    try {
      const [{ count }, last] = await Promise.all([supabase.from("audits").select("id", { count: "exact", head: true }), lastBackup()]);
      info.innerHTML = `V databázi je <b>${count}</b> auditů.<br>` + (last
        ? `Poslední záloha: <b>${fmt(last.created_at)}</b> (${last.audits_count} auditů)${daysSince(last.created_at) >= REMIND_DAYS ? ` – <b class="c-exp">doporučujeme stáhnout novou</b>` : ""}.`
        : `<b class="c-exp">Záloha zatím nebyla stažena.</b>`);
    } catch (e) { info.textContent = "Chyba načtení: " + e.message; }
    await renderHistory(hist, refresh);
  };
  document.getElementById("bkDownload").onclick = e => downloadBackup(e.currentTarget, refresh);

  document.getElementById("bkFile").onchange = async e => {
    const f = e.target.files[0], out = document.getElementById("bkRestore");
    e.target.value = "";
    if (!f) return;
    try {
      const b = await readBackupFile(f);
      const { data: cur, error } = await supabase.from("audits").select("id");
      if (error) throw error;
      const have = new Set(cur.map(r => r.id));
      const missing = b.audits.filter(r => !have.has(r.id)).length, existing = b.audits.length - missing;
      out.innerHTML = `<div class="bk-preview"><b>${esc(f.name)}</b><br>Záloha z ${fmt(b.created_at)} · ${b.audits.length} auditů<br>
        • <b>${missing}</b> auditů v databázi chybí (byly smazány)<br>• <b>${existing}</b> auditů v databázi existuje</div>
        <button type="button" class="btn-save" id="bkMissing" ${missing ? "" : "disabled"}>Obnovit jen chybějící (${missing})</button>
        <button type="button" class="btn-exp" id="bkAll">Obnovit vše a přepsat stávající (${b.audits.length})</button>`;
      const run = async mode => {
        if (mode === "all" && !confirm(`Opravdu přepsat ${existing} existujících auditů stavem ze zálohy z ${fmt(b.created_at)}?\n\nZměny provedené od té doby se ztratí (zůstanou ale v historii změn).`)) return;
        out.querySelectorAll("button").forEach(x => x.disabled = true);
        const { data, error } = await supabase.rpc("restore_audits", { p_rows: b.audits, p_mode: mode });
        if (error) { out.insertAdjacentHTML("beforeend", `<div class="c-exp">Obnova selhala: ${esc(error.message)}</div>`); return; }
        out.innerHTML = `<div class="bk-ok">✓ Hotovo – obnoveno ${data.obnoveno}, přepsáno ${data.prepsano}, přeskočeno ${data.preskoceno}.</div>`;
        await refresh();
      };
      document.getElementById("bkMissing").onclick = () => run("missing");
      document.getElementById("bkAll").onclick = () => run("all");
    } catch (err) { out.innerHTML = `<div class="c-exp">${esc(err.message)}</div>`; }
  };
  await refresh();
}

async function renderHistory(box, refresh) {
  try {
    const [{ data: rows, error }, { data: people }] = await Promise.all([
      supabase.from("audits_history").select("id,audit_id,action,changed_at,changed_by,brand,partner,old_row,new_row").order("changed_at", { ascending: false }).limit(100),
      supabase.from("profiles").select("id,full_name,email"),
    ]);
    if (error) throw error;
    if (!rows.length) { box.innerHTML = `<div class="empty">Zatím žádné změny – historie se začala zaznamenávat 18. 11. 2026.</div>`; return; }
    const who = Object.fromEntries((people || []).map(p => [p.id, p.full_name || p.email]));
    box.innerHTML = `<div class="table-wrap"><table class="res-table"><thead><tr><th>Kdy</th><th>Akce</th><th>Značka</th><th>Zákazník</th><th>Datum auditu</th><th>Kdo</th><th></th></tr></thead><tbody>
      ${rows.map(h => {
        const r = h.new_row || h.old_row || {};
        return `<tr><td class="td-date">${fmt(h.changed_at)}</td><td><span class="bk-act bk-${h.action.toLowerCase()}">${ACTION[h.action]}</span></td>
          <td>${esc(BRAND[h.brand] || h.brand)}</td><td>${esc(h.partner)}</td><td class="td-date">${fmtD(r.audit_date)}</td><td class="muted-cell">${esc(who[h.changed_by] || "—")}</td>
          <td>${h.old_row ? `<button type="button" class="btn-del" data-restore="${h.id}" title="Vrátí audit do stavu před touto změnou">${h.action === "DELETE" ? "Obnovit smazaný" : "Vrátit předchozí verzi"}</button>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div><p class="muted-cell">Zobrazeno posledních ${rows.length} změn.</p>`;
    box.querySelectorAll("[data-restore]").forEach(btn => btn.onclick = async () => {
      const h = rows.find(x => String(x.id) === btn.dataset.restore);
      if (!confirm(h.action === "DELETE" ? `Obnovit smazaný audit „${h.partner}“?` : `Vrátit audit „${h.partner}“ do stavu před úpravou z ${fmt(h.changed_at)}?`)) return;
      btn.disabled = true;
      const { error: e2 } = await supabase.rpc("restore_audit_version", { p_history_id: h.id });
      if (e2) { alert("Obnova selhala: " + e2.message); btn.disabled = false; return; }
      await refresh();
    });
  } catch (e) { box.innerHTML = `<div class="c-exp">Historii se nepodařilo načíst: ${esc(e.message)}</div>`; }
}
