import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Roboto_Flex } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "./sw-register";
import { BackgroundFx } from "@/components/background-fx";
import { QueryProvider } from "@/lib/query-provider";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

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

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("meta");
  return {
    title: "FightLab Pro",
    description: t("description"),
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/icon.svg", type: "image/svg+xml" },
        { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "FightLab Pro",
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#05070e",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full">
        <BackgroundFx />
        <NextIntlClientProvider>
          <QueryProvider>{children}</QueryProvider>
        </NextIntlClientProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
