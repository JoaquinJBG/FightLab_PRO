// @vitest-environment node
//
// Tests a nivel de ruta del proxy genérico del BFF.
import { describe, test, expect, vi, beforeEach } from "vitest";

const cookieStore = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name)! } : undefined),
    set: (name: string, value: string) => {
      cookieStore.set(name, value);
    },
    delete: (name: string) => {
      cookieStore.delete(name);
    },
  }),
}));

const djangoRequest = vi.fn();
const djangoFetch = vi.fn();
vi.mock("@/lib/api", () => ({ djangoRequest, djangoFetch }));

const { POST } = await import("./route");

function fakeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeReq() {
  return new Request("https://app.example.com/api/proxy/me/state/foo", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.example.com" },
    body: JSON.stringify({ a: 1 }),
  });
}

function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) };
}

beforeEach(() => {
  cookieStore.clear();
  djangoRequest.mockReset();
  djangoFetch.mockReset();
});

describe("POST /api/proxy/[...path] — validación de ruta", () => {
  test("una ruta con traversal disfrazado ('..' + TAB) se rechaza con 404, sin llegar a llamar a Django", async () => {
    const req = new Request("https://app.example.com/api/proxy/me/x", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://app.example.com" },
      body: "{}",
    });
    const res = await POST(req, ctx(["me", "..\t", "auth", "login"]));

    expect(res.status).toBe(404);
    expect(djangoRequest).not.toHaveBeenCalled();
  });

  test("un fallo de red al hablar con Django se traduce a 502, no a un 500 sin manejar", async () => {
    cookieStore.set("fl_access", "access");
    djangoRequest.mockRejectedValueOnce(new TypeError("fetch failed"));

    const res = await POST(makeReq(), ctx(["me", "state", "foo"]));

    expect(res.status).toBe(502);
  });

  test("un timeout (AbortSignal.timeout) al hablar con Django se traduce a 504", async () => {
    cookieStore.set("fl_access", "access");
    djangoRequest.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));

    const res = await POST(makeReq(), ctx(["me", "state", "foo"]));

    expect(res.status).toBe(504);
  });
});

describe("POST /api/proxy/[...path] — refresh de sesión", () => {
  test("si el refresh falla porque el refresh token ya expiró, limpia las cookies", async () => {
    const expiredRefresh = fakeJwt({ exp: Math.floor(Date.now() / 1000) - 60 });
    cookieStore.set("fl_access", "access-vieja");
    cookieStore.set("fl_refresh", expiredRefresh);

    djangoRequest.mockResolvedValueOnce(jsonResponse({ detail: "token inválido" }, 401));
    djangoFetch.mockResolvedValueOnce({ status: 401, data: { detail: "expirado" } });

    const res = await POST(makeReq(), ctx(["me", "state", "foo"]));

    expect(res.status).toBe(401);
    expect(cookieStore.has("fl_access")).toBe(false);
    expect(cookieStore.has("fl_refresh")).toBe(false);
  });

  test("si el refresh falla por un motivo puntual (red, 500) con un refresh AÚN válido, NO borra las cookies", async () => {
    // Este es el caso del hallazgo de revisión: un fallo de /auth/refresh que
    // no significa que el refresh token en sí sea inválido (p. ej. una
    // petición concurrente lo rotó, o Django tuvo un fallo transitorio) no
    // debe desloguear al usuario.
    const validRefresh = fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 });
    cookieStore.set("fl_access", "access-vieja");
    cookieStore.set("fl_refresh", validRefresh);

    djangoRequest.mockResolvedValueOnce(jsonResponse({ detail: "token inválido" }, 401));
    djangoFetch.mockResolvedValueOnce({ status: 500, data: null });

    const res = await POST(makeReq(), ctx(["me", "state", "foo"]));

    expect(res.status).toBe(401);
    expect(cookieStore.get("fl_access")).toBe("access-vieja");
    expect(cookieStore.get("fl_refresh")).toBe(validRefresh);
  });

  test("si el refresh funciona, reintenta la petición original con el access nuevo", async () => {
    cookieStore.set("fl_access", "access-vieja");
    cookieStore.set("fl_refresh", fakeJwt({ exp: Math.floor(Date.now() / 1000) + 3600 }));

    djangoRequest
      .mockResolvedValueOnce(jsonResponse({ detail: "token inválido" }, 401))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200));
    djangoFetch.mockResolvedValueOnce({
      status: 200,
      data: { access: "access-nueva", refresh: "refresh-nueva" },
    });

    const res = await POST(makeReq(), ctx(["me", "state", "foo"]));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(cookieStore.get("fl_access")).toBe("access-nueva");
    expect(cookieStore.get("fl_refresh")).toBe("refresh-nueva");
    expect(djangoRequest).toHaveBeenCalledTimes(2);
  });
});
