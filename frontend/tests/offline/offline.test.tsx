import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { MutationObserver, QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import es from "@/messages/es.json";
import en from "@/messages/en.json";
import { OfflineNotice } from "@/components/offline-notice";
import { patchField, watchOfflineQueue, type OfflineMeta } from "@/lib/offline";

// F5 de la prueba en móvil: sin red no había ni página propia ni aviso de lo pendiente, y dos
// toques seguidos dejaban en cola dos cambios contrarios del mismo campo.

afterEach(() => {
  act(() => onlineManager.setOnline(true));
});

function client() {
  const qc = new QueryClient();
  watchOfflineQueue(qc.getMutationCache());
  return qc;
}

/** Una mutación como `useSaveDay`: parche del día, campo = sus claves. */
function saveDay(qc: QueryClient, sent: unknown[]) {
  const obs = new MutationObserver(qc, {
    mutationKey: ["today", "day"],
    meta: { offlineField: patchField } satisfies OfflineMeta,
    mutationFn: async (patch: Record<string, unknown>) => {
      sent.push(patch);
      return patch;
    },
  });
  return (patch: Record<string, unknown>) => obs.mutate(patch).catch(() => {});
}

const paused = (qc: QueryClient) => qc.getMutationCache().getAll().filter((m) => m.state.isPaused);
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("cola sin conexión: gana el último cambio de cada campo", () => {
  it("marcar y desmarcar Movilidad sin red deja un solo envío, el último", async () => {
    const qc = client();
    const sent: unknown[] = [];
    act(() => onlineManager.setOnline(false));
    // Cada toque crea su propio observador, como dos renders distintos
    void saveDay(qc, sent)({ mobility: true });
    await tick();
    void saveDay(qc, sent)({ mobility: false });
    await tick();
    void saveDay(qc, sent)({ weight_kg: 80.1 }); // otro campo: se queda
    await tick();
    expect(paused(qc).map((m) => m.state.variables)).toEqual([{ mobility: false }, { weight_kg: 80.1 }]);
    expect(sent).toEqual([]);

    act(() => onlineManager.setOnline(true));
    await qc.resumePausedMutations();
    await tick();
    expect(sent).toEqual([{ mobility: false }, { weight_kg: 80.1 }]);
  });

  it("las mutaciones sin campo (añadir cardio) se envían todas", async () => {
    const qc = client();
    const sent: unknown[] = [];
    act(() => onlineManager.setOnline(false));
    const obs = () => new MutationObserver(qc, { mutationFn: async (v: number) => { sent.push(v); return v; } });
    void obs().mutate(1).catch(() => {});
    void obs().mutate(2).catch(() => {});
    await tick();
    expect(paused(qc)).toHaveLength(2);
    act(() => onlineManager.setOnline(true));
    await qc.resumePausedMutations();
    expect(sent).toEqual([1, 2]);
  });

  it("patchField: el campo de un parche son sus claves", () => {
    expect(patchField({ mobility: true })).toBe("mobility");
    expect(patchField({ trained: true, day_type: "gym" })).toBe("day_type,trained");
    expect(patchField(undefined)).toBeNull();
  });
});

describe("aviso de sin conexión y de pendiente de enviar", () => {
  function show(qc: QueryClient, locale: "es" | "en" = "es") {
    return render(
      <QueryClientProvider client={qc}>
        <NextIntlClientProvider locale={locale} messages={locale === "es" ? es : en}>
          <OfflineNotice />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );
  }

  it("con red y nada pendiente no se ve; sin red avisa, y cuenta lo que espera", async () => {
    const qc = client();
    show(qc);
    expect(screen.queryByTestId("offline-notice")).toBeNull();

    act(() => onlineManager.setOnline(false));
    expect(screen.getByTestId("offline-notice").textContent).toContain("Sin conexión");
    expect(screen.getByTestId("offline-notice").textContent).toContain("se enviará solo al volver la red");

    await act(async () => {
      void saveDay(qc, [])({ mobility: true });
      await tick();
    });
    expect(screen.getByTestId("offline-notice").textContent).toContain("1 cambio pendiente de enviar");
    await act(async () => {
      void saveDay(qc, [])({ weight_kg: 80 });
      await tick();
    });
    expect(screen.getByTestId("offline-notice").textContent).toContain("2 cambios pendientes de enviar");

    await act(async () => {
      onlineManager.setOnline(true);
      await qc.resumePausedMutations();
      await tick();
    });
    expect(screen.queryByTestId("offline-notice")).toBeNull();
  });

  it("en inglés", async () => {
    const qc = client();
    show(qc, "en");
    act(() => onlineManager.setOnline(false));
    await act(async () => {
      void saveDay(qc, [])({ mobility: true });
      await tick();
    });
    expect(screen.getByTestId("offline-notice").textContent).toContain("1 change waiting to be sent");
  });
});

/* ------------------------- service worker (public/sw.js) ------------------------- */

type Handler = (event: Record<string, unknown>) => void;

/** Carga sw.js con un `self`, `caches` y `fetch` de mentira. */
function loadSw(network: (req: Request) => Promise<Response>) {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (r: Request | string) => (typeof r === "string" ? r : r.url);
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      put: async (req: Request | string, res: Response) => { store.set(new URL(keyOf(req), "https://app.test").href, res); },
      addAll: async (urls: string[]) => { for (const u of urls) store.set(new URL(u, "https://app.test").href, new Response(`cached ${u}`)); },
      keys: async () => [...store.keys()].map((k) => new Request(k)),
      delete: async (req: Request | string) => store.delete(keyOf(req)),
    };
  };
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (req: Request | string, opts?: { cacheName?: string }) => {
      const href = new URL(keyOf(req), "https://app.test").href;
      for (const [name, store] of stores) {
        if (opts?.cacheName && opts.cacheName !== name) continue;
        const hit = store.get(href);
        if (hit) return hit.clone();
      }
      return undefined;
    },
  };
  const self = {
    location: new URL("https://app.test/"),
    addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; },
    skipWaiting: () => Promise.resolve(),
    clients: { claim: () => Promise.resolve() },
  };
  const code = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");
  new Function("self", "caches", "fetch", code)(self, caches, network);

  async function run(type: string, extra: Record<string, unknown> = {}) {
    const waits: Promise<unknown>[] = [];
    let responded: Promise<Response> | undefined;
    handlers[type]({ ...extra, waitUntil: (p: Promise<unknown>) => waits.push(p), respondWith: (p: Promise<Response>) => { responded = p; } });
    const res = responded ? await responded : undefined;
    await Promise.all(waits);
    return res;
  }
  const navigate = (path: string) => run("fetch", { request: { method: "GET", mode: "navigate", url: `https://app.test${path}` } });
  const get = (path: string) => run("fetch", { request: { method: "GET", mode: "cors", url: `https://app.test${path}` } });
  return { run, navigate, get, stores };
}

