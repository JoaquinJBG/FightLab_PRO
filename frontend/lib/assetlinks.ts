// Digital Asset Links de la app Android (TWA, mobile/twa/). Chrome pide /.well-known/assetlinks.json
// para comprobar que el APK instalado es de este dominio; si falla, la app abre con barra de direcciones.
// El SHA-256 del certificado de firma es público: va en ANDROID_CERT_SHA256 (Vercel), así cambiar de
// llave no pide cambiar código. Varios, separados por comas.

export const DEFAULT_ANDROID_PACKAGE = "app.fightlab.pro";
const PACKAGE_RE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/;

/** 32 bytes en hex, con o sin «:», en cualquier caja → «AA:BB:…». `null` si no vale. */
export function normalizeFingerprint(raw: string): string | null {
  const hex = raw.trim().replace(/:/g, "");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null;
  return (hex.toUpperCase().match(/../g) as string[]).join(":");
}

/** Contenido de assetlinks.json. Sin ninguna huella válida devuelve `[]`. */
export function buildAssetLinks(sha256: string | undefined, pkg: string | undefined) {
  const fingerprints = (sha256 ?? "")
    .split(",")
    .map(normalizeFingerprint)
    .filter((f): f is string => f !== null);
  if (fingerprints.length === 0) return [];
  const clean = pkg?.trim();
  const packageName = clean && PACKAGE_RE.test(clean) ? clean : DEFAULT_ANDROID_PACKAGE;
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: { namespace: "android_app", package_name: packageName, sha256_cert_fingerprints: fingerprints },
    },
  ];
}
