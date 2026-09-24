const DEV_FALLBACK_BASE = "http://127.0.0.1:8001/api/v1";

// Se calcula de forma perezosa (nunca al importar el módulo): Next importa
// este archivo al recopilar los datos de las rutas durante `next build`,
// mucho antes de que exista una petición real y sin que las variables de
// entorno de producción tengan por qué estar presentes en esa máquina. Si
// lanzáramos aquí arriba, `next build` fallaría siempre que falte
// DJANGO_API_URL, aunque nadie vaya a servir tráfico con ese build.
const envUrl = process.env.DJANGO_API_URL || null;
const BASE = envUrl ?? DEV_FALLBACK_BASE;
// Origen del backend (sin /api/v1) para servir /media y /health
export const DJANGO_ORIGIN = BASE.replace(/\/api\/v1\/?$/, "");

/**
 * En producción, sin DJANGO_API_URL el BFF quedaría hablando con localhost (o
 * fallando en silencio con ECONNREFUSED sin explicar por qué). Se comprueba
 * en cada petición real (no al importar el módulo) para dar un error claro
 * en los logs en cuanto llega tráfico, en vez de fallar el build o servir en
 * silencio contra el backend equivocado.
 */
export function assertDjangoConfigured(): void {
  if (!envUrl && process.env.NODE_ENV === "production") {
    throw new Error(
      "Falta la variable de entorno DJANGO_API_URL en producción: el BFF no sabe a qué backend de Django conectarse.",
    );
  }
}

export type ApiResult = { status: number; data: unknown };

// Render (plan free) puede tardar hasta ~50 s en despertar tras un cold start;
// el margen deja tiempo de sobra sin colgar la función más allá de los 60 s
// de maxDuration del proxy.
const REQUEST_TIMEOUT_MS = 55_000;

export type RequestOpts = {
  method?: string;
  body?: BodyInit | null;
  headers?: Record<string, string>;
  access?: string | null;
  /** IP real del cliente (X-Forwarded-For), para que el throttling de Django no
   * agrupe a todos los usuarios bajo la IP del BFF. */
  forwardedFor?: string | null;
  /** Sobrescribe REQUEST_TIMEOUT_MS. Se usa para acortar el timeout de los
   * reintentos (refresh + reintento) del proxy: solo la primera petición
   * necesita margen para un cold start de Render; si Django ya respondió una
   * vez, ya está despierto y no hace falta esperar otros 55 s por reintento. */
  timeoutMs?: number;
};

/**
 * Petición cruda a Django: devuelve la Response sin consumir su cuerpo, para
 * que el proxy pueda reenviar en streaming las respuestas que no son JSON
 * (fotos, binarios) sin bufferizarlas enteras en memoria.
 */
export async function djangoRequest(path: string, opts: RequestOpts = {}): Promise<Response> {
  assertDjangoConfigured();
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.access) headers.Authorization = `Bearer ${opts.access}`;
  if (opts.forwardedFor) headers["X-Forwarded-For"] = opts.forwardedFor;
  return fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body,
    cache: "no-store",
    signal: AbortSignal.timeout(opts.timeoutMs ?? REQUEST_TIMEOUT_MS),
  });
}

async function toApiResult(res: Response): Promise<ApiResult> {
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { status: res.status, data };
}

export async function djangoFetch(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    access?: string | null;
    forwardedFor?: string | null;
    timeoutMs?: number;
    /** Cabeceras extra (p. ej. las de lib/auth-forward.ts para el throttle). */
    headers?: Record<string, string>;
  } = {},
): Promise<ApiResult> {
  const res = await djangoRequest(path, {
    method: opts.method,
    headers: { "Content-Type": "application/json", ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    access: opts.access,
    forwardedFor: opts.forwardedFor,
    timeoutMs: opts.timeoutMs,
  });
  return toApiResult(res);
}

/** POST/PUT/PATCH multipart (subida de archivos). fetch pone solo el boundary correcto. */
export async function djangoUpload(
  path: string,
  form: FormData,
  access?: string | null,
  method = "POST",
  forwardedFor?: string | null,
): Promise<ApiResult> {
  const res = await djangoRequest(path, { method, body: form, access, forwardedFor });
  return toApiResult(res);
}
