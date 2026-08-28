/**
 * Content script Omnivox — collecte passive. Il tourne dans chaque cadre des
 * pages Omnivox pendant que TU navigues : aucune requête ajoutée, aucune
 * connexion tentée, tes identifiants ne sont jamais touchés. Il vaut pour
 * n'importe quel cégep : l'adresse du portail est relevée, jamais supposée.
 *
 * Trois moissons, selon ce que le cadre contient :
 *  - cartes d'évènement (accueil Léa, vue par mois) → échéances ;
 *  - liste #lstMIO → messages de la boîte de réception ;
 *  - vue d'un MIO ouvert (module MIOE, cadre sans liste) → corps complet,
 *    liens réels et URL profonde — ce que le scraper Playwright perdait.
 */
(() => {
  "use strict";
  const P = self.AgendaParsers;
  if (!P) return;

  const send = (payload) => {
    try { chrome.runtime.sendMessage({ type: "absorb", payload }); } catch { /* SW endormi : re-tenté au prochain passage */ }
  };

  /* L'adresse du portail n'est pas codée en dur : chaque cégep a la sienne.
     On l'annonce depuis le cadre où l'on tourne — c'est la seule façon de
     l'apprendre sans la demander, et elle sert ensuite à la collecte
     horaire, qui n'a aucune page sous la main pour la deviner. */
  try { chrome.runtime.sendMessage({ type: "hote", hote: location.hostname }); } catch {}

  let last = "";
  function run() {
    const out = { deadlines: [], mios: [], vues: [] };

    for (const card of P.readCards(document)) {
      const d = P.parseCard(card.lines);
      if (d) out.deadlines.push(d);
    }

    for (const cells of P.readMioRows(document)) {
      const m = P.parseMioCells(cells);
      if (m) out.mios.push(m);
    }

    // Vue d'un message ouvert : un cadre du module MIOE qui n'est pas la liste.
    if (/Module\.MIOE/i.test(location.href) && !document.querySelector("#lstMIO")) {
      const text = (document.body?.innerText || "").replace(/\u00a0/g, " ").trim();
      if (text.length > 60) {
        out.vues.push({
          url: location.href,
          text: text.split("\n").map((l) => l.trim()).filter(Boolean).join("\n").slice(0, 6000),
          links: [...document.querySelectorAll("a[href]")]
            .map((a) => ({ t: (a.textContent || "").trim().slice(0, 80), h: a.href }))
            .filter((l) => /^https?:/.test(l.h))
            .slice(0, 40),
        });
      }
    }

    if (!out.deadlines.length && !out.mios.length && !out.vues.length) return;
    // Même page relue sans changement : on n'envoie pas deux fois.
    const sig = JSON.stringify(out);
    if (sig === last) return;
    last = sig;
    send(out);
  }

  // Les pages ASP.NET d'Omnivox finissent de se peindre après « load » :
  // une passe immédiate, une passe tardive, puis on suit les mutations
  // (ouverture d'un MIO sans navigation) avec un amortisseur.
  const kick = () => { run(); setTimeout(run, 2500); };
  if (document.readyState === "complete") kick();
  else addEventListener("load", kick, { once: true });

  let timer = null;
  new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(run, 800);
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
