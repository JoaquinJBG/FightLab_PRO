import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  mergeByClientId,
  pendingQueueItems,
  enqueueActivity,
  resetActivityUid,
  cachedActivityUid,
  fetchServerActivities,
  fetchServerMetrics,
  type ServerActivity,
} from "./activities";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("mergeByClientId", () => {
  test("dedupe por client_id: el último grupo gana", () => {
    const local = [{ client_id: "a", v: "local" }, { client_id: "b", v: "local" }];
    const server = [{ client_id: "a", v: "server" }];
    const merged = mergeByClientId(local, server);
    expect(merged).toHaveLength(2);
    expect(merged.find((m) => m.client_id === "a")?.v).toBe("server");
    expect(merged.find((m) => m.client_id === "b")?.v).toBe("local");
  });

  test("los items sin client_id se conservan sin deduplicar (legacy)", () => {
    const local: { client_id?: string; v: number }[] = [{ v: 1 }, { v: 2 }];
    const merged = mergeByClientId(local);
    expect(merged).toHaveLength(2);
  });

  test("grupos vacíos no rompen nada", () => {
    expect(mergeByClientId([], [])).toEqual([]);
  });
});

describe("pendingQueueItems", () => {
  beforeEach(() => { localStorage.clear(); resetActivityUid(); });

  test("filtra por kind y no duplica entre anon y el uid cacheado", () => {
    localStorage.setItem("flp_uid", "42");
    localStorage.setItem(
      "flp_pending_acts_42",
      JSON.stringify([{ client_id: "x", kind: "SPORT", started_at: "2026-01-01T00:00:00Z", duration_sec: 60 }]),
    );
    localStorage.setItem(
      "flp_pending_acts_anon",
      JSON.stringify([
        { client_id: "x", kind: "SPORT", started_at: "2026-01-01T00:00:00Z", duration_sec: 60 }, // mismo id: no duplica
        { client_id: "y", kind: "MMA", started_at: "2026-01-01T00:00:00Z", duration_sec: 60 }, // otro kind: fuera
      ]),
    );
    const items = pendingQueueItems("SPORT");
    expect(items).toHaveLength(1);
    expect(items[0].client_id).toBe("x");
  });

  test("sin uid conocido, solo mira la cola anon", () => {
    localStorage.setItem(
      "flp_pending_acts_anon",
      JSON.stringify([{ client_id: "z", kind: "GYM", started_at: "2026-01-01T00:00:00Z", duration_sec: 60 }]),
    );
    expect(pendingQueueItems("GYM")).toHaveLength(1);
    expect(pendingQueueItems("SPORT")).toHaveLength(0);
  });
});

describe("cachedActivityUid / resetActivityUid", () => {
  beforeEach(() => { localStorage.clear(); resetActivityUid(); });

  test("null hasta que algo lo resuelve; resetActivityUid lo vuelve a limpiar", () => {
    expect(cachedActivityUid()).toBeNull();
    enqueueActivity({ client_id: "s1", kind: "SPORT", started_at: "2026-01-01T00:00:00Z", duration_sec: 60 });
    // enqueueActivity no resuelve uid (solo encola en "anon"): sigue sin cache
    expect(cachedActivityUid()).toBeNull();
    localStorage.setItem("flp_uid", "7");
    expect(cachedActivityUid()).toBe("7");
    resetActivityUid();
    expect(cachedActivityUid()).toBeNull();
  });
});

describe("fetchServerActivities", () => {
  afterEach(() => vi.unstubAllGlobals());

  test("devuelve el array cuando el servidor responde 200", async () => {
    const rows: ServerActivity[] = [
      {
        id: 1, client_id: "a", kind: "SPORT", title: "Correr", started_at: "2026-01-01T00:00:00Z",
        duration_sec: 1800, rpe: 6, kcal: 200, note: "", detail: null, load_au: 180,
        source: "MANUAL", created_at: "2026-01-01T00:30:00Z",
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(rows)));
    await expect(fetchServerActivities("SPORT")).resolves.toEqual(rows);
  });

  test("null si el servidor responde con error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ detail: "nope" }, 500)));
    await expect(fetchServerActivities("SPORT")).resolves.toBeNull();
  });

  test("null si la red falla", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    await expect(fetchServerActivities("MMA")).resolves.toBeNull();
  });
});

describe("fetchServerMetrics: mapeo de band", () => {
  beforeEach(() => { localStorage.clear(); resetActivityUid(); });
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(metricsBody: unknown) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/proxy/me")) return jsonResponse({ id: 1, email: "a@b.com" });
        if (url.includes("/activities/sync")) return jsonResponse({ results: [] });
        if (url.includes("/activities/metrics")) return jsonResponse(metricsBody);
        return jsonResponse({}, 404);
      }),
    );
  }

  test("band con datos: mapea snake_case del backend a LoadBand", async () => {
    stubFetch({
      week_au: 700, daily7: [100, 100, 100, 100, 100, 100, 100], acwr: 1.0, provisional: false,
      monotonia: 2.5, tension: 1750, sin_variacion: false, history_days: 28,
      band: { week_au: 700, low: 630, high: 770, overreach: 840, status: "sostenible", provisional: false },
    });
    const m = await fetchServerMetrics();
    expect(m?.band).toEqual({
      weekAU: 700, low: 630, high: 770, overreach: 840, status: "sostenible", provisional: false,
    });
  });

  test("band null pasa tal cual (no se mezcla con la banda local)", async () => {
    stubFetch({
      week_au: 0, daily7: [0, 0, 0, 0, 0, 0, 0], acwr: null, provisional: true,
      monotonia: null, tension: null, sin_variacion: false, history_days: 0, band: null,
    });
    const m = await fetchServerMetrics();
    expect(m?.band).toBeNull();
  });

  test("si el endpoint de métricas falla, devuelve null (fallback a lo local)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/proxy/me")) return jsonResponse({ id: 1 });
        if (url.includes("/activities/sync")) return jsonResponse({ results: [] });
        return jsonResponse({ detail: "boom" }, 500);
      }),
    );
    await expect(fetchServerMetrics()).resolves.toBeNull();
  });
});
