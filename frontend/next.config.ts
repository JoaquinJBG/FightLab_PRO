import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

const nextConfig: NextConfig = {
  // Permite servir el dev server a través del túnel HTTPS (cloudflared) para
  // probar la PWA en el móvil sin avisos de origen cruzado.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default withNextIntl(nextConfig);
