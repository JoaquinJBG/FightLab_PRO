import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Se reimporta el módulo en cada test (vi.resetModules) porque mantiene
// estado propio a nivel de módulo (la cola de reintentos y el "en curso" de
// la migración): así cada test empieza con ese estado limpio, además de
// localStorage.

type PutBody = { value: unknown; updated_at: string };
type FetchImpl = (url: string, init?: RequestInit) => Promise<Response> | Response;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

let fetchImpl: FetchImpl;
let calls: { url: string; method: string; body: unknown }[];

async function importFresh() {
  vi.resetModules();
  return import("./user-state");
}

beforeEach(() => {
  localStorage.clear();
  calls = [];
  fetchImpl = async (url) => {
    if (url === "/api/proxy/me") return jsonResponse({ id: 1 });
    return jsonResponse({});
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method, body });
      return fetchImpl(url, init);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function flush(ticks = 20) {
  for (let i = 0; i < ticks; i++) await Promise.resolve();
}

describe("syncUserState", () => {
  it("manda un PUT con el valor y un updated_at ISO, y guarda la meta local", async () => {
    const mod = await importFresh();
    mod.syncUserState("weigh", { target: 70 });
    await flush();

    const put = calls.find((c) => c.url === "/api/proxy/me/state/weigh" && c.method === "PUT");
    expect(put).toBeDefined();
    const body = put!.body as PutBody;
    expect(body.value).toEqual({ target: 70 });
    expect(() => new Date(body.updated_at).toISOString()).not.toThrow();

    const meta = JSON.parse(localStorage.getItem("flp_state_meta_weigh")!);
    expect(meta.updatedAt).toBe(body.updated_at);
  });

  it("si el servidor ya tenía algo más nuevo (accepted:false), adopta ese valor en local", async () => {
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me/state/weigh") {
        return jsonResponse({ value: { target: 90 }, updated_at: "2031-01-01T00:00:00.000Z", accepted: false });
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    mod.syncUserState("weigh", { target: 70 });
    await vi.waitFor(() => expect(localStorage.getItem("flp_weigh")).not.toBeNull());

    expect(JSON.parse(localStorage.getItem("flp_weigh")!)).toEqual({ target: 90 });
    expect(JSON.parse(localStorage.getItem("flp_state_meta_weigh")!).updatedAt).toBe("2031-01-01T00:00:00.000Z");
  });

  it("reintenta con backoff si la red falla (backend dormido/caído)", async () => {
    let attempts = 0;
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me/state/weigh") {
        attempts++;
        if (attempts < 2) throw new Error("network down");
        return jsonResponse({ value: { target: 70 }, updated_at: new Date().toISOString(), accepted: true });
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    vi.useFakeTimers();
    mod.syncUserState("weigh", { target: 70 });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1); // primer intento: falla

    await vi.advanceTimersByTimeAsync(3_000); // primer backoff (3s)
    expect(attempts).toBe(2); // segundo intento: ok
  });

  it("una escritura más nueva para la misma clave cancela el reintento de la anterior", async () => {
    fetchImpl = async (url, init) => {
      if (url === "/api/proxy/me/state/weigh") {
        const body = JSON.parse(String(init?.body)) as PutBody;
        if (body.value && (body.value as { target: number }).target === 1) throw new Error("cae la primera");
        return jsonResponse({ accepted: true });
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    mod.syncUserState("weigh", { target: 1 }); // fallará
    await flush();
    mod.syncUserState("weigh", { target: 2 }); // se manda ya, sin esperar al backoff de la anterior
    await flush();

    const puts = calls.filter((c) => c.url === "/api/proxy/me/state/weigh" && c.method === "PUT");
    expect(puts.at(-1)?.body).toMatchObject({ value: { target: 2 } });
  });
});

describe("uid en la cola pendiente (logout + login de otra cuenta en la misma pestaña)", () => {
  it("descarta un reintento agendado si el uid activo cambió antes de que se disparara", async () => {
    localStorage.setItem("flp_uid", "1");
    let attempts = 0;
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me/state/weigh") {
        attempts++;
        throw new Error("offline"); // el primer intento siempre falla: agenda un backoff
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    vi.useFakeTimers();
    mod.syncUserState("weigh", { target: 70 }); // uid "1" en la entrada
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    // Logout de "1" + login de "2" en la misma pestaña, sin recargar la página
    // (router.push): flp_uid cambia, pero el timer del backoff sigue vivo.
    localStorage.setItem("flp_uid", "2");

    await vi.advanceTimersByTimeAsync(3_000); // dispara el reintento agendado
    expect(attempts).toBe(1); // NO se reintenta: se descarta por pertenecer a otro uid
  });

  it("no descarta una entrada cuyo uid aún no se conocía cuando se escribió (offline en el primer arranque)", async () => {
    // Sin flp_uid todavía: cachedUid() devuelve null en el momento de escribir.
    let attempts = 0;
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me/state/weigh") {
        attempts++;
        if (attempts === 1) throw new Error("offline");
        return jsonResponse({ accepted: true });
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    vi.useFakeTimers();
    mod.syncUserState("weigh", { target: 70 });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    // El uid se resuelve después (p. ej. otra llamada ya con sesión), pero es
    // la MISMA cuenta: no debe perderse el reintento por esto.
    localStorage.setItem("flp_uid", "1");

    await vi.advanceTimersByTimeAsync(3_000);
    expect(attempts).toBe(2); // se reintentó con normalidad
  });
});

describe("flushUserState", () => {
  it("manda ya lo pendiente sin esperar el backoff", async () => {
    let attempts = 0;
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me/state/weigh") {
        attempts++;
        if (attempts === 1) throw new Error("offline"); // primer intento: falla y agenda backoff (3s)
        return jsonResponse({ accepted: true });
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    mod.syncUserState("weigh", { target: 70 });
    await flush();
    expect(attempts).toBe(1);

    await mod.flushUserState(4_000); // no debería esperar los 3s del backoff
    expect(attempts).toBe(2);
  });

  it("no espera más allá del timeout indicado si el envío no llega a tiempo", async () => {
    fetchImpl = () => new Promise(() => {}); // simula una petición colgada (no resuelve nunca)
    const mod = await importFresh();
    mod.syncUserState("weigh", { target: 70 });
    await flush();

    const start = Date.now();
    await mod.flushUserState(50);
    expect(Date.now() - start).toBeLessThan(1_000); // no se cuelga esperando la petición colgada
  });

  it("no hace nada si no hay nada pendiente", async () => {
    const mod = await importFresh();
    await expect(mod.flushUserState(50)).resolves.toBeUndefined();
    expect(calls.length).toBe(0);
  });
});

describe("resetUserStateQueue", () => {
  it("cancela cualquier timer de reintento agendado (no queda ninguno en el reloj)", async () => {
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me/state/weigh") throw new Error("offline");
      return jsonResponse({});
    };
    const mod = await importFresh();
    vi.useFakeTimers();
    mod.syncUserState("weigh", { target: 70 });
    await vi.advanceTimersByTimeAsync(0); // falla y agenda el backoff
    expect(vi.getTimerCount()).toBeGreaterThan(0);

    mod.resetUserStateQueue();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("un reintento agendado antes del reset no se vuelve a lanzar después", async () => {
    let attempts = 0;
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me/state/weigh") {
        attempts++;
        throw new Error("offline");
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    vi.useFakeTimers();
    mod.syncUserState("weigh", { target: 70 });
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    mod.resetUserStateQueue();

    await vi.advanceTimersByTimeAsync(60_000); // agota todo el rango posible de backoff
    expect(attempts).toBe(1); // ningún reintento más: el timer se canceló
  });

  it("quita los listeners de online/focus", async () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    fetchImpl = async () => jsonResponse({ accepted: true });
    const mod = await importFresh();
    mod.syncUserState("weigh", { target: 70 });
    await flush();

    mod.resetUserStateQueue();

    expect(removeSpy).toHaveBeenCalledWith("online", expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith("focus", expect.any(Function));
  });
});

describe("outbox persistido (flp_pending_state_<uid>)", () => {
  it("persiste una escritura que falla bajo flp_pending_state_<uid>, y desaparece al confirmarse el envío", async () => {
    localStorage.setItem("flp_uid", "42");
    let attempts = 0;
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me/state/weigh") {
        attempts++;
        if (attempts === 1) throw new Error("offline");
        return jsonResponse({ accepted: true });
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    mod.syncUserState("weigh", { target: 70 });
    await flush();

    const persisted = JSON.parse(localStorage.getItem("flp_pending_state_42")!) as {
      key: string;
      value: unknown;
      updatedAt: string;
    }[];
    expect(persisted).toEqual([{ key: "weigh", value: { target: 70 }, updatedAt: expect.any(String) }]);

    await mod.flushUserState(200);
    expect(localStorage.getItem("flp_pending_state_42")).toBeNull();
  });

  it("al recuperar el módulo (recarga de página) con la cola persistida del mismo uid, la retoma y la reintenta", async () => {
    localStorage.setItem("flp_uid", "7");
    localStorage.setItem(
      "flp_pending_state_7",
      JSON.stringify([{ key: "weigh", value: { target: 81 }, updatedAt: "2030-01-01T00:00:00.000Z" }]),
    );
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me") return jsonResponse({ id: 7 });
      if (url === "/api/proxy/me/state/weigh") return jsonResponse({ accepted: true });
      return jsonResponse({});
    };
    const mod = await importFresh();
    mod.migrateLegacyUserStateOnce(); // resuelve el uid -> restaura lo persistido para ese uid

    await vi.waitFor(() => {
      const put = calls.find((c) => c.url === "/api/proxy/me/state/weigh" && c.method === "PUT");
      expect(put).toBeDefined();
    });
    const put = calls.find((c) => c.url === "/api/proxy/me/state/weigh" && c.method === "PUT")!;
    expect((put.body as PutBody).value).toEqual({ target: 81 });
  });
});

describe("hydrateUserState", () => {
  it("adopta el valor del servidor cuando es más nuevo que el local", async () => {
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me/state?keys=weigh") {
        return jsonResponse({ weigh: { value: { target: 82 }, updated_at: "2030-01-01T00:00:00.000Z" } });
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    const got = await mod.hydrateUserState<{ target: number }>("weigh");
    expect(got).toEqual({ target: 82 });
    expect(JSON.parse(localStorage.getItem("flp_weigh")!)).toEqual({ target: 82 });
  });

  it("no pisa un valor local que ya es igual o más nuevo que el del servidor", async () => {
    localStorage.setItem("flp_state_meta_weigh", JSON.stringify({ updatedAt: "2031-01-01T00:00:00.000Z" }));
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me/state?keys=weigh") {
        return jsonResponse({ weigh: { value: { target: 82 }, updated_at: "2030-01-01T00:00:00.000Z" } });
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    const got = await mod.hydrateUserState("weigh");
    expect(got).toBeNull();
    expect(localStorage.getItem("flp_weigh")).toBeNull();
  });

  it("devuelve null si el servidor no tiene nada para esa clave", async () => {
    fetchImpl = async () => jsonResponse({});
    const mod = await importFresh();
    expect(await mod.hydrateUserState("weigh")).toBeNull();
  });

  it("no rompe nada si el backend no responde (offline/dormido)", async () => {
    fetchImpl = async () => {
      throw new Error("offline");
    };
    const mod = await importFresh();
    await expect(mod.hydrateUserState("weigh")).resolves.toBeNull();
  });
});

describe("hydrateUserStatePrefix", () => {
  it("solo escribe en local las claves donde el servidor es más nuevo", async () => {
    localStorage.setItem("flp_state_meta_nutri_2026-09-01", JSON.stringify({ updatedAt: "2031-01-01T00:00:00.000Z" }));
    fetchImpl = async (url) => {
      if (typeof url === "string" && url.startsWith("/api/proxy/me/state?prefix=nutri_")) {
        return jsonResponse({
          "nutri_2026-09-01": { value: [{ kcal: 999 }], updated_at: "2030-01-01T00:00:00.000Z" }, // más viejo: no pisa
          "nutri_2026-09-02": { value: [{ kcal: 500 }], updated_at: "2030-01-01T00:00:00.000Z" }, // sin local: sí escribe
        });
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    await mod.hydrateUserStatePrefix("nutri_", "2026-09-01", "2026-09-07");

    expect(localStorage.getItem("flp_nutri_2026-09-01")).toBeNull();
    expect(JSON.parse(localStorage.getItem("flp_nutri_2026-09-02")!)).toEqual([{ kcal: 500 }]);
  });
});

type BulkBody = { items: { key: string; value: unknown; updated_at: string }[] };

/** Responde a un POST /api/proxy/me/state/bulk aceptando cada item del lote. */
function bulkAcceptAll(url: string, init?: RequestInit): Response | null {
  if (url !== "/api/proxy/me/state/bulk" || init?.method !== "POST") return null;
  const body = JSON.parse(String(init.body)) as BulkBody;
  const results: Record<string, unknown> = {};
  for (const item of body.items) results[item.key] = { ok: true, accepted: true };
  return jsonResponse({ results });
}

describe("migrateLegacyUserStateOnce", () => {
  it("migra las claves legacy permitidas en una sola tanda (bulk), sin pisar lo que ya haya en el servidor (updated_at de época)", async () => {
    localStorage.setItem("flp_uid", "42");
    localStorage.setItem("flp_nutri_goal", "perder"); // string "pelado", no JSON
    localStorage.setItem("flp_weigh", JSON.stringify({ target: 70, date: "2030-01-01" }));
    localStorage.setItem("flp_uid_unrelated", "no debe migrarse"); // no está en la allowlist

    fetchImpl = async (url, init) => {
      if (url === "/api/proxy/me") return jsonResponse({ id: 42 });
      return bulkAcceptAll(url, init) ?? jsonResponse({});
    };
    const mod = await importFresh();
    mod.migrateLegacyUserStateOnce();
    await vi.waitFor(() => expect(localStorage.getItem("flp_state_migrated_42")).toBe("1"));

    const bulkCall = calls.find((c) => c.url === "/api/proxy/me/state/bulk" && c.method === "POST");
    expect(bulkCall).toBeDefined();
    const items = (bulkCall!.body as BulkBody).items;

    const goal = items.find((i) => i.key === "nutri_goal");
    expect(goal?.value).toBe("perder");
    expect(goal?.updated_at).toBe(new Date(0).toISOString());

    const weigh = items.find((i) => i.key === "weigh");
    expect(weigh?.value).toEqual({ target: 70, date: "2030-01-01" });

    expect(items.some((i) => i.key === "uid_unrelated")).toBe(false);
    expect(localStorage.getItem("flp_state_migrated_42")).toBe("1");
  });

  it("es idempotente: si ya está marcada, no vuelve a mandar nada", async () => {
    localStorage.setItem("flp_uid", "7");
    localStorage.setItem("flp_state_migrated_7", "1");
    localStorage.setItem("flp_nutri_goal", "ganar");

    const mod = await importFresh();
    mod.migrateLegacyUserStateOnce();
    await flush(10);

    expect(calls.some((c) => c.method === "POST" && c.url === "/api/proxy/me/state/bulk")).toBe(false);
  });

  it("si el backend no responde (offline/backend dormido), no marca la migración como hecha (se reintenta más tarde)", async () => {
    localStorage.setItem("flp_uid", "9");
    localStorage.setItem("flp_weigh", JSON.stringify({ target: 70, date: "x" }));
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me") return jsonResponse({ id: 9 });
      throw new Error("offline");
    };
    const mod = await importFresh();
    mod.migrateLegacyUserStateOnce();
    await flush(10);

    expect(localStorage.getItem("flp_state_migrated_9")).toBeNull();
  });

  it("si el bulk responde 429 (throttle), no marca la migración como hecha", async () => {
    localStorage.setItem("flp_uid", "11");
    localStorage.setItem("flp_weigh", JSON.stringify({ target: 70 }));
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me") return jsonResponse({ id: 11 });
      if (url === "/api/proxy/me/state/bulk") return jsonResponse({ detail: "Too many requests" }, 429);
      return jsonResponse({});
    };
    const mod = await importFresh();
    mod.migrateLegacyUserStateOnce();
    await flush(10);

    expect(localStorage.getItem("flp_state_migrated_11")).toBeNull();
  });

  it("sin sesión (uid no resoluble), no marca ni manda nada", async () => {
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me") return jsonResponse({}, 401);
      return jsonResponse({});
    };
    const mod = await importFresh();
    mod.migrateLegacyUserStateOnce();
    await flush(10);

    expect(calls.some((c) => c.method === "POST" && c.url === "/api/proxy/me/state/bulk")).toBe(false);
  });

  it("manda en tandas de como mucho 200 items, y solo marca la migración cuando TODAS las claves de TODAS las tandas tienen respuesta final", async () => {
    localStorage.setItem("flp_uid", "42");
    const TOTAL = 250;
    // 250 fechas reales y distintas (formato YYYY-MM-DD, el único que acepta la
    // allowlist de water_): así hay 250 candidatos legítimos que migrar.
    const dates: string[] = [];
    const base = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < TOTAL; i++) {
      const d = new Date(base.getTime() + i * 86_400_000);
      dates.push(d.toISOString().slice(0, 10));
    }
    for (const d of dates) localStorage.setItem(`flp_water_${d}`, "1");

    const batchSizes: number[] = [];
    fetchImpl = async (url, init) => {
      if (url === "/api/proxy/me") return jsonResponse({ id: 42 });
      if (url === "/api/proxy/me/state/bulk") {
        const body = JSON.parse(String(init?.body)) as BulkBody;
        batchSizes.push(body.items.length);
        const results: Record<string, unknown> = {};
        for (const item of body.items) results[item.key] = { ok: true, accepted: true };
        return jsonResponse({ results });
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    mod.migrateLegacyUserStateOnce();
    await vi.waitFor(() => expect(localStorage.getItem("flp_state_migrated_42")).toBe("1"));

    expect(batchSizes).toEqual([200, 50]); // 250 items -> 2 tandas de ≤200
  });

  it("si una tanda intermedia falla (429), NO marca la migración aunque otras tandas sí llegaran", async () => {
    localStorage.setItem("flp_uid", "13");
    const dates: string[] = [];
    const base = new Date("2026-01-01T00:00:00Z");
    for (let i = 0; i < 250; i++) {
      const d = new Date(base.getTime() + i * 86_400_000);
      dates.push(d.toISOString().slice(0, 10));
    }
    for (const d of dates) localStorage.setItem(`flp_water_${d}`, "1");

    let bulkCallCount = 0;
    fetchImpl = async (url, init) => {
      if (url === "/api/proxy/me") return jsonResponse({ id: 13 });
      if (url === "/api/proxy/me/state/bulk") {
        bulkCallCount++;
        if (bulkCallCount === 2) return jsonResponse({ detail: "Too many requests" }, 429);
        const body = JSON.parse(String(init?.body)) as BulkBody;
        const results: Record<string, unknown> = {};
        for (const item of body.items) results[item.key] = { ok: true, accepted: true };
        return jsonResponse({ results });
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    mod.migrateLegacyUserStateOnce();
    await flush(30);

    expect(bulkCallCount).toBe(2);
    expect(localStorage.getItem("flp_state_migrated_13")).toBeNull();
  });
});

describe("rawStringSerde", () => {
  it("no envuelve el valor en comillas JSON (compatibilidad con flp_nutri_goal)", async () => {
    const mod = await importFresh();
    expect(mod.rawStringSerde.serialize("perder")).toBe("perder");
    expect(mod.rawStringSerde.deserialize("perder")).toBe("perder");
  });
});