const page = (body: string) => Object.defineProperty(new Response(body, { status: 200 }), "type", { value: "basic" });

describe("service worker sin conexión", () => {
  it("guarda la página propia sin conexión al instalarse", async () => {
    const sw = loadSw(async () => page("net"));
    await sw.run("install");
    expect([...sw.stores.get("flp-shell-v2")!.keys()]).toContain("https://app.test/offline.html");
  });

  it("con red sirve la red y guarda una copia; sin red abre la copia (el armazón)", async () => {
    let online = true;
    const sw = loadSw(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return page("today from network");
    });
    await sw.run("install");
    expect(await (await sw.navigate("/today"))!.text()).toBe("today from network");
    online = false;
    expect(await (await sw.navigate("/today?x=1"))!.text()).toBe("today from network");
  });

  it("sin red y sin copia de esa pantalla, la página propia sin conexión (no la de Chrome)", async () => {
    const sw = loadSw(async () => { throw new TypeError("Failed to fetch"); });
    await sw.run("install");
    expect(await (await sw.navigate("/training/plan"))!.text()).toBe("cached /offline.html");
  });

  it("las imágenes de ejercicios (/exercise-media/) se guardan y se ven sin conexión", async () => {
    let online = true;
    const network = vi.fn(async () => {
      if (!online) throw new TypeError("Failed to fetch");
      return page("png");
    });
    const sw = loadSw(network);
    expect(await (await sw.get("/exercise-media/sentadilla/0.jpg"))!.text()).toBe("png");
    online = false;
    expect(await (await sw.get("/exercise-media/sentadilla/0.jpg"))!.text()).toBe("png");
    online = true;
    await sw.get("/exercise-media/sentadilla/0.jpg");
    expect(network).toHaveBeenCalledTimes(1); // primero la caché: no se vuelve a pedir
  });

  it("/api nunca pasa por la caché", async () => {
    const network = vi.fn(async () => page("api"));
    const sw = loadSw(network);
    expect(await sw.get("/api/proxy/coach/today")).toBeUndefined(); // sin respondWith: va a la red tal cual
    expect(await sw.navigate("/api/menu-pdf/1")).toBeUndefined();
  });
});

describe("offline.html", () => {
  it("está en español y en inglés, con reintento", () => {
    const html = readFileSync(join(process.cwd(), "public", "offline.html"), "utf8");
    expect(html).toContain("Sin conexión");
    expect(html).toContain("You're offline");
    expect(html).toContain("Reintentar");
    expect(html).toContain("Try again");
    expect(html).toContain("flp_lang");
  });
});
