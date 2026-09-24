"use client";

// Backup en el servidor de datos que hoy solo viven en localStorage.
//
// localStorage sigue siendo la fuente inmediata (offline-first): toda lectura
// y escritura de este módulo pasa PRIMERO por localStorage, bajo las mismas
// claves flp_* de siempre (compatibles con lo que ya lee el resto del código).
// El servidor es la copia de seguridad y el punto de sincronización entre
// dispositivos: nada de lo de aquí bloquea la UI, y toda petición de red es
// "fire and forget" con reintentos en segundo plano, tolerante a un backend
// dormido o caído (Render free puede tardar ~50 s en despertar).
//
// Mecanismo de choque entre dispositivos: last-write-wins por `updated_at`,
// resuelto en el servidor (ver backend/userstate). Aquí solo hace falta
// guardar, junto a cada valor, CUÁNDO se escribió (en `flp_state_meta_<key>`,
// un canal aparte para no tocar el formato de la clave flp_<key> original).

import { useCallback, useEffect, useRef, useState } from "react";

export type Serde<T> = { serialize: (v: T) => string; deserialize: (raw: string) => T };

export function jsonSerde<T>(): Serde<T> {
  return {
    serialize: (v) => JSON.stringify(v),
    deserialize: (raw) => JSON.parse(raw) as T,
  };
}

/** Para claves guardadas como string "pelado" (sin comillas JSON), como
 *  `nutri_goal` ("perder"/"mantener"/"ganar"): ni serializa ni deserializa. */
export const rawStringSerde: Serde<string> = { serialize: (v) => v, deserialize: (raw) => raw };

const LS_PREFIX = "flp_";
const LS_META_PREFIX = "flp_state_meta_";
const MIGRATED_PREFIX = "flp_state_migrated_";
const UID_CACHE_KEY = "flp_uid"; // mismo cache que lib/activities.ts (clave compartida, solo lectura aquí)

type ServerEntry = { value: unknown; updated_at: string; accepted?: boolean };

/* Allowlist de claves que el backend acepta (ver backend/userstate/services.py).
   Se usa aquí SOLO para decidir qué migrar de localStorage al servidor. */
const ALLOWED_KEY_PATTERNS: RegExp[] = [
  /^nutri_\d{4}-\d{2}-\d{2}$/,
  /^water_\d{4}-\d{2}-\d{2}$/,
  /^nutri_goal$/,
  /^weigh$/,
  /^gym_week$/,
  /^gym_sessions$/,
  /^profile_extra$/,
  /^coach_fb$/,
  /^coach_dismissed_\d{4}-\d{2}-\d{2}$/,
  /^coach_memory$/,
];
function keyIsAllowed(key: string): boolean {
  return ALLOWED_KEY_PATTERNS.some((p) => p.test(key));
}

/* --------------------------------- uid ------------------------------------- */

function cachedUid(): string | null {
  try {
    return localStorage.getItem(UID_CACHE_KEY);
  } catch {
    return null;
  }
}

async function resolveUid(): Promise<string | null> {
  const cached = cachedUid();
  if (cached) return cached;
  try {
    const res = await fetch("/api/proxy/me", { credentials: "include" });
    if (!res.ok) return null;
    const me = (await res.json()) as { id?: number; email?: string };
    const uid = me.id != null ? String(me.id) : (me.email ?? null);
    if (uid) {
      try {
        localStorage.setItem(UID_CACHE_KEY, uid);
      } catch {
        /* noop */
      }
    }
    return uid;
  } catch {
    return null;
  }
}

/* --------------------------------- red -------------------------------------- */

async function putState(key: string, value: unknown, updatedAt: string): Promise<{ ok: boolean; server?: ServerEntry }> {
  try {
    const res = await fetch(`/api/proxy/me/state/${encodeURIComponent(key)}`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value, updated_at: updatedAt }),
    });
    if (!res.ok) return { ok: false };
    const data = (await res.json().catch(() => null)) as ServerEntry | null;
    return { ok: true, server: data ?? undefined };
  } catch {
    return { ok: false }; // red caída o backend dormido: se reintenta
  }
}

