// Sincronización de sesiones de entreno con el backend (ActivityLog unificado).
//
// Patrón OUTBOX: cada sesión se encola en localStorage EN el mismo acto de
// guardado (síncrono) y solo sale de la cola cuando el servidor confirma
// (created/exists) o la rechaza como inválida (terminal). El flush va
// serializado con Web Locks para que dos pestañas no se pisen, y la limpieza
// de la cola se hace por client_id releyendo el estado actual (nunca
// escribiendo un snapshot viejo). Los borrados masivos también se apuntan
// (sobreviven al offline) y se ejecutan ANTES de subir pendientes.
//
// Identidad: el flush resuelve el uid SIEMPRE contra /me (nunca de caché) para
// no subir la cola de una cuenta con las cookies de otra; solo el encolado
// síncrono usa el uid cacheado. El historial legacy lo reclama un único uid
// por dispositivo (flp_acts_legacy_owner) para no copiar datos de A a B.

import type { LoadMetrics } from "@/lib/load";

export type ActivityKind = "SPORT" | "MMA" | "GYM";

export type SyncItem = {
  client_id: string;
  kind: ActivityKind;
  title?: string;
  started_at: string; // ISO: inicio real (fin - duración)
  duration_sec: number;
  rpe?: number | null;
  kcal?: number | null;
  note?: string;
  detail?: Record<string, unknown> | null;
};

const UID_CACHE_KEY = "flp_uid";
const LEGACY_OWNER_KEY = "flp_acts_legacy_owner";
const queueKey = (uid: string) => `flp_pending_acts_${uid}`;
const delsKey = (uid: string) => `flp_pending_dels_${uid}`;
const migratedKey = (uid: string) => `flp_acts_migrated_${uid}`;
const QUEUE_CAP = 1000;

/* ------------------------------- usuario ---------------------------------- */

let uidMem: string | null = null;

function cachedUid(): string | null {
  if (uidMem) return uidMem;
  try { return localStorage.getItem(UID_CACHE_KEY); } catch { return null; }
}

/** Uid SIEMPRE verificado contra /me. null si no hay red/sesión: el flush
    aborta, así nunca se sube la cola de una cuenta con las cookies de otra. */
async function resolveUidFresh(): Promise<string | null> {
  try {
    const res = await fetch("/api/proxy/me");
    if (!res.ok) return null;
    const me = (await res.json()) as { id?: number; email?: string };
    const uid = me.id != null ? String(me.id) : me.email ?? null;
    if (uid) {
      uidMem = uid;
      try { localStorage.setItem(UID_CACHE_KEY, uid); } catch { /* noop */ }
    }
    return uid;
  } catch {
    return null;
  }
}

/** Llamar al cerrar sesión (y tras iniciar una nueva): invalida el uid local
    para que nada se encole a nombre del usuario anterior. */
export function resetActivityUid(): void {
  uidMem = null;
  try { localStorage.removeItem(UID_CACHE_KEY); } catch { /* noop */ }
}

/* --------------------------------- cola ----------------------------------- */

function readQueue(key: string): SyncItem[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function appendToQueue(key: string, items: SyncItem[]) {
  // Releer SIEMPRE antes de escribir: otra pestaña puede haber encolado
  const cur = readQueue(key);
  const known = new Set(cur.map((i) => i.client_id));
  const merged = [...cur, ...items.filter((i) => !known.has(i.client_id))];
  try { localStorage.setItem(key, JSON.stringify(merged.slice(-QUEUE_CAP))); } catch { /* noop */ }
}

function removeFromQueue(key: string, done: Set<string>) {
  const cur = readQueue(key).filter((i) => !done.has(i.client_id));
  try { localStorage.setItem(key, JSON.stringify(cur)); } catch { /* noop */ }
  return cur.length;
}

function readDels(key: string): ActivityKind[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? (v as ActivityKind[]) : [];
  } catch {
    return [];
  }
}

/** Encola una sesión (síncrono respecto al guardado) y dispara un flush. */
export function enqueueActivity(item: SyncItem): void {
  if (typeof window === "undefined") return;
  appendToQueue(queueKey(cachedUid() ?? "anon"), [item]);
  void flushActivities();
}

type SyncResult = { client_id: string | null; status: "created" | "exists" | "invalid" };

