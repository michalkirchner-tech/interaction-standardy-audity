// Standardy a audity – úvodní stránka s dlaždicemi značek
const BRANDS = [
  { id: "arval",      name: "Arval",       logo: "assets/logos/arval.png",      wide: true, url: "arval/" },
  { id: "stellantis", name: "Stellantis",  logo: "assets/logos/stellantis.svg", wide: true, url: "stellantis/" },
  { id: "mercedes",   name: "Mercedes-Benz", logo: "assets/logos/mercedes.svg" },
  { id: "skoda",      name: "Škoda Auto",  logo: "assets/logos/skoda.svg",      wide: true },
  { id: "porsche-cr", name: "Porsche ČR",  logo: "assets/logos/porsche-cr.svg", wide: true },
  { id: "volvo",      name: "Volvo",       logo: "assets/logos/volvo.svg" },
  { id: "mitsubishi", name: "Mitsubishi",  logo: "assets/logos/mitsubishi.svg" },
  { id: "hyundai",    name: "Hyundai",     logo: "assets/logos/hyundai.svg",    wide: true },
];

const app = document.getElementById("app");
document.getElementById("year").textContent = new Date().getFullYear();

function renderHome() {
  document.title = "Standardy a audity | INTERACTION";
  app.innerHTML = `
    <section class="hero">
      <h1>Standardy a audity</h1>
      <p>Vyberte značku</p>
    </section>
    <section class="grid">
      ${BRANDS.map(b => `
        <a class="tile" href="${b.url || "#" + b.id}" aria-label="${b.name}">
          <span class="tile-logo${b.wide ? " wide" : ""}"><img src="${b.logo}" alt="${b.name}"></span>
          <span class="tile-name">${b.name}</span>
        </a>`).join("")}
    </section>`;
  app.querySelectorAll(".tile").forEach(attachTilt);
}

function renderBrand(brand) {
  document.title = `${brand.name} – Standardy a audity | INTERACTION`;
  app.innerHTML = `
    <section class="brand-page">
      <a class="back" href="#">← Zpět na přehled značek</a>
      <div class="brand-head">
        <img src="${brand.logo}" alt="${brand.name}">
        <div>
          <h2>${brand.name}</h2>
          <p>Standardy a audity</p>
        </div>
      </div>
      <a href="#" class="ia-home-fab" title="Zpět na úvodní stránku" aria-label="Zpět na úvodní stránku">
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5M5.5 9.5V20h5v-6h3v6h5V9.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </a>
      <div class="empty">Obsah pro značku ${brand.name} zatím není připraven – doplníme v dalším kroku.</div>
    </section>`;
  window.scrollTo(0, 0);
}

// 3D náklon dlaždice podle pozice myši
function attachTilt(tile) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  tile.addEventListener("pointermove", e => {
    const r = tile.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;   // 0..1
    const y = (e.clientY - r.top) / r.height;   // 0..1
    tile.style.setProperty("--ry", `${(x - 0.5) * 18}deg`);
    tile.style.setProperty("--rx", `${(0.5 - y) * 18}deg`);
    tile.style.setProperty("--gx", `${x * 100}%`);
    tile.style.setProperty("--gy", `${y * 100}%`);
  });
  tile.addEventListener("pointerleave", () => {
    tile.style.setProperty("--rx", "0deg");
    tile.style.setProperty("--ry", "0deg");
  });
}

function route() {
  const id = location.hash.replace(/^#\/?/, "");
  const brand = BRANDS.find(b => b.id === id);
  brand ? renderBrand(brand) : renderHome();
}

window.addEventListener("hashchange", route);
route();
