/**
 * Reglas de validación del proxy del BFF (app/api/proxy/[...path]/route.ts),
 * separadas en funciones puras para poder probarlas sin un Request real.
 */

const FORBIDDEN_CHARS = /[/\\%]/;

/** Un segmento de ruta no puede ser vacío, "." o ".." (traversal) ni contener
 * separadores o "%" (para evitar un doble-decodificado que reintroduzca "/"). */
export function isSegmentSafe(segment: string): boolean {
  if (segment.length === 0) return false;
  if (segment === "." || segment === "..") return false;
  if (FORBIDDEN_CHARS.test(segment)) return false;
  return true;
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
