// @vitest-environment node
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/api", () => ({
  DJANGO_ORIGIN: "https://api.example.test",
  assertDjangoConfigured: () => {},
}));

const fetchMock = vi.fn();

describe("GET /api/proxy/health", () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("usa un timeout de 10 s y maxDuration ≤ 15", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const mod = await import("./route");

    expect(mod.maxDuration).toBeLessThanOrEqual(15);
    await mod.GET();
    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
  });

  test("cachea un OK unos segundos y no vuelve a llamar a Django", async () => {
    fetchMock.mockResolvedValue(new Response("ok", { status: 200 }));
    const { GET } = await import("./route");

    expect((await GET()).status).toBe(204);
    expect((await GET()).status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("un fallo no se cachea", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("t", "TimeoutError"));
    fetchMock.mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const { GET } = await import("./route");

    expect((await GET()).status).toBe(502);
    expect((await GET()).status).toBe(204);
  });
});
