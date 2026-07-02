const BASE = process.env.DJANGO_API_URL ?? "http://127.0.0.1:8001/api/v1";
// Origen del backend (sin /api/v1) para servir archivos de /media
export const DJANGO_ORIGIN = BASE.replace(/\/api\/v1\/?$/, "");

export type ApiResult = { status: number; data: unknown };

export async function djangoFetch(
  path: string,
  opts: { method?: string; body?: unknown; access?: string | null } = {},
): Promise<ApiResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.access) headers.Authorization = `Bearer ${opts.access}`;
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
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

/** POST multipart (subida de archivos). fetch pone solo el boundary correcto. */
export async function djangoUpload(
  path: string,
  form: FormData,
  access?: string | null,
  method = "POST",
): Promise<ApiResult> {
  const headers: Record<string, string> = {};
  if (access) headers.Authorization = `Bearer ${access}`;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: form,
    cache: "no-store",
  });
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
