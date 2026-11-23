import { afterEach, describe, expect, it, vi } from "vitest";
import { aiLimitCode, aiQuota, fetchAIQuota } from "./ai-quota";
import { ApiError } from "./hooks";

const SAMPLE = {
  date: "2026-10-22",
  coach: { limit: 50, used: 3, remaining: 47 },
  photo: { limit: null, used: 0, remaining: null },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("aiQuota", () => {
  it("acepta la respuesta del backend, con y sin límite", () => {
    expect(aiQuota.parse(SAMPLE)).toEqual(SAMPLE);
  });

  it("rechaza un cupo restante negativo", () => {
    expect(() => aiQuota.parse({ ...SAMPLE, coach: { limit: 5, used: 6, remaining: -1 } })).toThrow();
  });
});

describe("aiLimitCode", () => {
  it("reconoce los códigos estables de límite diario", () => {
    expect(aiLimitCode({ detail: "x", code: "quota_daily" })).toBe("quota_daily");
    expect(aiLimitCode({ detail: "x", code: "budget_daily" })).toBe("budget_daily");
  });

  it("ignora otros cuerpos", () => {
    expect(aiLimitCode({ detail: "saturado" })).toBeNull();
    expect(aiLimitCode({ code: "otro" })).toBeNull();
    expect(aiLimitCode(null)).toBeNull();
    expect(aiLimitCode("quota_daily")).toBeNull();
  });
});

describe("fetchAIQuota", () => {
  it("pide /api/proxy/ai/quota y valida la respuesta", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(SAMPLE), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchAIQuota()).resolves.toEqual(SAMPLE);
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/ai/quota", { credentials: "include" });
  });

  it("lanza ApiError con el status si el backend falla", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    await expect(fetchAIQuota()).rejects.toMatchObject({ status: 401 });
    await expect(fetchAIQuota()).rejects.toBeInstanceOf(ApiError);
  });
});
