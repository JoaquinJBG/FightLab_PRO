import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Permite servir el dev server a través del túnel HTTPS (cloudflared) para
  // probar la PWA en el móvil sin avisos de origen cruzado.
  allowedDevOrigins: ["*.trycloudflare.com"],
};

export default nextConfig;
