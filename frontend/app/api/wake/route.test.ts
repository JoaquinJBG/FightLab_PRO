// @vitest-environment node
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("@/lib/api", () => ({
  DJANGO_ORIGIN: "https://api.example.test",
  assertDjangoConfigured: () => {},
}));

const fetchMock = vi.fn();

describe("GET /api/wake", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("llama a <origen>/health, responde {ok, ms} y no cachea", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const { GET } = await import("./route");
    const res = await GET();

    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example.test/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.ms).toBe("number");
  });

  test("timeout de ~60 s y maxDuration 60", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const mod = await import("./route");
    await mod.GET();

    expect(mod.maxDuration).toBe(60);
    expect(timeoutSpy).toHaveBeenCalledWith(mod.TIMEOUT_MS);
    expect(mod.TIMEOUT_MS).toBeGreaterThanOrEqual(55_000);
    expect(mod.TIMEOUT_MS).toBeLessThan(60_000);
  });

  test("Django responde error: 503 sin datos internos", async () => {
    fetchMock.mockResolvedValue(new Response("boom secret", { status: 500 }));
    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: false });
  });

  test("fallo de red o timeout: 503 sin filtrar el error", async () => {
    fetchMock.mockRejectedValue(new DOMException("conn refused api.example.test", "TimeoutError"));
    const { GET } = await import("./route");
    const res = await GET();

    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain("example");
  });

  test("sin DJANGO_API_URL en producción: 503 sin llamar a nadie", async () => {
    vi.doMock("@/lib/api", () => ({
      DJANGO_ORIGIN: "x",
      assertDjangoConfigured: () => {
        throw new Error("falta");
      },
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("./route");

    expect((await GET()).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("sin auth (fuera del matcher de proxy.ts) y el SW no cachea /api/", async () => {
    const { config } = await import("@/proxy");
    expect(config.matcher.some((m: string) => m.startsWith("/api"))).toBe(false);
    expect(readFileSync("public/sw.js", "utf8")).toMatch(/startsWith\("\/api\/"\)\) return/);
  });
});
