/**
 * Les formats d'écran de démarrage iOS — UNE table pour deux consommateurs :
 * splash.mjs peint les PNG, build.mjs écrit les <link>. iOS exige l'image au
 * pixel près pour l'appareil, sinon il ouvre l'app sur un éclair blanc ; un
 * format absent d'ici, c'est cet éclair sur cet appareil-là.
 * [largeur en points, hauteur en points, densité]
 */
export const SPLASH = [
  // iPhone (portrait seul : l'écran d'accueil lance les PWA en portrait)
  [375, 667, 2],   // SE 2/3
  [414, 896, 2],   // XR, 11
  [375, 812, 3],   // X, XS, 11 Pro, mini
  [390, 844, 3],   // 12–15, 16e
  [393, 852, 3],   // 14 Pro, 15/16
  [402, 874, 3],   // 16 Pro
  [414, 896, 3],   // XS Max, 11 Pro Max
  [428, 926, 3],   // 12–14 Plus/Pro Max
  [430, 932, 3],   // 14–16 Plus, 15 Pro Max
  [440, 956, 3],   // 16 Pro Max
  // iPad (portrait ET paysage)
  [744, 1133, 2],  // mini 6/7
  [768, 1024, 2],  // 9,7 po
  [810, 1080, 2],  // 10,2 po
  [820, 1180, 2],  // Air 4/5, 10,9 po
  [834, 1112, 2],  // Air 3, Pro 10,5
  [834, 1194, 2],  // Pro 11
  [834, 1210, 2],  // Pro 11 M4
  [1024, 1366, 2], // Pro 12,9
  [1032, 1376, 2], // Pro 13 M4
];

const IPAD_MIN = 744;
export const nomSplash = (w, h, r, paysage) => `splash/${paysage ? "l" : "p"}-${w}x${h}@${r}.png`;

/** Chaque format rend son <link> ; les iPad en rendent deux (les deux sens). */
export function liensSplash() {
  const lien = (w, h, r, paysage) =>
    `<link rel="apple-touch-startup-image" media="screen and (device-width: ${w}px) and (device-height: ${h}px) and (-webkit-device-pixel-ratio: ${r}) and (orientation: ${paysage ? "landscape" : "portrait"})" href="/${nomSplash(w, h, r, paysage)}">`;
  return SPLASH.flatMap(([w, h, r]) =>
    w >= IPAD_MIN ? [lien(w, h, r, false), lien(w, h, r, true)] : [lien(w, h, r, false)],
  ).join("\n");
}
