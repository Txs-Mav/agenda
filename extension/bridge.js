/**
 * Content script du tableau de bord — sert les données collectées à la page,
 * au même format que public/data.json : { lastScrape, mios, deadlines }.
 * La page écoute (agenda.html) et passe le tout à ingest(), qui applique déjà
 * ses règles : le supprimé ne revient pas, le « fait » survit.
 *
 * Il relève aussi SOUS QUEL COURRIEL la page est connectée, pour que le popup
 * le propose au lieu de le faire retaper. Le courriel seulement : le jeton de
 * la page reste à la page. Supabase fait tourner le jeton de rafraîchissement
 * à chaque échange — deux détenteurs du même jeton se révoqueraient l'un
 * l'autre, et l'extension déconnecterait le tableau de bord. Elle ouvre donc
 * sa propre session, une fois, depuis le popup.
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

  /* Le courriel du compte ouvert ici. La page le garde à deux endroits — le
     rangement rapide, et le cookie de 400 jours qui survit au ménage de
     Safari : on regarde les deux, et rien d'autre n'en sort. */
  function courrielDeLaPage() {
    try {
      const s = JSON.parse(localStorage.getItem("agenda.sb") || "null");
      if (s && s.email) return s.email;
    } catch {}
    try {
      const c = document.cookie.split("; ").find((x) => x.startsWith("agenda_sess="));
      if (c) {
        const v = JSON.parse(decodeURIComponent(c.slice("agenda_sess=".length)));
        if (v && v.email) return v.email;
      }
    } catch {}
    return "";
  }

  function remonterCourriel() {
    const email = courrielDeLaPage();
    if (!email) return;
    try { chrome.runtime.sendMessage({ type: "indice", email }); } catch { /* pont fermé */ }
  }

  push();
  remonterCourriel();
  chrome.storage.onChanged.addListener((_ch, area) => { if (area === "local") push(); });
  // La connexion peut arriver après le chargement : on repasse au retour sur
  // l'onglet, moment où l'utilisateur vient justement de se connecter.
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) remonterCourriel();
  });

  // La page peut demander une collecte immédiate (bouton futur du tableau
  // de bord) ; on relaie simplement au service worker.
  window.addEventListener("message", (e) => {
    if (e.source !== window || !e.data || e.data.source !== "agenda-cegep-page") return;
    if (e.data.type === "collect-now") {
      try { chrome.runtime.sendMessage({ type: "collect-now" }); } catch { /* pont fermé */ }
    }
  });
})();
