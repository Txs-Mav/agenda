/**
 * Parseurs partagés — ports directs de src/scrape/evenements.ts, collect.ts
 * et table.ts. Les fonctions travaillent sur un `root` (Document réel dans le
 * content script, Document issu de DOMParser dans l'offscreen), et les
 * identifiants produits sont IDENTIQUES à ceux du scraper local : mêmes
 * graines, même hachage — une échéance vue par les deux n'existe qu'une fois.
 */
(function (global) {
  "use strict";

  const hash36 = (prefix, seed) =>
    prefix + [...seed].reduce((a, c) => ((a * 31 + c.charCodeAt(0)) >>> 0), 7).toString(36);

  const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin",
                "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  const strip = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

  /* ---- Cartes d'évènement (accueil Léa, vue par mois) ------------------- */

  function readCards(root) {
    const clean = (el) =>
      (el.innerText || el.textContent || "").split("\n").map((l) => l.trim()).filter(Boolean);

    const cards = [...root.querySelectorAll(".carte-evenement")];
    if (cards.length) return cards.map((el) => ({ lines: clean(el) }));

    // Repli si la classe change : remonter depuis les blocs de type colorés
    // jusqu'à l'ancêtre qui porte une date (même logique que evenements.ts).
    const MOISRE = /janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre/i;
    const types = [...root.querySelectorAll("[class*='couleur_TRAV'],[class*='couleur_EVAL']")];
    const seen = new Set();
    const out = [];
    for (const t of types) {
      let el = t;
      for (let i = 0; i < 6 && el; i++) {
        if (MOISRE.test(el.innerText || el.textContent || "")) break;
        el = el.parentElement;
      }
      if (el && !seen.has(el)) { seen.add(el); out.push(el); }
    }
    return out.map((el) => ({ lines: clean(el) }));
  }

  /** Une carte → une échéance, ou null. Port verbatim de parseCard. */
  function parseCard(lines, today = new Date()) {
    const dayLine = lines.find((l) => /^\d{1,2}$/.test(l));
    const monthLine = lines.find((l) => MOIS.some((m) => strip(m) === strip(l)));
    if (!dayLine || !monthLine) return null;
    const day = Number(dayLine);
    const mIdx = MOIS.findIndex((m) => strip(m) === strip(monthLine));
    if (mIdx < 0 || !day) return null;

    let year = today.getFullYear();
    if ((today.getTime() - new Date(year, mIdx, day).getTime()) / 864e5 > 90) year += 1;
    const date = `${year}-${String(mIdx + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

    const timeLine = lines.find((l) => /^\d{1,2}\s*[h:]\s*\d{2}$/.test(l));
    const tm = timeLine ? /(\d{1,2})\s*[h:]\s*(\d{2})/.exec(timeLine) : null;
    const time = tm ? `${tm[1].padStart(2, "0")}:${tm[2]}` : "";

    const typeLine = lines.find((l) => /travail\s+à\s+remettre|évaluation/i.test(l)) ?? "";
    const isExam = /évaluation/i.test(typeLine);
    const weight = /\((\d+(?:[.,]\d+)?)\s*%\)/.exec(typeLine)?.[1] ?? "";

    const codeIdx = lines.findIndex((l) => /\d{3}-\w{3}-\w{2}/.test(l));
    if (codeIdx < 0) return null;
    const code = /(\d{3}-\w{3}-\w{2})/.exec(lines[codeIdx])?.[1] ?? "";
    const course = lines[codeIdx - 1] ?? "";
    const title = lines.slice(codeIdx + 1).join(" ").trim();
    if (!title) return null;

    return {
      id: hash36("e", code + title + date),
      t: weight ? `${title} (${weight} %)` : title,
      course, date, time,
      kind: isExam ? "examen" : "remise",
      src: "lea", code, done: false,
    };
  }

  /* ---- Boîte de réception MIO (#lstMIO) --------------------------------- */

  function readMioRows(root) {
    const clean = (x) => (x || "").replace(/\s+/g, " ").trim();
    const t = root.querySelector("#lstMIO");
    if (!t) return [];
    return [...t.querySelectorAll("tr")]
      .map((tr) => [...tr.querySelectorAll("td")].map((td) => clean(td.textContent)).filter(Boolean))
      .filter((cells) => cells.length >= 3);
  }

  /** Convertit « 12 septembre 2026 », « 2026-09-12 » ou « 12/09/2026 ». */
  function toISODate(raw, fallbackYear = new Date().getFullYear()) {
    const s = raw.trim();
    let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
    if (m) return `${m[3]}-${String(m[2]).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
    const ABBR = ["janv", "févr", "mars", "avr", "mai", "juin", "juil", "août", "sept", "octo", "nove", "déce"];
    m = /(\d{1,2})\s+([a-zà-ÿ]+)\.?\s*(\d{4})?/i.exec(s);
    if (m) {
      const norm = strip(m[2] ?? "");
      const idx = ABBR.findIndex((x) => norm.startsWith(strip(x)));
      if (idx >= 0) {
        const y = m[3] ? Number(m[3]) : fallbackYear;
        return `${y}-${String(idx + 1).padStart(2, "0")}-${String(m[1]).padStart(2, "0")}`;
      }
    }
    return "";
  }

  /** Une ligne de la liste → un MIO, ou null. Port de collectMios. */
  function parseMioCells(cells) {
    const dateLike = (c) => /^\d{1,2}\s*[h:]\s*\d{2}$/.test(c)
      || /^\d{1,2}\s+(janv|févr|mars|avr|mai|juin|juil|août|sept|octo|nove|déce)/i.test(c)
      || /\d{4}-\d{2}-\d{2}/.test(c)
      || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(c);
    const status = cells.find((c) => /message\s+(lu|non\s*lu)/i.test(c)) ?? "";
    const when = cells.find(dateLike) ?? "";
    const rest = cells.filter((c) =>
      c !== status && !dateLike(c) && !/catégoriser|supprimer|répondre|transférer/i.test(c));
    if (!rest.length) return null;
    const sorted = [...rest].sort((a, b) => a.length - b.length);
    const from = sorted[0] ?? "";
    const subject = sorted[sorted.length - 1] ?? "";
    if (!from || !subject || from === subject) return null;

    const isTime = /^\d{1,2}\s*[h:]\s*\d{2}$/.test(when);
    const date = isTime ? new Date().toISOString().slice(0, 10)
      : (toISODate(when) || new Date().toISOString().slice(0, 10));

    return {
      id: hash36("s", from + subject + date),
      from, course: "", date, subject,
      summary: subject,
    };
  }

  global.AgendaParsers = { readCards, parseCard, readMioRows, parseMioCells, toISODate, hash36 };
})(typeof self !== "undefined" ? self : window);
