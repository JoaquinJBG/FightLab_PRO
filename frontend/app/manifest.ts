import type { MetadataRoute } from "next";
import { getTranslations } from "next-intl/server";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const t = await getTranslations("meta");
  const tToday = await getTranslations("today.shortcuts");
  // Sustituto del widget de ParteDiario (fase 11): pulsación larga en el icono de la app.
  const shortcut = (name: string, url: string, icon: string) => ({
    name,
    short_name: name,
    url,
    icons: [
      { src: `/${icon}.png`, sizes: "96x96", type: "image/png" },
      { src: `/${icon}.svg`, sizes: "any", type: "image/svg+xml" },
    ],
  });
  return {
    name: "FightLab Pro",
    short_name: "FightLab",
    description: t("manifestDescription"),
    start_url: "/today",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#05070e",
    theme_color: "#05070e",
    // F16: el icono dice «FL», como el logo de la app, en todos los tamaños y con su versión
    // «maskable» (fondo a sangre y letras en la zona segura) para los iconos adaptables de Android.
    // Los PNG salen de los SVG con `node scripts/icons.mjs`.
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
      // PNG rasterizados: iOS y algunos instaladores de Android no aceptan SVG.
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      shortcut(tToday("today"), "/today", "shortcut-today"),
      shortcut(tToday("weigh"), "/today#weight", "shortcut-weigh"),
      shortcut(tToday("nextMeal"), "/today#next-meal", "shortcut-meal"),
    ],
  };
}
