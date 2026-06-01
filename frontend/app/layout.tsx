import type { Metadata, Viewport } from "next";
import { Chakra_Petch, Sora } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "./sw-register";

const display = Chakra_Petch({
  variable: "--ff-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const body = Sora({
  variable: "--ff-body",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
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
    <html
      lang="es"
      className={`${display.variable} ${body.variable} h-full antialiased`}
    >
      <body className="min-h-full">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
