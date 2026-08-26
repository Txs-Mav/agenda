/**
 * Document offscreen — le service worker n'a pas de DOM ; lui, oui.
 * Il reçoit le HTML des pages relues en arrière-plan et rend des structures
 * déjà parsées, avec exactement les mêmes parseurs que le content script.
 *
 * Le HTML est injecté dans le DOM vivant (et pas via DOMParser) parce que
 * parseCard lit des LIGNES, donc innerText, qui n'existe qu'avec une mise en
 * page. Avant l'injection, tout ce qui exécute ou charge est neutralisé :
 * scripts et iframes retirés, chaque src débranché.
 */
"use strict";

function renduVivant(html) {
  const propre = (html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe[\s\S]*?(?:<\/iframe>|\/>)/gi, "")
    .replace(/<link[^>]*>/gi, "")
    .replace(/\ssrc\s*=/gi, " data-src=");
  const box = document.createElement("div");
  box.style.position = "absolute";
  box.style.left = "-99999px";
  box.style.width = "1200px";
  document.body.appendChild(box);
  box.innerHTML = propre;
  return box;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen") return;
  let box = null;
  try {
    box = renduVivant(msg.html);
    const P = self.AgendaParsers;
    if (msg.kind === "accueil") {
      const deadlines = [];
      for (const card of P.readCards(box)) {
        const d = P.parseCard(card.lines);
        if (d) deadlines.push(d);
      }
      sendResponse({ deadlines });
    } else if (msg.kind === "mio") {
      const mios = [];
      for (const cells of P.readMioRows(box)) {
        const m = P.parseMioCells(cells);
        if (m) mios.push(m);
      }
      sendResponse({ mios });
    } else {
      sendResponse({ erreur: "kind inconnu" });
    }
  } catch (e) {
    sendResponse({ erreur: String(e && e.message ? e.message : e) });
  } finally {
    box?.remove();
  }
  return true;
});
