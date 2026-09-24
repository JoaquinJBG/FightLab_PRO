// @vitest-environment node
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("resolveBase / DJANGO_ORIGIN", () => {
  test("en producción sin DJANGO_API_URL, importar el módulo NO falla (next build no debe romperse)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DJANGO_API_URL", "");
    await expect(import("./api")).resolves.toBeDefined();
  });

  test("en producción sin DJANGO_API_URL, la primera petición real lanza un error claro", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DJANGO_API_URL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { djangoFetch, assertDjangoConfigured } = await import("./api");

    expect(() => assertDjangoConfigured()).toThrow(/DJANGO_API_URL/);
    await expect(djangoFetch("/me")).rejects.toThrow(/DJANGO_API_URL/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("en desarrollo sin DJANGO_API_URL, usa el backend local", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("DJANGO_API_URL", "");
    const { DJANGO_ORIGIN } = await import("./api");
    expect(DJANGO_ORIGIN).toBe("http://127.0.0.1:8001");
  });

  test("con DJANGO_API_URL en producción, se usa tal cual (sin /api/v1)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DJANGO_API_URL", "https://backend.onrender.com/api/v1");
    const { DJANGO_ORIGIN } = await import("./api");
    expect(DJANGO_ORIGIN).toBe("https://backend.onrender.com");
  });
});

describe("djangoFetch / djangoUpload", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("DJANGO_API_URL", "https://backend.test/api/v1");
  });

  test("reenvía X-Forwarded-For a Django", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { djangoFetch } = await import("./api");
    await djangoFetch("/activities", { method: "GET", forwardedFor: "203.0.113.9" });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Forwarded-For"]).toBe("203.0.113.9");
  });

  test("soporta PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    const { djangoFetch } = await import("./api");
    const result = await djangoFetch("/me/state/foo", { method: "PUT", body: { a: 1 } });

    expect(result.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PUT");
  });

  test("djangoUpload reenvía X-Forwarded-For y no fija Content-Type (FormData pone su boundary)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 1 }));
    vi.stubGlobal("fetch", fetchMock);

    const { djangoUpload } = await import("./api");
    const form = new FormData();
    form.set("file", new Blob(["x"]), "a.jpg");
    await djangoUpload("/me/photos", form, "token123", "POST", "203.0.113.9");

    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Forwarded-For"]).toBe("203.0.113.9");
    expect(headers.Authorization).toBe("Bearer token123");
    expect(headers["Content-Type"]).toBeUndefined();
  });

  test("aplica un timeout generoso (no cuelga más allá de maxDuration)", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { djangoRequest } = await import("./api");
    const res = djangoRequest("/health");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // No esperamos a que expire el timeout real (55 s); solo comprobamos que
    // se pasó una señal abortable al fetch.
    await expect(Promise.race([res, Promise.resolve("pending")])).resolves.toBe("pending");
  });
});
