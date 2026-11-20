// KPI – sledované vstupy (společné pro aplikaci, stránku pro partnera a excelovou šablonu)
export const LAK = [
  { k: "nakup", l: "Nákup lakýrnického materiálu", u: "Kč" },
  { k: "spotreba", l: "Spotřeba (odepsaný) lakýrnický materiál", u: "Kč" },
  { k: "obrat", l: "Obrat (fakturace) lakýrnického materiálu", u: "Kč" },
  { k: "mj", l: "Prodané (fakturované) materiálové jednotky", u: "MJ" },
  { k: "lak_odch", l: "Odchozené hodiny lakovna", u: "hod" },
  { k: "lak_prod", l: "Prodané (fakturované) hodiny lakovna", u: "hod" },
  { k: "lak_zam", l: "Produktivní zaměstnanci lakovny (přípravář + lakýrník)", u: "osob", avg: true },
  { k: "lak_zak", l: "Počet zakázek LAK", u: "ks" },
];
export const KAR = [
  { k: "kar_zam", l: "Produktivní zaměstnanci karosárny", u: "osob", avg: true },
  { k: "kar_odch", l: "Odchozené hodiny karosárna", u: "hod" },
  { k: "kar_prod", l: "Prodané (fakturované) hodiny karosárna", u: "hod" },
  { k: "kar_zak", l: "Počet zakázek KAR", u: "ks" },
];
export const PAINT = [
  { k: "plnic", l: "Plnič", u: "l" },
  { k: "barva", l: "Podkladová barva", u: "l" },
  { k: "lak", l: "Vrchní lak", u: "l" },
  { k: "mj", l: "Prodané MJ", u: "MJ" },
  { k: "hod", l: "Prodané hodiny", u: "hod" },
];
