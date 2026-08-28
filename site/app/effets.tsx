"use client";

import { useEffect } from "react";

/**
 * Les deux seuls comportements de la vitrine — le reste est du CSS.
 * Isolés dans un composant client pour que TOUT le markup reste rendu par le
 * serveur : c'est le point de l'exercice, la vitrine doit être lisible sans
 * exécuter une ligne de JavaScript.
 */
export default function Effets() {
  useEffect(() => {
    /* Révélation au défilement — amélioration, jamais condition d'affichage.
       Le CSS montre tout par défaut ; on ne cache (.rev) que ce qui est déjà
       hors de l'écran, donc invisible de toute façon. Ce qui est au-dessus de
       la ligne de flottaison n'est jamais touché : aucun clignotement, et une
       page sans JavaScript reste entièrement lisible. */
    let io: IntersectionObserver | null = null;
    if ("IntersectionObserver" in window
        && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      /* C'est l'observateur qui mesure, pas nous : sa première salve rapporte
         l'état de CHAQUE élément observé, après mise en page. Mesurer nous-
         mêmes au montage tombait trop tôt — en développement le CSS est
         injecté par JavaScript, la page n'était pas encore disposée, et tout
         se retrouvait marqué caché puis rerévélé aussitôt. Un clignotement. */
      io = new IntersectionObserver((entries) => {
        for (const en of entries) {
          const el = en.target as HTMLElement;
          if (en.isIntersecting) { el.classList.add("in"); io?.unobserve(el); }
          // Hors écran : on peut le cacher sans que personne ne le voie
          // partir, et il s'animera à son tour en arrivant.
          else if (!el.classList.contains("in")) el.classList.add("rev");
        }
      }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
      for (const e of document.querySelectorAll("[data-rev]")) io.observe(e);
    }

    /* Capture manquante : la rangée se replie au lieu d'afficher une image
       cassée. C'était un onerror inline dans agenda.html ; ici l'écouteur se
       pose après coup, et on rattrape aussi celles déjà en échec. */
    const imgs = [...document.querySelectorAll<HTMLImageElement>(".lp-row img")];
    const rate = (img: HTMLImageElement) => img.closest(".lp-row")?.classList.add("noimg");
    const surErreur = (e: Event) => rate(e.target as HTMLImageElement);
    for (const img of imgs) {
      img.addEventListener("error", surErreur);
      if (img.complete && img.naturalWidth === 0) rate(img);
    }

    return () => {
      io?.disconnect();
      for (const img of imgs) img.removeEventListener("error", surErreur);
    };
  }, []);

  return null;
}
