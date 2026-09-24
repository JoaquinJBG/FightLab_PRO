import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// CSP pensada para encajar con Next (App Router): permite 'unsafe-inline' en
// estilo y script porque Next inyecta bootstrap y estilos inline en el HTML
// generado, y no usamos nonces. Las fuentes de next/font se autohospedan en
// el propio origen (se descargan en build), así que no hace falta abrir
// font-src a dominios externos. img-src admite blob: y data: por las fotos
// comprimidas en el cliente antes de subirlas.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: CSP },
  // Vercel ya sirve por HTTPS; refuerza que el navegador nunca baje a HTTP.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Solo en desarrollo: permite servir el dev server a través del túnel HTTPS
  // (cloudflared) para probar la PWA en el móvil sin avisos de origen cruzado.
  // En producción no aplica (Vercel sirve desde el dominio propio).
  ...(isProd ? {} : { allowedDevOrigins: ["*.trycloudflare.com"] }),
  async headers() {
    if (!isProd) return [];
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
