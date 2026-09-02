/**
 * Pont vers public/config.js — la configuration d'instance (URL Supabase,
 * clé publiable, clé VAPID publique), la même que chargent les pages, le
 * service worker et l'extension. Une seule vérité, zéro secret : la clé
 * VAPID privée reste dans .env.
 */
import "../public/config.js";

type ConfigInstance = {
  supabaseUrl: string;
  supabaseCleAnon: string;
  vapidClePublique: string;
};

export const INSTANCE = (globalThis as unknown as { AGENDA_CONFIG: ConfigInstance }).AGENDA_CONFIG;
