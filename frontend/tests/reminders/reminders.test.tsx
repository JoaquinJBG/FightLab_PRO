import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { RemindersSettings } from "@/components/reminders/RemindersSettings";
import { urlBase64ToUint8Array, type PushState } from "@/lib/push";
import { PROFILE, mockApi, renderApp } from "../support/app";

const KEY = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
const ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc";
const STATE: PushState = { configured: true, public_key: KEY, prefs: { eve: true, review: true, weigh: false, mobility: false }, devices: 0 };

type Calls = { path: string; method: string; body: unknown }[];

function routes(over: Partial<PushState> = {}, calls: Calls = []) {
  const record = (path: string, reply: (body: Record<string, unknown>) => unknown) => (init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path, method: init?.method ?? "GET", body });
    return { body: reply(body ?? {}) };
  };
  // Como el backend: el número de dispositivos cambia al suscribir y al desuscribir.
  let devices = 0;
  return mockApi({
    "/api/proxy/me/push": record("/me/push", () => ({ ...STATE, ...over, devices })),
    "/api/proxy/me/push/subscribe": record("/me/push/subscribe", () => ({ ...STATE, ...over, devices: (devices = 1) })),
    "/api/proxy/me/push/unsubscribe": record("/me/push/unsubscribe", () => ({ ...STATE, ...over, devices: (devices = 0) })),
    "/api/proxy/me/push/prefs": record("/me/push/prefs", (b) => ({ ...STATE, ...over, prefs: { ...STATE.prefs, ...b } })),
    "/api/proxy/me/push/test": record("/me/push/test", () => ({ ok: 1, gone: 0, error: 0, ...STATE, ...over, devices: 1 })),
    "/api/proxy/me/profile": { body: { ...PROFILE, timezone: "Europe/Madrid" } },
  });
}

/** Un navegador con Web Push: service worker, PushManager y Notification falsos. */
function pushBrowser({ subscribed = false, permission = "granted" as NotificationPermission } = {}) {
  let sub: { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> } | null = null;
  const make = () => ({
    endpoint: ENDPOINT,
    toJSON: () => ({ endpoint: ENDPOINT, keys: { p256dh: "p256", auth: "auth" } }),
    unsubscribe: vi.fn(async () => {
      sub = null;
      return true;
    }),
  });
  if (subscribed) sub = make();
  const pushManager = {
    getSubscription: vi.fn(async () => sub),
    subscribe: vi.fn(async () => {
      sub = make();
      return sub;
    }),
  };
  const reg = { pushManager };
  vi.stubGlobal("PushManager", function PushManager() {});
  const notification = Object.assign(function Notification() {}, {
    permission: subscribed ? "granted" : "default",
    requestPermission: vi.fn(async () => permission),
  });
  vi.stubGlobal("Notification", notification);
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { getRegistration: vi.fn(async () => reg), register: vi.fn(async () => reg), ready: Promise.resolve(reg) },
  });
  return { pushManager, notification };
}

beforeEach(() => vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", KEY));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  Reflect.deleteProperty(navigator, "serviceWorker");
});

