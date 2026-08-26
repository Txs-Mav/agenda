"use strict";

const el = (id) => document.getElementById(id);

const quand = (iso) => {
  if (!iso) return "aucune encore";
  const t = new Date(iso);
  const memeJour = t.toDateString() === new Date().toDateString();
  const hm = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
  return memeJour ? hm : `${t.getDate()}/${t.getMonth() + 1} ${hm}`;
};

async function rafraichir() {
  const st = await chrome.storage.local.get({ deadlines: {}, mios: {}, lastScrape: "", health: {} });
  const h = st.health || {};
  const s = el("session");
  if (h.session === "ok") { s.textContent = "active"; s.className = "etat-ok"; }
  else if (h.session === "expiree") { s.textContent = "à refaire"; s.className = "etat-ko"; }
  else { s.textContent = "inconnue"; s.className = ""; }
  el("quand").textContent = quand(st.lastScrape);
  el("n-ech").textContent = String(Object.keys(st.deadlines).length);
  el("n-mio").textContent = String(Object.keys(st.mios).length);
  const r = el("raison");
  r.hidden = !h.raison;
  r.textContent = h.raison || "";
}

el("collecter").addEventListener("click", async () => {
  const b = el("collecter");
  b.disabled = true;
  b.textContent = "Collecte…";
  try { await chrome.runtime.sendMessage({ type: "collect-now" }); } catch {}
  await rafraichir();
  b.disabled = false;
  b.textContent = "Collecter maintenant";
});

el("omnivox").addEventListener("click", () => {
  chrome.tabs.create({ url: "https://cegeptr.omnivox.ca/intr/" });
});

rafraichir();
chrome.storage.onChanged.addListener(rafraichir);
