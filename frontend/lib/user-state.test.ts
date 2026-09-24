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

describe("migrateLegacyUserStateOnce", () => {
  it("migra las claves legacy permitidas sin pisar lo que ya haya en el servidor (updated_at de época)", async () => {
    localStorage.setItem("flp_uid", "42");
    localStorage.setItem("flp_nutri_goal", "perder"); // string "pelado", no JSON
    localStorage.setItem("flp_weigh", JSON.stringify({ target: 70, date: "2030-01-01" }));
    localStorage.setItem("flp_uid_unrelated", "no debe migrarse"); // no está en la allowlist

    fetchImpl = async (url, init) => {
      if (url === "/api/proxy/me") return jsonResponse({ id: 42 });
      if (typeof url === "string" && url.startsWith("/api/proxy/me/state/") && init?.method === "PUT") {
        return jsonResponse({ accepted: true });
      }
      return jsonResponse({});
    };
    const mod = await importFresh();
    mod.migrateLegacyUserStateOnce();
    await vi.waitFor(() => expect(localStorage.getItem("flp_state_migrated_42")).toBe("1"));

    const goalPut = calls.find((c) => c.url === "/api/proxy/me/state/nutri_goal");
    expect((goalPut!.body as PutBody).value).toBe("perder");
    expect((goalPut!.body as PutBody).updated_at).toBe(new Date(0).toISOString());

    const weighPut = calls.find((c) => c.url === "/api/proxy/me/state/weigh");
    expect((weighPut!.body as PutBody).value).toEqual({ target: 70, date: "2030-01-01" });

    expect(calls.some((c) => c.url === "/api/proxy/me/state/uid_unrelated")).toBe(false);
    expect(localStorage.getItem("flp_state_migrated_42")).toBe("1");
  });

  it("es idempotente: si ya está marcada, no vuelve a mandar nada", async () => {
    localStorage.setItem("flp_uid", "7");
    localStorage.setItem("flp_state_migrated_7", "1");
    localStorage.setItem("flp_nutri_goal", "ganar");

    const mod = await importFresh();
    mod.migrateLegacyUserStateOnce();
    await flush(10);

    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });

  it("si el backend no responde, no marca la migración como hecha (se reintenta más tarde)", async () => {
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

  it("sin sesión (uid no resoluble), no marca ni manda nada", async () => {
    fetchImpl = async (url) => {
      if (url === "/api/proxy/me") return jsonResponse({}, 401);
      return jsonResponse({});
    };
    const mod = await importFresh();
    mod.migrateLegacyUserStateOnce();
    await flush(10);

    expect(calls.some((c) => c.method === "PUT")).toBe(false);
  });
});

describe("rawStringSerde", () => {
  it("no envuelve el valor en comillas JSON (compatibilidad con flp_nutri_goal)", async () => {
    const mod = await importFresh();
    expect(mod.rawStringSerde.serialize("perder")).toBe("perder");
    expect(mod.rawStringSerde.deserialize("perder")).toBe("perder");
  });
});
