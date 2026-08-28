import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

/* L'adresse canonique. Elle sert aux balises Open Graph, qui exigent des URL
   absolues — un chemin relatif ne s'affiche pas dans un aperçu de lien. */
const SITE = "https://agenda-five-sigma.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: {
    default: "Agenda Cégep — ton horaire, tes échéances et tes MIO au même endroit",
    template: "%s · Agenda Cégep",
  },
  description:
    "Tes notes, tes MIO, tes échéances, ton horaire et tes Moodle regroupés dans "
    + "un seul agenda, collectés automatiquement. Et ta classe au complet : "
    + "discussions, notes partagées, documents annotés.",
  applicationName: "Agenda Cégep",
  keywords: ["agenda cégep", "Omnivox", "Léa", "MIO", "Moodle", "horaire", "cégep", "Québec"],
  openGraph: {
    type: "website",
    locale: "fr_CA",
    siteName: "Agenda Cégep",
    url: SITE,
    title: "Tout ton cégep, au même endroit.",
    description:
      "Horaire, échéances, MIO et Moodle collectés automatiquement — et ta classe au complet.",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8FA" },
    { media: "(prefers-color-scheme: dark)", color: "#0C0D10" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    /* Aucun data-theme, aucun script : vitrine.css reflète ses règles sombres
       sous prefers-color-scheme, donc le système décide et le premier rendu
       est déjà le bon. Rien à hydrater, rien à faire clignoter. */
    <html lang="fr-CA">
      <body>{children}</body>
    </html>
  );
}
