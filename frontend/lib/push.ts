"use client";

// Avisos con Web Push (fase 11). El navegador se suscribe con la clave pública VAPID
// (NEXT_PUBLIC_VAPID_PUBLIC_KEY) y manda la suscripción al backend, que es quien decide a quién
// avisar y cuándo (cron de Vercel). Sin la clave, los avisos están apagados y la app lo explica.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

export const PREF_KEYS = ["eve", "review", "weigh", "mobility"] as const;
export type PrefKey = (typeof PREF_KEYS)[number];

export const pushState = z.object({
  configured: z.boolean(),
  public_key: z.string().nullable(),
  prefs: z.object({ eve: z.boolean(), review: z.boolean(), weigh: z.boolean(), mobility: z.boolean() }),
  devices: z.number(),
});
export type PushState = z.infer<typeof pushState>;

/** La clave pública del build. Se lee aquí (no en el módulo) para poder cambiarla en las pruebas. */
export function vapidPublicKey(): string {
  return (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
}

export type Support = "ok" | "ios-browser" | "unsupported";

/** Si este navegador puede recibir avisos. En iPhone y iPad solo la app añadida a la pantalla de
 * inicio (iOS 16.4+) tiene `PushManager`; en Safari normal se explica cómo añadirla. */
export function pushSupport(): Support {
  if (typeof window === "undefined") return "unsupported";
  const hasApi = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if (hasApi) return "ok";
  const ua = navigator.userAgent || "";
  const ios = /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
  const standalone =
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone ? "ios-browser" : "unsupported";
}

/** La clave VAPID (base64url) como la pide `PushManager.subscribe`. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (!existing) await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

/** La suscripción de este navegador, si la hay. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (pushSupport() !== "ok") return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

const BASE = "/api/proxy/me/push";

async function call(path: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(path, {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(String(res.status)), { status: res.status, body: data });
  return data;
}

export function usePushState() {
  return useQuery<PushState>({
    queryKey: ["push"],
    queryFn: async () => pushState.parse(await call(BASE, "GET")),
  });
}

function sendSubscription(sub: PushSubscription) {
  const json = sub.toJSON();
  return call(`${BASE}/subscribe`, "POST", {
    endpoint: json.endpoint,
    keys: json.keys,
    user_agent: navigator.userAgent.slice(0, 200),
  });
}

/** Pide permiso, suscribe este navegador y se lo dice al backend. Devuelve el permiso. */
export async function enablePush(key: string): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;
  const reg = await registration();
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
  await sendSubscription(sub);
  return permission;
}

export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await call(`${BASE}/unsubscribe`, "POST", { endpoint });
}

/** Si este navegador ya estaba suscrito, se vuelve a mandar (el backend lo guarda una sola vez):
 * así una suscripción que el servidor borró o que cambió de cuenta vuelve a su sitio. */
export async function resyncPush(): Promise<boolean> {
  const sub = await currentSubscription();
  if (!sub) return false;
  await sendSubscription(sub);
  return true;
}

function usePushMutation<T>(run: (v: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (data) => {
      const parsed = pushState.safeParse(data);
      if (parsed.success) qc.setQueryData(["push"], parsed.data);
      else qc.invalidateQueries({ queryKey: ["push"] });
    },
  });
}

/** El interruptor cambia al momento; si el servidor no lo guarda, vuelve a como estaba. */
export function useSavePrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (prefs: Partial<Record<PrefKey, boolean>>) => call(`${BASE}/prefs`, "PUT", prefs),
    onMutate: async (prefs) => {
      const before = qc.getQueryData<PushState>(["push"]);
      if (before) qc.setQueryData<PushState>(["push"], { ...before, prefs: { ...before.prefs, ...prefs } });
      await qc.cancelQueries({ queryKey: ["push"] });
      return { before };
    },
    onError: (_err, _prefs, ctx) => {
      if (ctx?.before) qc.setQueryData(["push"], ctx.before);
    },
    onSuccess: (data) => {
      const parsed = pushState.safeParse(data);
      if (parsed.success) qc.setQueryData(["push"], parsed.data);
    },
  });
}

export function useTestPush() {
  return usePushMutation(() => call(`${BASE}/test`, "POST"));
}
