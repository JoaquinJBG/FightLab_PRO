import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Roboto_Flex } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "./sw-register";
import { BackgroundFx } from "@/components/background-fx";

// Títulos / banners / números — clon libre de Google Sans
const display = Plus_Jakarta_Sans({
  variable: "--ff-display",
  subsets: ["latin"],
  weight: ["500", "700"],
});

// Cuerpo / UI pequeña — clon libre de Roboto
const body = Roboto_Flex({
  variable: "--ff-body",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "FightLab Pro",
  description:
    "Plataforma de alto rendimiento para atletas de combate: carga de entrenamiento, nutrición y coach IA.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "FightLab Pro",
  },
};

export const viewport: Viewport = {
  themeColor: "#05070e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full">
        <BackgroundFx />
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
