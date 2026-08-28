"use strict";

const el = (id) => document.getElementById(id);

const quand = (iso) => {
  if (!iso) return "aucune encore";
  const t = new Date(iso);
  const memeJour = t.toDateString() === new Date().toDateString();
  const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  return memeJour ? hm : `${t.getDate()}/${t.getMonth() + 1} ${hm}`;
};

/* « cegeptr.omnivox.ca » se lit mal dans une colonne étroite, et c'est le
   sous-domaine qui identifie le cégep. */
const nomCegep = (hote) => (hote ? hote.replace(/\.omnivox\.ca$/i, "") : "à découvrir");

let derniereVue = { hote: "", compte: null };

async function rafraichir() {
  const st = await chrome.storage.local.get({
    deadlines: {}, mios: {}, lastScrape: "", health: {},
    hote: "", compte: null, indiceEmail: "",
  });
  derniereVue = { hote: st.hote, compte: st.compte };
  const h = st.health || {};

  const s = el("session");
  if (h.session === "ok") { s.textContent = "active"; s.className = "val etat-ok"; }
  else if (h.session === "expiree") { s.textContent = "à refaire"; s.className = "val etat-ko"; }
  else { s.textContent = "inconnue"; s.className = "val"; }

  el("hote").textContent = nomCegep(st.hote);
  el("quand").textContent = quand(st.lastScrape);
  el("n-ech").textContent = String(Object.keys(st.deadlines).length);
  el("n-mio").textContent = String(Object.keys(st.mios).length);
  const r = el("raison");
  r.hidden = !h.raison;
  r.textContent = h.raison || "";

  // Le compte : connecté, on montre l'état de l'envoi ; sinon, le formulaire.
  const connecte = !!(st.compte && st.compte.rt);
  el("carte-compte").hidden = !connecte;
  el("carte-connexion").hidden = connecte;

  if (connecte) {
    el("compte-mail").textContent = st.compte.email || "connecté";
    const n = el("nuage");
    if (h.nuage === "ok") {
      n.textContent = h.nuageQuand ? quand(h.nuageQuand) : "à jour";
      n.className = "val etat-ok";
    } else if (h.nuage === "erreur") {
      n.textContent = "en attente"; n.className = "val etat-ko";
    } else {
      n.textContent = "—"; n.className = "val";
    }
    const nr = el("nuage-raison");
    nr.hidden = !h.nuageRaison;
    nr.textContent = h.nuageRaison || "";
  } else if (st.indiceEmail && !el("email").value) {
    // Déjà connecté sur le tableau de bord : on propose le même courriel.
    el("email").value = st.indiceEmail;
  }
}

el("carte-connexion").addEventListener("submit", async (e) => {
  e.preventDefault();
  const b = el("connecter");
  const err = el("erreur");
  const email = el("email").value.trim();
  const motDePasse = el("motdepasse").value;
  if (!email || !motDePasse) return;

  b.disabled = true;
  b.textContent = "Connexion…";
  err.hidden = true;
  let rep;
  try {
    rep = await chrome.runtime.sendMessage({ type: "connexion", email, motDePasse });
  } catch {
    rep = { erreur: "Extension rechargée — rouvre ce popup." };
  }
  b.disabled = false;
  b.textContent = "Se connecter";
  if (rep && rep.erreur) {
    err.textContent = rep.erreur;
    err.hidden = false;
    return;
  }
  el("motdepasse").value = "";   // rien ne traîne dans le champ
  await rafraichir();
});

el("deconnecter").addEventListener("click", async () => {
  const b = el("deconnecter");
  b.disabled = true;
  try { await chrome.runtime.sendMessage({ type: "deconnexion" }); } catch {}
  b.disabled = false;
  await rafraichir();
});

el("collecter").addEventListener("click", async () => {
  const b = el("collecter");
  b.disabled = true;
  b.textContent = "Collecte…";
  try { await chrome.runtime.sendMessage({ type: "collect-now" }); } catch {}
  await rafraichir();
  b.disabled = false;
  b.textContent = "Collecter maintenant";
});

/* Sans passage sur Omnivox, on ne connaît pas encore le cégep : la page
   d'accueil d'Omnivox laisse le choisir, et le prochain chargement nous
   apprendra l'adresse. */
el("omnivox").addEventListener("click", () => {
  const url = derniereVue.hote ? `https://${derniereVue.hote}/intr/` : "https://www.omnivox.ca/";
  chrome.tabs.create({ url });
});

rafraichir();
chrome.storage.onChanged.addListener(rafraichir);