async function postBatch(items: SyncItem[]): Promise<Set<string> | null> {
  const body = JSON.stringify({ items });
  const res = await fetch("/api/proxy/activities/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    // keepalive rechaza cuerpos >64 KiB: solo para lotes realmente pequeños
    keepalive: items.length <= 20 && body.length < 60_000,
  });
  if (!res.ok) return null; // transitorio (red/5xx/throttle/sesión): se reintenta
  const data = (await res.json()) as { results?: SyncResult[] };
  // created/exists confirmados e invalid terminal: todos salen de la cola
  return new Set((data.results ?? []).map((r) => r.client_id).filter((c): c is string => !!c));
}

const withFlushLock = async <T>(fn: () => Promise<T> | T): Promise<T> => {
  if (typeof navigator !== "undefined" && navigator.locks?.request) {
    return await navigator.locks.request("flp_acts_flush", async () => await fn());
  }
  return await fn();
};

/** Vacía borrados pendientes y cola. true solo si TODO quedó procesado. */
export async function flushActivities(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const uid = await resolveUidFresh();
  if (!uid) return false;
  const run = async (): Promise<boolean> => {
    const qKey = queueKey(uid);
    const dKey = delsKey(uid);

    // Adopta lo encolado antes de conocer el uid (primer arranque): quita de
    // anon SOLO lo observado, nunca la clave entera (otra pestaña puede añadir)
    const anon = readQueue(queueKey("anon"));
    if (anon.length > 0) {
      appendToQueue(qKey, anon);
      removeFromQueue(queueKey("anon"), new Set(anon.map((i) => i.client_id)));
    }

    // 1) Borrados pendientes ANTES de subir nada (orden Borrar -> entreno nuevo)
    for (const kind of readDels(dKey)) {
      try {
        const res = await fetch(`/api/proxy/activities?kind=${kind}`, { method: "DELETE" });
        if (!res.ok) return false;
      } catch {
        return false;
      }
      try {
        localStorage.setItem(dKey, JSON.stringify(readDels(dKey).filter((k) => k !== kind)));
      } catch { /* noop */ }
    }

    // 2) Cola de sesiones por lotes
    for (let round = 0; round < 4; round++) {
      const batch = readQueue(qKey).slice(0, 500);
      if (batch.length === 0) return true;
      let done: Set<string> | null = null;
      try { done = await postBatch(batch); } catch { /* red caída */ }
      if (done === null) return false;
      if (removeFromQueue(qKey, done) === 0) return true;
    }
    return readQueue(qKey).length === 0;
  };
  try {
    return await withFlushLock(run);
  } catch {
    return false;
  }
}

/** Borra el historial de un tipo en el servidor Y purga sus pendientes.
    El borrado queda apuntado y sobrevive al offline (lo ejecuta el flush). */
export async function deleteServerActivities(kind: ActivityKind): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const record = () => {
    for (const k of [queueKey(cachedUid() ?? "anon"), queueKey("anon")]) {
      const rest = readQueue(k).filter((i) => i.kind !== kind);
      try { localStorage.setItem(k, JSON.stringify(rest)); } catch { /* noop */ }
    }
    const dKey = delsKey(cachedUid() ?? "anon");
    const dels = readDels(dKey);
    if (!dels.includes(kind)) {
      try { localStorage.setItem(dKey, JSON.stringify([...dels, kind])); } catch { /* noop */ }
    }
  };
  try { await withFlushLock(record); } catch { record(); }
  return await flushActivities();
}

/* ------------------------- migración del legacy ---------------------------- */

type LegacyParse = Record<string, unknown>[];

