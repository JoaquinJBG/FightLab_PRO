/**
 * Reglas de validación del proxy del BFF (app/api/proxy/[...path]/route.ts),
 * separadas en funciones puras para poder probarlas sin un Request real.
 */

// Allowlist estricta: solo caracteres "unreserved" de una URL. Next entrega los
// segmentos ya decodificados, así que un intento de traversal como "..%09" o
// "..%0A" llega aquí como ".." + un TAB o salto de línea real. El parser de
// URL de fetch (WHATWG) descarta esos TAB/CR/LF al construir la URL final, lo
// que reintroduce el ".." y permite escapar de /api/v1 (o alcanzar /admin, la
// raíz del origen…) arrastrando el Bearer del usuario. Con esta allowlist esos
// caracteres (y "?", "#", que delimitarían query/fragment) quedan rechazados
// aquí, antes de que el segmento llegue a construirse en la URL.
const SAFE_SEGMENT = /^[A-Za-z0-9._~-]+$/;

/** Un segmento de ruta no puede ser vacío, "." o ".." (traversal) ni contener
 * ningún carácter fuera de la allowlist (separadores, "%", control chars,
 * "?", "#"…). */
export function isSegmentSafe(segment: string): boolean {
  if (segment === "." || segment === "..") return false;
  return SAFE_SEGMENT.test(segment);
}

export function isPathSafe(segments: string[]): boolean {
  return segments.length > 0 && segments.every(isSegmentSafe);
}

/**
 * El proxy solo debe poder llegar a estos prefijos de /api/v1/*. Sin esta
 * lista, cualquier ruta (incluida /admin) sería alcanzable reenviando el
 * Bearer del usuario que hizo login.
 */
export const ALLOWED_PREFIXES = ["me", "activities", "ai", "health"] as const;

export function isPrefixAllowed(segments: string[]): boolean {
  return segments.length > 0 && (ALLOWED_PREFIXES as readonly string[]).includes(segments[0]);
}

export const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024;

export function isBodyTooLarge(
  contentLength: string | null,
  maxBytes: number = MAX_PROXY_BODY_BYTES,
): boolean {
  if (!contentLength) return false;
  const n = Number(contentLength);
  if (!Number.isFinite(n)) return false;
  return n > maxBytes;
}

const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Defensa CSRF ligera: en los métodos que mutan, si el navegador manda
 * Origin, debe coincidir con el propio host del BFF. Si no manda Origin
 * (clientes que no son navegador) se deja pasar, porque no es una señal
 * fiable de ataque.
 */
export function isOriginAllowed(method: string, origin: string | null, selfOrigin: string): boolean {
  if (!MUTATING_METHODS.has(method.toUpperCase())) return true;
  if (!origin) return true;
  return origin === selfOrigin;
}

/**
 * Traduce la Response cruda de Django a la Response que el BFF le devuelve
 * al navegador.
 *
 * - 204/205 no llevan cuerpo: `NextResponse.json()` no admite estos códigos
 *   (lanza "Invalid response status code"), así que se construye una
 *   Response vacía a mano. Sin esto, borrar una biometría o una foto (que
 *   Django responde con 204) daba 500 en la interfaz.
 * - JSON (o sin content-type): se parsea y se reenvía como JSON, igual que
 *   antes.
 * - Cualquier otro content-type (fotos y otros binarios): se reenvía en
 *   streaming, sin bufferizar el cuerpo entero en memoria, conservando
 *   content-type, cache-control y content-length.
 */
export async function buildProxyResponse(upstream: Response): Promise<Response> {
  if (upstream.status === 204 || upstream.status === 205) {
    return new Response(null, { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type") ?? "";
  if (contentType === "" || contentType.includes("application/json")) {
    let data: unknown = null;
    const text = await upstream.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return Response.json(data ?? {}, { status: upstream.status });
  }

  const headers = new Headers();
  headers.set("content-type", contentType);
  const cacheControl = upstream.headers.get("cache-control");
  if (cacheControl) headers.set("cache-control", cacheControl);
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) headers.set("content-length", contentLength);
  return new Response(upstream.body, { status: upstream.status, headers });
}

/**
 * Decodifica (sin verificar firma) el payload de un JWT para leer su "exp".
 * Se usa solo para decidir si hay que limpiar las cookies de sesión tras un
 * refresh fallido: Django es quien de verdad valida el token.
 */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("JWT con formato inválido");
  const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

/**
 * Un refresh token se considera "seguro de invalidar" (limpiar sus cookies)
 * solo si está expirado o mal formado. Si no, un 401 puntual en /auth/refresh
 * (red, 500 de Django…) no debe desloguear al usuario: la próxima petición
 * puede reintentarlo con el mismo refresh, que sigue siendo válido.
 */
export function isRefreshTokenExpiredOrMalformed(token: string): boolean {
  try {
    const payload = decodeJwtPayload(token);
    if (typeof payload.exp !== "number") return true;
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}