async function deleteState(key: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/proxy/me/state/${encodeURIComponent(key)}`, {
      method: "DELETE",
      credentials: "include",
    });
    return res.ok || res.status === 204;
  } catch {
    return false;
  }
}

async function getState(key: string): Promise<ServerEntry | null> {
  try {
    const res = await fetch(`/api/proxy/me/state?keys=${encodeURIComponent(key)}`, { credentials: "include" });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, ServerEntry>;
    return data[key] ?? null;
  } catch {
    return null;
  }
}

async function getStatesByPrefix(prefix: string, from: string, to: string): Promise<Record<string, ServerEntry>> {
  try {
    const qs = new URLSearchParams({ prefix, from, to });
    const res = await fetch(`/api/proxy/me/state?${qs.toString()}`, { credentials: "include" });
    if (!res.ok) return {};
    return (await res.json()) as Record<string, ServerEntry>;
  } catch {
    return {};
  }
}

/* ------------------------------ meta local ---------------------------------- */

function readMetaUpdatedAt(key: string): string | null {
  try {
    const raw = localStorage.getItem(LS_META_PREFIX + key);
    if (!raw) return null;
    const meta = JSON.parse(raw) as { updatedAt?: string };
    return meta.updatedAt ?? null;
  } catch {
    return null;
  }
}

function writeMetaUpdatedAt(key: string, updatedAt: string): void {
  try {
    localStorage.setItem(LS_META_PREFIX + key, JSON.stringify({ updatedAt }));
  } catch {
    /* noop */
  }
}

function writeLocalRaw(key: string, raw: string): void {
  try {
    localStorage.setItem(LS_PREFIX + key, raw);
  } catch {
    /* noop */
  }
}

function readLocalRaw(key: string): string | null {
  try {
    return localStorage.getItem(LS_PREFIX + key);
  } catch {
    return null;
  }
}

/* --------------------------- cola de reintentos ------------------------------ */
// Cada escritura se manda ya mismo; si falla (red caída / backend dormido) se
// reintenta con backoff, y al volver el foco o la conexión se reintenta antes.

type Pending = {
  value: unknown;
  updatedAt: string;
  attempts: number;
  timer: ReturnType<typeof setTimeout> | null;
  serialize: (v: unknown) => string;
  /** uid (resuelto en `flp_uid`) del usuario que encoló esta entrada, o null si
   *  aún no se conocía. Se usa para no mandar, en la sesión de otra cuenta,
   *  algo que quedó pendiente de la anterior (ver `runPending`). */
  uid: string | null;
};
const pending = new Map<string, Pending>();
const BACKOFF_MS = [3_000, 10_000, 30_000, 60_000];

function adoptServerValue(key: string, server: ServerEntry, serialize: (v: unknown) => string): void {
  // El servidor ya tenía algo más nuevo que lo que mandamos: adoptamos su valor.
  writeLocalRaw(key, serialize(server.value));
  writeMetaUpdatedAt(key, server.updated_at);
}

/** true si esta entrada es de una cuenta distinta a la que hay activa ahora
 *  mismo (logout + login de otro usuario, en la misma pestaña, sin recargar).
 *  Si cualquiera de los dos uid no se conoce todavía, no se considera
 *  discrepancia (para no descartar por error algo escrito antes de resolver
 *  el uid la primera vez). */
function pendingBelongsToAnotherUser(entryUid: string | null): boolean {
  const current = cachedUid();
  return entryUid != null && current != null && entryUid !== current;
}

async function runPending(key: string): Promise<void> {
  const entry = pending.get(key);
  if (!entry) return;
  if (pendingBelongsToAnotherUser(entry.uid)) {
    if (entry.timer) clearTimeout(entry.timer);
    pending.delete(key);
    persistPendingForUid(entry.uid ?? ANON_UID);
    return;
  }
  const result = await putState(key, entry.value, entry.updatedAt);
  const current = pending.get(key);
  if (!current || current.updatedAt !== entry.updatedAt) return; // ya hay algo más nuevo en camino
  if (result.ok) {
    pending.delete(key);
    persistPendingForUid(current.uid ?? ANON_UID);
    if (result.server && result.server.accepted === false) {
      adoptServerValue(key, result.server, current.serialize);
    }
    return;
  }
  current.attempts += 1;
  const delay = BACKOFF_MS[Math.min(current.attempts - 1, BACKOFF_MS.length - 1)];
  current.timer = setTimeout(() => {
    void runPending(key);
  }, delay);
}

function scheduleWrite<T>(key: string, value: T, serialize: (v: T) => string): void {
  const updatedAt = new Date().toISOString();
  const uid = cachedUid();
  const prev = pending.get(key);
  if (prev?.timer) clearTimeout(prev.timer);
  pending.set(key, {
    value,
    updatedAt,
    attempts: 0,
    timer: null,
    serialize: serialize as (v: unknown) => string,
    uid,
  });
  writeMetaUpdatedAt(key, updatedAt);
  ensureKickListeners();
  persistPendingForUid(uid ?? ANON_UID);
  void runPending(key);
}

/* --------------------- reintento al volver el foco/la red -------------------- */
// Los listeners se enganchan de forma perezosa (al primer encolado) y se
// pueden desenganchar con `resetUserStateQueue` (logout): así no quedan vivos
// disparando reintentos con las cookies de la SIGUIENTE cuenta que entre en
// la misma pestaña. Si esa cuenta vuelve a encolar algo, se re-enganchan solos.
let kickListenersAttached = false;

function kickPending(): void {
  for (const key of pending.keys()) void runPending(key);
}

function ensureKickListeners(): void {
  if (kickListenersAttached || typeof window === "undefined") return;
  window.addEventListener("online", kickPending);
  window.addEventListener("focus", kickPending);
  kickListenersAttached = true;
}

function removeKickListeners(): void {
  if (!kickListenersAttached || typeof window === "undefined") return;
  window.removeEventListener("online", kickPending);
  window.removeEventListener("focus", kickPending);
  kickListenersAttached = false;
}

/* ------------------------- outbox persistido (por uid) ------------------------ */
// Copia en localStorage de lo que hay en `pending`, para que sobreviva a
// cerrar la pestaña/app (offline-first), igual que el outbox de
// lib/activities.ts. Se reescribe entera para el uid afectado en cada alta o
// baja de `pending` (los lotes son pequeños: un puñado de claves como mucho).
// `frontend/lib/hooks.ts` (`clearDeviceState`) la trata igual que
// `flp_pending_acts_*`/`flp_pending_dels_*`: se borra la del uid que cierra
// sesión (ya se intentó mandar en el logout) y se conserva la de otra cuenta
// en un móvil compartido.
const PENDING_STATE_PREFIX = "flp_pending_state_";
const ANON_UID = "anon";

type PersistedPendingItem = { key: string; value: unknown; updatedAt: string };

function pendingStorageKey(uid: string): string {
  return PENDING_STATE_PREFIX + uid;
}

/** Serializador genérico para reconstruir la cola persistida: no se guarda la
 *  función `serde` de cada `useUserState` (no es serializable), así que se
 *  reconstruye con la misma regla que usan `jsonSerde`/`rawStringSerde`: un
 *  string se guarda "pelado" (p. ej. `nutri_goal`), cualquier otra cosa como
 *  JSON. Ninguna clave de la allowlist guarda un string JSON entrecomillado
 *  como valor, así que esta regla no ambigua. */
function genericSerialize(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function persistPendingForUid(uid: string): void {
  try {
    const items: PersistedPendingItem[] = [];
    for (const [key, entry] of pending.entries()) {
      if ((entry.uid ?? ANON_UID) !== uid) continue;
      items.push({ key, value: entry.value, updatedAt: entry.updatedAt });
    }
    if (items.length === 0) {
      localStorage.removeItem(pendingStorageKey(uid));
    } else {
      localStorage.setItem(pendingStorageKey(uid), JSON.stringify(items));
    }
  } catch {
    /* noop */
  }
}

function readPersistedPending(uid: string): PersistedPendingItem[] {
  try {
    const raw = localStorage.getItem(pendingStorageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PersistedPendingItem[]) : [];
  } catch {
    return [];
  }
}

let restoredForUid: string | null = null;

/** Recupera, una vez por uid y por carga de módulo, lo que quedó pendiente en
 *  este dispositivo la última vez (p. ej. la app se cerró offline antes de
 *  poder mandarlo). No pisa una entrada que ya esté en curso para la misma
 *  clave (algo más nuevo ya en memoria gana): solo relanza las claves que
 *  esta llamada añade de verdad, nunca TODO `pending` (que podría incluir una
 *  clave con un envío ya en vuelo ahora mismo y mandarla dos veces a la vez). */
function restorePersistedPendingOnce(uid: string): void {
  if (restoredForUid === uid) return;
  restoredForUid = uid;
  const items = readPersistedPending(uid);
  if (items.length === 0) return;
  const restoredKeys: string[] = [];
  for (const item of items) {
    if (pending.has(item.key)) continue;
    pending.set(item.key, {
      value: item.value,
      updatedAt: item.updatedAt,
      attempts: 0,
      timer: null,
      serialize: genericSerialize,
      uid,
    });
    restoredKeys.push(item.key);
  }
  if (restoredKeys.length === 0) return;
  ensureKickListeners();
  for (const key of restoredKeys) void runPending(key);
}

/* -------------------------------- API pública -------------------------------- */

/** Encola un valor para el servidor (fire-and-forget, con reintentos). No toca
 *  localStorage: para eso, escribe tú mismo bajo `flp_<key>` antes de llamar. */
export function syncUserState<T>(key: string, value: T, serde: Serde<T> = jsonSerde<T>()): void {
  if (typeof window === "undefined") return;
  migrateLegacyUserStateOnce();
  scheduleWrite(key, value, serde.serialize);
}

/** Borra una clave, en local y en el servidor (best-effort). */
export function syncUserStateDelete(key: string): void {
  if (typeof window === "undefined") return;
  const prev = pending.get(key);
  if (prev?.timer) clearTimeout(prev.timer);
  pending.delete(key);
  if (prev) persistPendingForUid(prev.uid ?? ANON_UID);
  try {
    localStorage.removeItem(LS_META_PREFIX + key);
  } catch {
    /* noop */
  }
  void deleteState(key);
}

const DEFAULT_FLUSH_TIMEOUT_MS = 4_000;

async function sendPendingNow(key: string): Promise<void> {
  const entry = pending.get(key);
  if (!entry) return;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  await runPending(key);
}

/** Intenta mandar YA todo lo que haya en la cola (sin esperar al backoff),
 *  con un timeout corto: pensado para `useLogout`, para darle a lo pendiente
 *  de ESTA cuenta una última oportunidad de llegar al servidor mientras las
 *  cookies todavía son las suyas. Si no da tiempo, lo que quede sigue en
 *  `pending` (se reintentará solo, o se descartará con
 *  `resetUserStateQueue` si de todos modos toca cerrar sesión). */
export async function flushUserState(timeoutMs: number = DEFAULT_FLUSH_TIMEOUT_MS): Promise<void> {
  if (typeof window === "undefined") return;
  const keys = Array.from(pending.keys());
  if (keys.length === 0) return;
  const attempt = Promise.allSettled(keys.map((key) => sendPendingNow(key)));
  await Promise.race([
    attempt.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
}

/** Cancela toda la cola en memoria: los timers de reintento y los listeners
 *  de foco/conexión. Pensado para el logout, justo después de
 *  `flushUserState`: sin esto, un reintento ya agendado podía dispararse con
 *  las cookies de la SIGUIENTE cuenta que entrara en la misma pestaña (sin
 *  recarga completa), escribiendo los datos de quien salió en la cuenta de
 *  quien entra. No toca localStorage: lo que quede sin subir de esta cuenta lo
 *  limpia `clearDeviceState` (frontend/lib/hooks.ts); lo de otra cuenta en
 *  este dispositivo se conserva ahí. */
export function resetUserStateQueue(): void {
  for (const entry of pending.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  pending.clear();
  removeKickListeners();
}

/** Si el servidor tiene un valor más nuevo que el local, lo adopta (local +
 *  devuelto). Si no hay nada más nuevo, o el servidor no responde, null. */
export async function hydrateUserState<T>(key: string, serde: Serde<T> = jsonSerde<T>()): Promise<T | null> {
  if (typeof window === "undefined") return null;
  const server = await getState(key);
  if (!server) return null;
  const localUpdatedAt = readMetaUpdatedAt(key);
  if (localUpdatedAt && new Date(localUpdatedAt) >= new Date(server.updated_at)) return null;
  const value = server.value as T;
  writeLocalRaw(key, serde.serialize(value));
  writeMetaUpdatedAt(key, server.updated_at);
  return value;
}

/** Igual que `hydrateUserState` pero para un rango `prefix<fecha>` (p. ej.
 *  `nutri_` entre dos fechas YYYY-MM-DD). Ya escribe en localStorage lo que
 *  encuentra más nuevo; no hace falta llamar a `hydrateUserState` por cada día. */
export async function hydrateUserStatePrefix(prefix: string, dateFrom: string, dateTo: string): Promise<void> {
  if (typeof window === "undefined") return;
  const map = await getStatesByPrefix(prefix, dateFrom, dateTo);
  for (const [key, entry] of Object.entries(map)) {
    const localUpdatedAt = readMetaUpdatedAt(key);
    if (localUpdatedAt && new Date(localUpdatedAt) >= new Date(entry.updated_at)) continue;
    writeLocalRaw(key, JSON.stringify(entry.value));
    writeMetaUpdatedAt(key, entry.updated_at);
  }
}

/* ------------------------------- migración ----------------------------------- */

function tryParseRaw(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw; // valores no-JSON, como el "perder"/"mantener"/"ganar" de nutri_goal
  }
}

function collectLegacyCandidates(): { key: string; raw: string }[] {
  const out: { key: string; raw: string }[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const lsKey = localStorage.key(i);
      if (!lsKey || !lsKey.startsWith(LS_PREFIX)) continue;
      if (lsKey.startsWith(LS_META_PREFIX) || lsKey.startsWith(MIGRATED_PREFIX)) continue;
      const bare = lsKey.slice(LS_PREFIX.length);
      if (!keyIsAllowed(bare)) continue;
      const raw = localStorage.getItem(lsKey);
      if (raw == null) continue;
      out.push({ key: bare, raw });
    }
  } catch {
    /* noop */
  }
  return out;
}

let migrationInFlight: Promise<void> | null = null;

// Debe coincidir con `userstate.services.MAX_BULK_ITEMS` en el backend.
const MAX_BULK_MIGRATION_ITEMS = 200;

type BulkPutItem = { key: string; value: unknown; updated_at: string };
type BulkItemResult = { ok: boolean; accepted?: boolean };

/** Un solo POST a /me/state/bulk (hasta `MAX_BULK_MIGRATION_ITEMS` items). Null
 *  si la petición entera no llegó a completarse (red caída, backend dormido,
 *  429 de throttle, sesión perdida, 5xx): en ese caso NINGUNA clave del lote
 *  tiene todavía una respuesta final. Si la petición sí completa, cada clave
 *  del lote tiene su propio resultado (aceptada o rechazada: ambas son
 *  finales), aunque falte alguna del `results` por una respuesta rara. */
async function putStateBulk(items: BulkPutItem[]): Promise<Record<string, BulkItemResult> | null> {
  try {
    const res = await fetch("/api/proxy/me/state/bulk", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    if (!res.ok) return null; // incluye 429 (throttle) y cualquier 4xx/5xx de la petición completa
    const data = (await res.json().catch(() => null)) as { results?: Record<string, BulkItemResult> } | null;
    return data?.results ?? null;
  } catch {
    return null; // red caída o backend dormido: se reintenta más tarde
  }
}

/** Migración única (idempotente) de las claves flp_* que ya hubiera en este
 *  dispositivo al servidor, pensada para el primer login tras esta versión.
 *  Nunca pisa lo que ya haya en el servidor (manda un `updated_at` de época,
 *  así que solo "gana" si el servidor no tenía nada para esa clave). Va en
 *  tandas de hasta `MAX_BULK_MIGRATION_ITEMS` claves por petición (no una
 *  petición por clave: un histórico largo de nutrición/agua agotaría el
 *  throttle de user-state y perdería el resto para siempre). Si el backend no
 *  responde, o responde con un 429, o una tanda se queda sin respuesta final
 *  para alguna clave, NO se marca nada: se reintenta entera en el próximo
 *  montaje de cualquier página conectada. */
export function migrateLegacyUserStateOnce(): void {
  if (typeof window === "undefined") return;
  if (migrationInFlight) return;
  migrationInFlight = runMigration().finally(() => {
    migrationInFlight = null;
  });
}

async function runMigration(): Promise<void> {
  const uid = await resolveUid();
  if (!uid) return; // sin sesión (u offline): se reintenta en el próximo mount
  restorePersistedPendingOnce(uid);
  const flag = MIGRATED_PREFIX + uid;
  try {
    if (localStorage.getItem(flag) === "1") return;
  } catch {
    return;
  }

  const candidates = collectLegacyCandidates();
  if (candidates.length === 0) {
    try {
      localStorage.setItem(flag, "1");
    } catch {
      /* noop */
    }
    return;
  }

  const EPOCH = new Date(0).toISOString();
  const items: BulkPutItem[] = candidates.map(({ key, raw }) => ({
    key,
    value: tryParseRaw(raw),
    updated_at: EPOCH,
  }));

  let allFinal = true;
  for (let i = 0; i < items.length && allFinal; i += MAX_BULK_MIGRATION_ITEMS) {
    const batch = items.slice(i, i + MAX_BULK_MIGRATION_ITEMS);
    const results = await putStateBulk(batch);
    if (results === null || batch.some((item) => results[item.key] === undefined)) {
      allFinal = false; // la tanda no llegó, o llegó pero sin resultado para alguna clave
    }
  }

  if (allFinal) {
    try {
      localStorage.setItem(flag, "1");
    } catch {
      /* noop */
    }
  }
  // si algo se quedó sin respuesta final, no se marca: se reintenta en el próximo mount
}

/* --------------------------------- hook --------------------------------------- */

export type UseUserState<T> = {
  value: T;
  setValue: (v: T) => void;
  remove: () => void;
  hydrated: boolean;
};

/** Hook de React para un valor con copia de seguridad en el servidor.
 *  - Al montar: lee `flp_<key>` de localStorage (síncrono, sin parpadeo) y,
 *    en segundo plano, comprueba si el servidor tiene algo más nuevo.
 *  - `setValue`: escribe local YA (misma clave flp_*, mismo formato que
 *    siempre) y encola el envío al servidor con reintentos.
 *  - `remove`: borra en local y en el servidor. */
export function useUserState<T>(
  key: string,
  defaultValue: T,
  serde: Serde<T> = jsonSerde<T>(),
): UseUserState<T> {
  const [value, setValueState] = useState<T>(defaultValue);
  const [hydrated, setHydrated] = useState(false);
  const serdeRef = useRef(serde);
  const defaultRef = useRef(defaultValue);

  // Los refs solo se leen en efectos/callbacks (nunca durante el render), así
  // que actualizarlos aquí, tras cada render, mantiene "serde"/"defaultValue"
  // al día para setValue/remove sin forzar a recrearlos en cada cambio.
  useEffect(() => {
    serdeRef.current = serde;
    defaultRef.current = defaultValue;
  });

  useEffect(() => {
    migrateLegacyUserStateOnce();
    let alive = true;

    const raw = readLocalRaw(key);
    if (raw != null) {
      try {
        setValueState(serdeRef.current.deserialize(raw));
      } catch {
        /* valor corrupto: se queda el default */
      }
    }
    setHydrated(true);

    void (async () => {
      const server = await hydrateUserState<T>(key, serdeRef.current);
      if (alive && server !== null) setValueState(server);
    })();

    return () => {
      alive = false;
    };
  }, [key]);

  const setValue = useCallback(
    (v: T) => {
      setValueState(v);
      writeLocalRaw(key, serdeRef.current.serialize(v));
      scheduleWrite(key, v, serdeRef.current.serialize);
    },
    [key],
  );

  const remove = useCallback(() => {
    setValueState(defaultRef.current);
    try {
      localStorage.removeItem(LS_PREFIX + key);
    } catch {
      /* noop */
    }
    syncUserStateDelete(key);
  }, [key]);

  return { value, setValue, remove, hydrated };
}
