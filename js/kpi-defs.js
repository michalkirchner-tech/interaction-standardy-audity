// KPI – sledované vstupy (společné pro aplikaci, stránku pro partnera a excelovou šablonu)
export const LAK = [
  { k: "nakup", l: "Nákup lakýrnického materiálu", u: "Kč", adminOnly: true },
  { k: "spotreba", l: "Spotřeba (odepsaný) lakýrnický materiál", u: "Kč" },
  { k: "obrat", l: "Obrat (fakturace) lakýrnického materiálu", u: "Kč" },
  { k: "mj", l: "Prodané (fakturované) materiálové jednotky", u: "MJ", hint: "vyplňte pouze v případě, že lakýrnický materiál účtujete podle výrobce, tj. v MJ" },
  { k: "lak_odch", l: "Odchozené hodiny lakovna", u: "hod", hours: "lak" },
  { k: "lak_prod", l: "Prodané (fakturované) hodiny lakovna", u: "hod", hours: "lak" },
  { k: "lak_zam", l: "Produktivní zaměstnanci lakovny (přípravář + lakýrník)", u: "osob", avg: true },
  { k: "lak_zak", l: "Počet zakázek lakovna", u: "ks" },
];
export const KAR = [
  { k: "kar_zam", l: "Produktivní zaměstnanci karosárny", u: "osob", avg: true },
  { k: "kar_odch", l: "Odchozené hodiny karosárna", u: "hod", hours: "kar" },
  { k: "kar_prod", l: "Prodané (fakturované) hodiny karosárna", u: "hod", hours: "kar" },
  { k: "kar_zak", l: "Počet zakázek karosárna", u: "ks" },
];
export const PAINT = [
  { k: "plnic", l: "Plnič", u: "l" },
  { k: "barva", l: "Podkladová barva", u: "l" },
  { k: "lak", l: "Vrchní lak", u: "l" },
  { k: "mj", l: "Prodané MJ", u: "MJ" },
  { k: "hod", l: "Prodané hodiny", u: "hod" },
];

// Hodiny lze zadat za celé středisko, nebo jmenovitě (součet se dopočítá)
export const DEPTS = {
  lak: { label: "Lakovna", who: "Lakýrník / přípravář", o: "lak_odch", p: "lak_prod" },
  kar: { label: "Karosárna", who: "Karosář", o: "kar_odch", p: "kar_prod" },
};

const MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
export const periodName = (t, n) => t === "M" ? MONTHS[n - 1] : t === "Q" ? `${n}. kvartál` : t === "H" ? `${n}. pololetí` : "celý rok";
// „1. 10. 2026 – 31. 12. 2026“
export function periodRange(year, t, n) {
  const [a, z] = t === "M" ? [n, n] : t === "Q" ? [n * 3 - 2, n * 3] : t === "H" ? [n * 6 - 5, n * 6] : [1, 12];
  const last = new Date(year, z, 0).getDate();
  return `1. ${a}. ${year} – ${last}. ${z}. ${year}`;
}
