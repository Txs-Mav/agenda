/**
 * L'instance — LE seul fichier à modifier pour brancher l'agenda sur une
 * autre infrastructure (autre projet Supabase, autre paire de clés push).
 *
 * Chargé partout où ces valeurs vivaient en copies :
 *   - les pages : <script src="/config.js"> (agenda, classes, démo) ;
 *   - le service worker : importScripts("/config.js") ;
 *   - le collecteur Node : src/instance.ts, qui importe ce fichier tel quel ;
 *   - l'extension Chrome : une COPIE (extension/config.js), rafraîchie par
 *     `npm run ext:zip`. Son manifest.json répète l'URL Supabase dans
 *     host_permissions — un manifeste est statique, celui-là se change à la
 *     main.
 *
 * Aucun secret ici : ces trois valeurs sont publiques par conception.
 * La clé VAPID PRIVÉE, elle, ne vit que dans .env.
 */
globalThis.AGENDA_CONFIG = {
  /* Le projet Supabase de cette instance (URL + clé publiable, RLS active). */
  supabaseUrl: "https://olkbhrbyubejetqygdcy.supabase.co",
  supabaseCleAnon: "sb_publishable_3aYnT7wlRlEEzraSpmgbVA_WytRBC3X",

  /* La moitié publique de la paire VAPID (npx web-push generate-vapid-keys).
     Si la paire change, chaque appareil devra se réabonner aux rappels. */
  vapidClePublique: "BIHAtHD8DrfmZAN_IRBhSi-LXS_ce0SEM0RzgS30avrEDFPygWXwYeIlRdlF1X5fkFNvfYhMjx0tGHrj-4bYOns",
};