describe("Perfil → Avisos", () => {
  it("sin la clave pública, los avisos están apagados y lo explica", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    routes();
    renderApp(<RemindersSettings />);
    expect((await screen.findByTestId("reminders-off")).textContent).toContain("Falta configurar las claves");
    expect(screen.queryByTestId("reminders-enable")).toBeNull();
    // Las preferencias se pueden dejar elegidas igualmente.
    expect(await screen.findByTestId("pref-eve")).toBeTruthy();
  });

  it("si el servidor no tiene las claves (o no coinciden), lo dice", async () => {
    pushBrowser();
    routes({ configured: false, public_key: null });
    renderApp(<RemindersSettings />);
    expect((await screen.findByTestId("reminders-off")).textContent).toContain("El servidor no tiene las claves");
  });

  it("un navegador sin Web Push explica dónde funcionan", async () => {
    routes();
    renderApp(<RemindersSettings />);
    expect((await screen.findByTestId("reminders-unsupported")).textContent).toContain("En Android usa Chrome");
    expect(screen.getByText(/solo con la app añadida a la pantalla de inicio/)).toBeTruthy();
    expect(screen.getByText(/iOS 16.4/, { selector: "li" })).toBeTruthy();
  });

  it("en iPhone desde Safari pide añadir la app a la pantalla de inicio", async () => {
    const ua = vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    routes();
    renderApp(<RemindersSettings />);
    expect((await screen.findByTestId("reminders-unsupported")).textContent).toContain("añade primero la app a la pantalla de inicio");
    ua.mockRestore();
  });

  it("activar pide permiso, suscribe con la clave VAPID y se lo manda al backend", async () => {
    const { pushManager, notification } = pushBrowser();
    const calls: Calls = [];
    routes({}, calls);
    renderApp(<RemindersSettings />);
    const enable = await screen.findByTestId("reminders-enable");
    await waitFor(() => expect((enable as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(enable);
    await screen.findByTestId("reminders-test");
    expect(notification.requestPermission).toHaveBeenCalled();
    const opts = pushManager.subscribe.mock.calls[0] as unknown as [{ userVisibleOnly: boolean; applicationServerKey: Uint8Array }];
    expect(opts[0].userVisibleOnly).toBe(true);
    expect(Array.from(opts[0].applicationServerKey)).toEqual(Array.from(urlBase64ToUint8Array(KEY)));
    const sent = calls.find((c) => c.path === "/me/push/subscribe");
    expect(sent?.body).toMatchObject({ endpoint: ENDPOINT, keys: { p256dh: "p256", auth: "auth" } });
    expect(await screen.findByText("1 dispositivo activado en tu cuenta.")).toBeTruthy();
  });

  it("si se deniega el permiso, explica cómo activarlo", async () => {
    pushBrowser({ permission: "denied" });
    const calls: Calls = [];
    routes({}, calls);
    renderApp(<RemindersSettings />);
    const enable = await screen.findByTestId("reminders-enable");
    await waitFor(() => expect((enable as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(enable);
    expect(await screen.findByText(/Has bloqueado los avisos/)).toBeTruthy();
    expect(calls.some((c) => c.path === "/me/push/subscribe")).toBe(false);
  });

  it("ya suscrito: se resincroniza, manda uno de prueba y se puede desactivar", async () => {
    pushBrowser({ subscribed: true });
    const calls: Calls = [];
    routes({}, calls);
    renderApp(<RemindersSettings />);
    fireEvent.click(await screen.findByTestId("reminders-test"));
    expect(await screen.findByText(/Enviado\./)).toBeTruthy();
    expect(calls.filter((c) => c.path === "/me/push/subscribe")).toHaveLength(1); // la resincronización
    fireEvent.click(screen.getByTestId("reminders-disable"));
    expect(await screen.findByTestId("reminders-enable")).toBeTruthy();
    expect(calls.find((c) => c.path === "/me/push/unsubscribe")?.body).toEqual({ endpoint: ENDPOINT });
  });

  it("cada aviso se enciende y se apaga por separado", async () => {
    pushBrowser();
    const calls: Calls = [];
    routes({}, calls);
    renderApp(<RemindersSettings />);
    const weigh = (await screen.findByTestId("pref-weigh")) as HTMLInputElement;
    expect(weigh.checked).toBe(false);
    fireEvent.click(weigh);
    await waitFor(() => expect((screen.getByTestId("pref-weigh") as HTMLInputElement).checked).toBe(true));
    fireEvent.click(screen.getByTestId("pref-eve"));
    await waitFor(() =>
      expect(calls.filter((c) => c.path === "/me/push/prefs").map((c) => c.body)).toEqual([{ weigh: true }, { eve: false }]),
    );
  });

  it("explica las horas con la zona del perfil", async () => {
    pushBrowser();
    routes();
    renderApp(<RemindersSettings />);
    expect(await screen.findByText(/zona horaria del perfil \(Europe\/Madrid\)/)).toBeTruthy();
    expect(screen.getByText(/entre las 21:00 y las 22:00 en invierno/)).toBeTruthy();
  });

  it("en inglés", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    routes();
    renderApp(<RemindersSettings />, "en");
    expect((await screen.findByTestId("reminders-off")).textContent).toContain("Reminders are off on this server");
    expect(await screen.findByText("The night before")).toBeTruthy();
  });
});

describe("urlBase64ToUint8Array", () => {
  it("decodifica base64url sin relleno", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID-_8"))).toEqual([1, 2, 3, 251, 255]);
  });
});
