/**
 * Content script du tableau de bord — sert les données collectées à la page,
 * au même format que public/data.json : { lastScrape, mios, deadlines }.
 * La page écoute (agenda.html) et passe le tout à ingest(), qui applique déjà
 * ses règles : le supprimé ne revient pas, le « fait » survit.
 */
(() => {
  "use strict";

  async function push() {
    let st;
    try {
      st = await chrome.storage.local.get({ mios: {}, deadlines: {}, bodies: {}, lastScrape: "" });
    } catch { return; } // extension rechargée : ce vieux script n'a plus de pont
    const mios = Object.values(st.mios)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .map((m) => (st.bodies[m.id]?.url && !m.url ? { ...m, url: st.bodies[m.id].url } : m));
    const deadlines = Object.values(st.deadlines);
    if (!mios.length && !deadlines.length) return;
    window.postMessage({
      source: "agenda-cegep-ext",
      type: "export",
      payload: { lastScrape: st.lastScrape || null, mios, deadlines },
    }, location.origin);
  }

  push();
  chrome.storage.onChanged.addListener((_ch, area) => { if (area === "local") push(); });

  // La page peut demander une collecte immédiate (bouton futur du tableau
  // de bord) ; on relaie simplement au service worker.
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "agenda-cegep-page") return;
    if (e.data.type === "collect-now") {
      try { chrome.runtime.sendMessage({ type: "collect-now" }); } catch { /* pont fermé */ }
    }
  });
})();
