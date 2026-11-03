import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callWithRetry, isAuthorized } from "@/lib/cron";

// La ruta llama a Django con djangoRequest; aquí se sustituye para ver qué manda y simular a
// Render dormido. Nunca sale nada a la red.
const django = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/api", () => ({ djangoRequest: django.request }));

import { GET } from "@/app/api/cron/tick/route";

const req = (auth?: string) => new Request("http://localhost/api/cron/tick", { headers: auth ? { authorization: auth } : {} });
const ok = (body: unknown = { enabled: true, sent: 2 }) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "cron-secreto-de-prueba");
  vi.stubEnv("BFF_SHARED_SECRET", "bff-secreto-de-prueba");
  django.request.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("isAuthorized", () => {
  it("solo vale `Bearer <secreto>` exacto", () => {
    expect(isAuthorized("Bearer abc", "abc")).toBe(true);
    expect(isAuthorized("Bearer abd", "abc")).toBe(false);
    expect(isAuthorized("bearer abc", "abc")).toBe(false);
    expect(isAuthorized("Bearer abc ", "abc")).toBe(false);
    expect(isAuthorized(null, "abc")).toBe(false);
    expect(isAuthorized("Bearer ", "")).toBe(false);
    expect(isAuthorized("Bearer undefined", undefined)).toBe(false);
  });
});

describe("/api/cron/tick", () => {
  it("sin CRON_SECRET está apagado", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await GET(req("Bearer "));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "cron_not_configured" });
    expect(django.request).not.toHaveBeenCalled();
  });

  it.each([undefined, "Bearer otro", "cron-secreto-de-prueba", "Basic cron-secreto-de-prueba"])(
    "con un secreto malo (%s) responde 401 y no llama al backend",
    async (auth) => {
      const res = await GET(req(auth));
      expect(res.status).toBe(401);
      expect(django.request).not.toHaveBeenCalled();
    },
  );

  it("sin BFF_SHARED_SECRET no puede hablar con el backend", async () => {
    vi.stubEnv("BFF_SHARED_SECRET", "");
    const res = await GET(req("Bearer cron-secreto-de-prueba"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ code: "bff_secret_missing" });
  });

  it("con el secreto bueno llama al backend con el secreto del BFF", async () => {
    django.request.mockResolvedValue(ok());
    const res = await GET(req("Bearer cron-secreto-de-prueba"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 200, attempts: 1, result: { enabled: true, sent: 2 } });
    const [path, opts] = django.request.mock.calls[0];
    expect(path).toBe("/cron/reminders");
    expect(opts.method).toBe("POST");
    expect(opts.headers["X-Bff-Secret"]).toBe("bff-secreto-de-prueba");
    expect(opts.timeoutMs).toBe(45_000);
  });

  it("si Render está despertando (502) reintenta y acaba bien", async () => {
    django.request.mockResolvedValueOnce(new Response("", { status: 502 })).mockResolvedValueOnce(ok());
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    const pending = GET(req("Bearer cron-secreto-de-prueba"));
    await vi.runAllTimersAsync();
    const res = await pending;
    vi.useRealTimers();
    expect(res.status).toBe(200);
    expect((await res.json()).attempts).toBe(2);
  });
});

describe("callWithRetry", () => {
  // Reloj falso: cada intento "tarda" lo que se le dice, sin esperar de verdad.
  function clock() {
    let t = 0;
    return { now: () => t, advance: (ms: number) => (t += ms), sleep: async (ms: number) => void (t += ms) };
  }
  const OPTS = { budgetMs: 55_000, attemptMs: 45_000, minAttemptMs: 5_000, pauseMs: 2_000 };

  it("un arranque en frío que agota el primer intento deja otro con lo que queda, sin pasar del presupuesto", async () => {
    const c = clock();
    const timeouts: number[] = [];
    const attempt = vi.fn(async (timeout: number) => {
      timeouts.push(timeout);
      c.advance(timeout); // se agota
      throw Object.assign(new Error("timeout"), { name: "TimeoutError" });
    });
    const result = await callWithRetry(attempt, { ...OPTS, now: c.now, sleep: c.sleep });
    expect(result.response).toBeNull();
    expect(result.error).toBe("TimeoutError");
    expect(timeouts).toEqual([45_000, 8_000]);
    expect(c.now()).toBeLessThanOrEqual(55_000);
  });

  it("no reintenta lo que no es 'aún dormido' (p. ej. un 403)", async () => {
    const c = clock();
    const attempt = vi.fn(async () => new Response("", { status: 403 }));
    const result = await callWithRetry(attempt, { ...OPTS, now: c.now, sleep: c.sleep });
    expect(result.response?.status).toBe(403);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("503 seguidos: devuelve el último sin pasar del presupuesto", async () => {
    const c = clock();
    const attempt = vi.fn(async (timeout: number) => {
      c.advance(Math.min(10_000, timeout)); // el timeout de cada intento lo corta
      return new Response("", { status: 503 });
    });
    const result = await callWithRetry(attempt, { ...OPTS, now: c.now, sleep: c.sleep });
    expect(result.response?.status).toBe(503);
    expect(result.attempts).toBe(attempt.mock.calls.length);
    expect(c.now()).toBeLessThanOrEqual(55_000);
  });
});