function legacy(key: string): LegacyParse {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const clampDur = (sec: number) => Math.min(86_400, Math.max(1, Math.round(sec)));
const rpeOf = (v: unknown): number | null => {
  const n = num(v);
  return n != null && n >= 1 && n <= 10 ? Math.round(n) : null;
};
const isoStart = (ts: number, durSec: number) => new Date(Math.max(0, ts - durSec * 1000)).toISOString();

function legacyItems(): SyncItem[] {
  const items: SyncItem[] = [];

  for (const a of legacy("flp_activities")) {
    const ts = num(a.ts);
    if (ts == null) continue;
    const dur = clampDur(num(a.durationSec) ?? 60);
    const kcal = num(a.kcal);
    items.push({
      client_id: str(a.client_id) ?? `legacy-act-${ts}`,
      kind: "SPORT",
      title: str(a.sportName) ?? "Deporte",
      started_at: isoStart(ts, dur),
      duration_sec: dur,
      rpe: rpeOf(a.rpe),
      kcal: kcal != null ? Math.min(20_000, Math.max(0, Math.round(kcal))) : null,
      detail: { sport_key: str(a.sportKey), intensity: str(a.intensity) },
    });
  }

  for (const s of legacy("flp_mma")) {
    const ts = num(s.ts);
    if (ts == null) continue;
    const dur = clampDur((num(s.minutes) ?? 1) * 60);
    items.push({
      client_id: str(s.client_id) ?? `legacy-mma-${ts}`,
      kind: "MMA",
      title: str(s.art) ?? "MMA",
      started_at: isoStart(ts, dur),
      duration_sec: dur,
      rpe: rpeOf(s.rpe),
      note: (str(s.notes) ?? "").slice(0, 2000),
      detail: { art: str(s.art), work_type: str(s.type) ?? str(s.mode), partner: str(s.partner) },
    });
  }

  for (const g of legacy("flp_gym_sessions")) {
    const ts = num(g.ts);
    if (ts == null) continue;
    const dur = clampDur(num(g.durationSec) ?? 60);
    let detail: Record<string, unknown> = {
      focus: str(g.focus),
      volume_kg: num(g.volume),
      exercises: Array.isArray(g.exercises) ? g.exercises : null,
    };
    try {
      if (JSON.stringify(detail).length > 8000) detail = { focus: str(g.focus), volume_kg: num(g.volume) };
    } catch { detail = { focus: str(g.focus) }; }
    items.push({
      client_id: str(g.client_id) ?? `legacy-gym-${ts}`,
      kind: "GYM",
      title: str(g.focus) ?? "Gimnasio",
      started_at: isoStart(ts, dur),
      duration_sec: dur,
      rpe: rpeOf(g.rpe),
      detail,
    });
  }

  // Dedup por client_id (ts repetidos al fusionar backups): el primero gana
  const seen = new Set<string>();
  return items.filter((i) => (seen.has(i.client_id) ? false : (seen.add(i.client_id), true)));
}

/** Sube el historial legacy una sola vez. Un único uid puede reclamarlo por
    dispositivo: en un móvil compartido, B no debe heredar los entrenos de A. */
export async function migrateLocalActivities(): Promise<void> {
  if (typeof window === "undefined") return;
  const uid = await resolveUidFresh();
  if (!uid) return;
  try {
    if (localStorage.getItem(migratedKey(uid)) === "1") return;
    const owner = localStorage.getItem(LEGACY_OWNER_KEY);
    if (owner && owner !== uid) return; // el legacy es de otra cuenta
    localStorage.setItem(LEGACY_OWNER_KEY, uid);
  } catch { return; }
  const items = legacyItems();
  if (items.length > 0) appendToQueue(queueKey(uid), items);
  const flushed = await flushActivities();
  if (flushed) {
    try { localStorage.setItem(migratedKey(uid), "1"); } catch { /* noop */ }
  }
}

/* -------------------------------- métricas -------------------------------- */

/** Métricas de carga del servidor (fuente de verdad). Read-your-writes real:
    si quedan pendientes sin subir devuelve null y la vista conserva las
    métricas locales (que sí incluyen lo pendiente). */
export async function fetchServerMetrics(): Promise<LoadMetrics | null> {
  if (typeof window === "undefined") return null;
  try {
    await migrateLocalActivities();
    const flushed = await flushActivities();
    if (!flushed) return null;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const res = await fetch(`/api/proxy/activities/metrics?tz=${encodeURIComponent(tz)}`);
    if (!res.ok) return null;
    const d = (await res.json()) as {
      week_au: number; daily7: number[]; acwr: number | null; provisional: boolean;
      monotonia: number | null; tension: number | null; sin_variacion: boolean; history_days: number;
    };
    if (typeof d.week_au !== "number" || !Array.isArray(d.daily7)) return null;
    return {
      weekAU: d.week_au,
      daily7: d.daily7,
      acwr: d.acwr,
      provisional: d.provisional,
      monotonia: d.monotonia,
      tension: d.tension,
      sinVariacion: d.sin_variacion,
      historyDays: d.history_days,
    };
  } catch {
    return null;
  }
}
