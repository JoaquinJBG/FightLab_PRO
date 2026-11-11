// Sesión de batch a pantalla completa (fase 12): el reloj de la sesión, los carriles por aparato y
// los temporizadores de cada paso. Funciones puras: la pantalla guarda el estado en localStorage
// para que un recargo o un bloqueo del móvil no lo pierda.

import type { TimelineStep } from "./menu";

export type BatchClock = {
  startedAt: number | null; // ms
  pausedAt: number | null; // ms, mientras está en pausa
  pausedMs: number; // pausa acumulada
  done: number[]; // pasos marcados como hechos (índice en el cronograma)
  timers: Record<string, number>; // índice → fin del temporizador del paso (ms)
};

export const EMPTY_CLOCK: BatchClock = { startedAt: null, pausedAt: null, pausedMs: 0, done: [], timers: {} };

export function storageKey(menuId: number, date: string): string {
  return `flp_batch_${menuId}_${date}`;
}

export function readClock(key: string): BatchClock {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!raw || typeof raw !== "object") return EMPTY_CLOCK;
    return {
      startedAt: typeof raw.startedAt === "number" ? raw.startedAt : null,
      pausedAt: typeof raw.pausedAt === "number" ? raw.pausedAt : null,
      pausedMs: typeof raw.pausedMs === "number" ? raw.pausedMs : 0,
      done: Array.isArray(raw.done) ? raw.done.filter((n: unknown) => typeof n === "number") : [],
      timers: raw.timers && typeof raw.timers === "object" ? raw.timers : {},
    };
  } catch {
    return EMPTY_CLOCK;
  }
}

export function writeClock(key: string, clock: BatchClock): void {
  try {
    localStorage.setItem(key, JSON.stringify(clock));
  } catch {
    // sin almacenamiento (modo privado): la sesión sigue, solo no se recuerda
  }
}

/** Segundos de sesión transcurridos (sin las pausas). */
export function elapsedSec(clock: BatchClock, now: number): number {
  if (clock.startedAt == null) return 0;
  const end = clock.pausedAt ?? now;
  return Math.max(0, Math.floor((end - clock.startedAt - clock.pausedMs) / 1000));
}

export function start(clock: BatchClock, now: number): BatchClock {
  if (clock.startedAt == null) return { ...clock, startedAt: now, pausedAt: null, pausedMs: 0 };
  if (clock.pausedAt != null) return { ...clock, pausedAt: null, pausedMs: clock.pausedMs + (now - clock.pausedAt) };
  return clock;
}

export function pause(clock: BatchClock, now: number): BatchClock {
  return clock.startedAt != null && clock.pausedAt == null ? { ...clock, pausedAt: now } : clock;
}

export function toggleDone(clock: BatchClock, index: number): BatchClock {
  const done = clock.done.includes(index) ? clock.done.filter((i) => i !== index) : [...clock.done, index];
  return { ...clock, done };
}

/** Arranca (o para) el temporizador propio de un paso, de su duración. */
export function toggleTimer(clock: BatchClock, index: number, step: TimelineStep, now: number): BatchClock {
  const timers = { ...clock.timers };
  if (timers[index] != null) delete timers[index];
  else timers[index] = now + (step.until - step.min) * 60_000;
  return { ...clock, timers };
}

export function timerLeft(clock: BatchClock, index: number, now: number): number | null {
  const end = clock.timers[index];
  return end == null ? null : Math.max(0, Math.ceil((end - now) / 1000));
}

export type StepStatus = "done" | "now" | "late" | "next";

/** Estado de un paso según el reloj: hecho (marcado), ahora (en su tramo), con retraso (su tramo
 * ya pasó y no está marcado) o pendiente. */
export function stepStatus(step: TimelineStep, index: number, clock: BatchClock, elapsed: number): StepStatus {
  if (clock.done.includes(index)) return "done";
  if (elapsed >= step.until * 60) return "late";
  if (elapsed >= step.min * 60) return "now";
  return "next";
}

export type Lane = { where: string; steps: { step: TimelineStep; index: number }[] };

/** Los pasos agrupados por aparato, en el orden del cronograma. */
export function lanes(timeline: TimelineStep[]): Lane[] {
  const out: Lane[] = [];
  timeline.forEach((step, index) => {
    let lane = out.find((l) => l.where === step.where);
    if (!lane) {
      lane = { where: step.where, steps: [] };
      out.push(lane);
    }
    lane.steps.push({ step, index });
  });
  return out;
}

/** Lo que toca ahora en un aparato: el primer paso sin marcar y cuánto le queda según el reloj. */
export function laneNow(lane: Lane, clock: BatchClock, elapsed: number): { index: number; step: TimelineStep; left: number; started: boolean } | null {
  const next = lane.steps.find(({ index }) => !clock.done.includes(index));
  if (!next) return null;
  const started = elapsed >= next.step.min * 60;
  const left = started ? Math.max(0, next.step.until * 60 - elapsed) : Math.max(0, next.step.min * 60 - elapsed);
  return { index: next.index, step: next.step, left, started };
}

export function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}
