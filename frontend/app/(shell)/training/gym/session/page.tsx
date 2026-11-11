"use client";

import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { formatNumber, intlLocale } from "@/lib/locale";
import { TrainingIcon, InfoIcon } from "@/components/icons";
import {
  FOCUS_EXERCISES,
  EXERCISE_KEYS,
  FOCUS_KEYS,
  GYM_LIVE_KEY,
  GYM_REST_KEY,
  MAX_DETAIL_CHARS,
  exerciseStats,
  previousSet,
  DEFAULT_RPE,
  savedExercises,
  sessionTotals,
  incompleteSets,
  restoreExercise,
  buildActivityDetail,
  gymSets,
  pushGymSession,
  loadGymSessions,
  gymSessionFromServer,
  gymSessionFromPending,
  type ExerciseEntry,
  type LiveGym,
  type GymSession,
  type SetEntry,
} from "@/lib/gym";
import {
  bestRecord,
  detectRecords,
  freeSuperset,
  nextInSuperset,
  nextSetType,
  nextWorkSetIndex,
  parseNum,
  setLabels,
  supersetGroups,
  type RecordKind,
} from "@/lib/gym-log";
import {
  exerciseId,
  effortModeOf,
  exercisesFromStart,
  fetchRoutineStart,
  recordFor,
  updateRoutineFromSession,
  useRecords,
  type RoutineStart,
} from "@/lib/gym-api";
import { fetchServerActivities, firstReason, mergeByClientId, pendingQueueItems, saveActivityNow } from "@/lib/activities";
import { useWeeklyPlan } from "@/lib/plan";
import { gymStats, useLastStats } from "@/lib/strength";
import { GYM_INCLUDES, type GymInclude } from "@/lib/session-check";
import { VigorousWarning } from "@/components/safety/VigorousWarning";
import { ExercisePicker } from "@/components/exercises/ExercisePicker";
import { SetRow } from "@/components/gym/SetRow";
import { PlateCalculator } from "@/components/gym/PlateCalculator";

function fmtClock(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function beep(freq: number, dur: number, gain = 0.3) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur);
    o.onended = () => ctx.close();
  } catch { /* sin audio */ }
}

/** Aviso del fin del descanso con la app en segundo plano o la pantalla apagada: el reloj es
    de pared (como el de Deportes) y, si hay permiso, sale una notificación del service worker. */
function notifyRestDone(text: string) {
  try {
    if (typeof document === "undefined" || !document.hidden) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    void navigator.serviceWorker?.ready.then((reg) => reg.showNotification(text, { tag: "flp-rest", silent: false }));
  } catch { /* noop */ }
}

const REST_OPTS = [60, 90, 120];
const EXERCISE_REST_OPTS = [0, 30, 45, 60, 75, 90, 120, 150, 180, 240, 300];
const EFFORT_KEY = "flp_gym_effort";

const blankSet = (): SetEntry => ({ kg: "", reps: "", done: false });

function SessionInner() {
  const t = useTranslations("training.gymSession");
  const tg = useTranslations("training.gym");
  const tp = useTranslations("weeklyPlan");
  const locale = intlLocale(useLocale());
  const focusLabel = (f: string) => (FOCUS_KEYS[f] ? tg(`foci.${FOCUS_KEYS[f]}`) : f);
  const exLabel = (n: string) => (EXERCISE_KEYS[n] ? tg(`exercises.${EXERCISE_KEYS[n]}`) : n);
  const router = useRouter();
  const params = useSearchParams();
  const focusParam = params.get("focus");
  // Sesión del plan de la semana (Mi rutina → "Empezar sesión A"): se rellena con sus ejercicios.
  const planParam = params.get("plan");
  // F17: empezar desde una rutina (`?routine=<id>`, botón «Empezar entreno» de Rutinas).
  const routineParam = Number(params.get("routine")) || null;
  const [planSession, setPlanSession] = useState<string | null>(null);
  const [filledFrom, setFilledFrom] = useState<number | null>(null);
  const { data: planState } = useWeeklyPlan(planParam !== null);

  const [focus, setFocus] = useState<string | null>(null);
  const [routine, setRoutine] = useState<{ id: number; title: string } | null>(null);
  const [routineSafety, setRoutineSafety] = useState<RoutineStart["safety"] | null>(null);
  const [routineError, setRoutineError] = useState(false);
  const [exercises, setExercisesRaw] = useState<ExerciseEntry[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [phase, setPhase] = useState<"live" | "summary">("live");
  const [rpe, setRpe] = useState<number | null>(DEFAULT_RPE);
  const [rpeInfo, setRpeInfo] = useState(false);
  const [confirm, setConfirm] = useState<"finish" | "discard" | null>(null);
  const [undos, setUndos] = useState<{ ex: ExerciseEntry; index: number }[]>([]);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [includes, setIncludes] = useState<GymInclude[]>([]);
  const [effort, setEffort] = useState<"rpe" | "rir">("rpe");
  const [menuFor, setMenuFor] = useState<number | null>(null);
  const [notesOpen, setNotesOpen] = useState<Record<number, boolean>>({});
  const [plates, setPlates] = useState<{ ei: number; kg: number | null } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [nextHint, setNextHint] = useState<number | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Guardar (F2): lo que dice el servidor si no acepta la sesión
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [updateRoutine, setUpdateRoutine] = useState(false);

  // descanso entre series (por ejercicio, con el de por defecto)
  const [restDur, setRestDur] = useState(90);
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const restDone = useRef(false);

  const [adding, setAdding] = useState(false);

  /* ---------- historial para "Última vez"/PR: local + servidor (otro dispositivo) ---------- */
  const [gymHistory, setGymHistory] = useState<GymSession[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGymHistory(loadGymSessions());
    let alive = true;
    fetchServerActivities("GYM").then((server) => {
      if (!alive) return;
      setHistoryReady(true);
      if (!server) return;
      const pending = pendingQueueItems("GYM").map(gymSessionFromPending);
      const merged = mergeByClientId(loadGymSessions(), pending, server.map(gymSessionFromServer));
      merged.sort((a, b) => b.ts - a.ts);
      setGymHistory(merged);
    });
    return () => { alive = false; };
  }, []);

  /* ---------- arranque: reanudar sesión viva o empezar nueva ---------- */
  // R4-14: abrir una pantalla de entreno NO deja un entreno en marcha. El borrador solo se guarda
  // cuando el usuario mete datos o pulsa «Empezar» (`engaged`). Y si ya hay un entreno en marcha
  // distinto del que se abre, se pregunta: «Seguir» ese o «Descartar» y abrir el nuevo.
  const [engaged, setEngaged] = useState(false);
  const [conflict, setConflict] = useState<LiveGym | null>(null);

  function restoreLive(live: LiveGym) {
    setFocus(live.focus);
    setExercisesRaw(live.exercises);
    setStartedAt(live.startedAt);
    setPlanSession(live.plan ?? null);
    setRoutine(live.routine ?? null);
    if (live.restUntil && live.restUntil > Date.now()) setRestUntil(live.restUntil);
    setFilledFrom(-1);
    setEngaged(true);
  }
  function startFresh() {
    setEngaged(false);
    if (routineParam) {
      setFocus(null);
      setExercisesRaw([]);
      setStartedAt(Date.now());
      fetchRoutineStart(routineParam)
        .then((start) => {
          setRoutine({ id: start.routine_id, title: start.title });
          setRoutineSafety(start.safety ?? null);
          setExercisesRaw(exercisesFromStart(start));
          const mode = effortModeOf(start);
          if (mode) setEffort(mode); // R4-7: la sesión abre en el modo de esfuerzo de la rutina
        })
        .catch(() => setRoutineError(true));
    } else if (planParam) {
      setFocus(null);
      setPlanSession(planParam);
      setExercisesRaw([]);
      setStartedAt(Date.now());
    } else {
      const f = focusParam && FOCUS_EXERCISES[focusParam] ? focusParam : null;
      setFocus(f);
      setExercisesRaw((f ? FOCUS_EXERCISES[f] : []).map((name) => ({ name, sets: [blankSet()] })));
      setStartedAt(Date.now());
    }
  }
  useEffect(() => {
    let live: LiveGym | null = null;
    try {
      const raw = localStorage.getItem(GYM_LIVE_KEY);
      if (raw) {
        const parsed: LiveGym = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.exercises) && Date.now() - parsed.savedAt < 12 * 3600_000) live = parsed;
      }
      const rd = Number(localStorage.getItem(GYM_REST_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (REST_OPTS.includes(rd)) setRestDur(rd);
      if (localStorage.getItem(EFFORT_KEY) === "rir") setEffort("rir");
    } catch { /* sesión corrupta */ }

    const opensOther =
      live !== null &&
      ((routineParam !== null && live.routine?.id !== routineParam) ||
        (routineParam === null && planParam !== null && live.plan !== planParam) ||
        (routineParam === null && planParam === null && focusParam !== null && live.focus !== focusParam));
    if (live && opensOther) {
      setConflict(live);
    } else if (live) {
      restoreLive(live);
    } else {
      startFresh();
    }
    setNow(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function keepRunning() {
    if (!conflict) return;
    restoreLive(conflict);
    setConflict(null);
  }
  function discardRunning() {
    try { localStorage.removeItem(GYM_LIVE_KEY); } catch { /* noop */ }
    setConflict(null);
    startFresh();
  }
  /** Lo que el usuario cambia a mano: desde ahí hay entreno en marcha (y corre el reloj). */
  const setExercises: typeof setExercisesRaw = (u) => {
    if (!engaged) {
      setEngaged(true);
      // eslint-disable-next-line react-hooks/purity
      setStartedAt(Date.now());
    }
    setExercisesRaw(u);
  };

  /* ---------- ejercicios de la sesión del plan (cargas del motor; sin carga, vacío) ---------- */
  const activePlan = planState?.active;
  const planSessionData = planSession && activePlan ? activePlan.sessions.find((s) => s.key === planSession) : undefined;
  if (planSessionData && activePlan && filledFrom === null) {
    setFilledFrom(activePlan.id);
    setExercisesRaw(
      planSessionData.items
        .filter((i) => i.sets > 0)
        .map((i) => ({
          name: i.exercise,
          sets: Array.from({ length: i.sets }, () => ({ kg: i.load_kg !== null ? String(i.load_kg) : "", reps: "", done: false })),
        })),
    );
  }

  /* ---------- reloj de sesión (wall-clock) ---------- */
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    const wake = () => setNow(Date.now()); // al volver de segundo plano, al momento
    document.addEventListener("visibilitychange", wake);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", wake); };
  }, []);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  const { data: serverStats } = useLastStats(exercises.map((x) => x.name));
  // Récords de antes de este entreno (F17): para avisar al batirlos
  const { data: records } = useRecords(exercises.map(exerciseId));

  /* ---------- persistencia de la sesión viva ---------- */
  useEffect(() => {
    if (phase !== "live" || startedAt === null || !engaged || conflict) return; // R4-14: sin borrador hasta que empieza
    try {
      localStorage.setItem(
        GYM_LIVE_KEY,
        JSON.stringify({ startedAt, focus, exercises, savedAt: Date.now(), plan: planSession, routine, restUntil } satisfies LiveGym),
      );
    } catch { /* sin espacio */ }
  }, [exercises, focus, startedAt, phase, planSession, routine, restUntil, engaged, conflict]);

  /* ---------- wake lock ---------- */
  useEffect(() => {
    if (phase !== "live") return;
    let lock: { release?: () => Promise<void> } | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release?: () => Promise<void> }> } };
    nav.wakeLock?.request("screen").then((l) => { if (cancelled) l.release?.(); else lock = l; }).catch(() => {});
    return () => { cancelled = true; lock?.release?.().catch(() => {}); };
  }, [phase]);

  /* ---------- descanso ---------- */
  const restLeft = restUntil ? Math.max(0, Math.ceil((restUntil - now) / 1000)) : null;
  useEffect(() => {
    if (restUntil === null) return;
    if (restLeft !== null && restLeft <= 0 && !restDone.current) {
      restDone.current = true;
      beep(880, 0.15);
      setTimeout(() => beep(880, 0.2), 180);
      try { navigator.vibrate?.([150, 80, 150]); } catch { /* noop */ }
      notifyRestDone(t("restOver"));
      setRestUntil(null);
    }
  }, [restLeft, restUntil, t]);
  // Con la app en segundo plano el intervalo se frena: un temporizador al fin exacto del descanso.
  useEffect(() => {
    if (restUntil === null) return;
    const id = setTimeout(() => setNow(Date.now()), Math.max(0, restUntil - Date.now()) + 50);
    return () => clearTimeout(id);
  }, [restUntil]);

  function startRest(seconds: number) {
    if (seconds <= 0) return;
    restDone.current = false;
    // eslint-disable-next-line react-hooks/purity
    setRestUntil(Date.now() + seconds * 1000);
  }
  function changeRest(v: number) {
    setRestDur(v);
    try { localStorage.setItem(GYM_REST_KEY, String(v)); } catch { /* noop */ }
  }
  function changeEffort(v: "rpe" | "rir") {
    setEffort(v);
    try { localStorage.setItem(EFFORT_KEY, v); } catch { /* noop */ }
  }
  const restOf = (x: ExerciseEntry) => (x.restS ?? restDur);

  function showToast(text: string) {
    setToast(text);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }

  /* ---------- edición de ejercicios/series ---------- */
  const patchExercise = (ei: number, patch: Partial<ExerciseEntry>) =>
    setExercises((xs) => xs.map((x, i) => (i === ei ? { ...x, ...patch } : x)));
  function patchSet(ei: number, si: number, patch: Partial<SetEntry>) {
    setExercises((xs) =>
      xs.map((x, i) => (i !== ei ? x : { ...x, sets: x.sets.map((s, j) => (j !== si ? s : { ...s, ...patch })) })),
    );
  }
  function applyPreviousSet(ei: number, si: number, set: { kg: number; reps: number }) {
    patchSet(ei, si, { kg: String(set.kg).replace(".", ","), reps: String(set.reps) });
  }
  function toggleDone(ei: number, si: number) {
    const x = exercises[ei];
    const set = x?.sets[si];
    if (!x || !set) return;
    const willComplete = !set.done;
    let pr: RecordKind[] = [];
    if (willComplete) {
      const kg = parseNum(set.kg) ?? 0;
      const reps = parseNum(set.reps) ?? 0;
      const today = x.sets
        .filter((s, j) => j !== si && s.done)
        .map((s) => ({ kg: parseNum(s.kg) ?? 0, reps: parseNum(s.reps) ?? 0, type: s.type, rpe: parseNum(s.rpe), rir: parseNum(s.rir) }));
      pr = bestRecord(detectRecords({ kg, reps, type: set.type, rpe: parseNum(set.rpe), rir: parseNum(set.rir) }, recordFor(records, x), today));
      if (pr.length > 0) showToast(t("newRecord", { name: exLabel(x.name), what: pr.map((r) => t(`records.${r}`)).join(" · ") }));
    }
    patchSet(ei, si, { done: willComplete, pr: willComplete && pr.length ? pr : undefined });
    if (!willComplete) return;
    // Superserie: se pasa al siguiente del grupo; el descanso, tras el último (como Hevy)
    const next = nextInSuperset(exercises, ei);
    if (next && !next.last) {
      setNextHint(next.index);
      cardRefs.current[next.index]?.scrollIntoView?.({ behavior: "smooth", block: "start" });
      return;
    }
    setNextHint(null);
    startRest(restOf(x));
  }
  function addSet(ei: number) {
    setExercises((xs) =>
      xs.map((x, i) => {
        if (i !== ei) return x;
        const prev = x.sets[x.sets.length - 1];
        return { ...x, sets: [...x.sets, { kg: prev?.kg ?? "", reps: prev?.reps ?? "", done: false, ...(prev?.type && prev.type !== "warmup" ? { type: prev.type } : {}) }] };
      }),
    );
  }
  function removeSet(ei: number, si: number) {
    setExercises((xs) => xs.map((x, i) => (i !== ei ? x : { ...x, sets: x.sets.filter((_, j) => j !== si) })));
  }
  function removeExercise(ei: number) {
    const ex = exercises[ei];
    if (!ex) return;
    setExercises((xs) => normaliseSupersets(xs.filter((_, i) => i !== ei)));
    setUndos((u) => [...u, { ex, index: ei }]);
    setMenuFor(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndos([]), 8000);
  }
  function undoRemove() {
    const last = undos[undos.length - 1];
    if (!last) return;
    setExercises((xs) => restoreExercise(xs, last.ex, last.index));
    setUndos((u) => u.slice(0, -1));
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndos([]), 8000);
  }
  useEffect(() => () => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (toastTimer.current) clearTimeout(toastTimer.current);
  }, []);
  function addExercise(name: string, key: string | null) {
    setExercises((xs) =>
      xs.some((x) => (key ? x.key === key : x.name === name)) ? xs : [...xs, { name, key, sets: [blankSet()] }],
    );
  }
  function move(ei: number, dir: -1 | 1) {
    setExercises((xs) => {
      const to = ei + dir;
      if (to < 0 || to >= xs.length) return xs;
      const out = [...xs];
      [out[ei], out[to]] = [out[to], out[ei]];
      return out;
    });
    setMenuFor(null);
  }
  function linkWithNext(ei: number) {
    setExercises((xs) => {
      if (ei + 1 >= xs.length) return xs;
      const group = xs[ei].superset ?? xs[ei + 1].superset ?? freeSuperset(xs);
      return xs.map((x, i) => (i === ei || i === ei + 1 ? { ...x, superset: group } : x));
    });
    setMenuFor(null);
  }
  function unlink(ei: number) {
    setExercises((xs) => normaliseSupersets(xs.map((x, i) => (i === ei ? { ...x, superset: null } : x))));
    setMenuFor(null);
  }

  /* ---------- terminar y guardar ---------- */
  const parsedExercises = savedExercises(exercises);
  // El resumen sale de lo mismo que se envía (`gymSets`): enseña lo que se guarda (F2)
  const sentSets = gymSets(parsedExercises);
  const { volume } = sessionTotals(parsedExercises);
  const totalSets = sentSets.length;
  const incomplete = incompleteSets(exercises);
  const planned: Record<string, unknown> = {
    ...(planSession ? { plan_session: planSession } : {}),
    ...(routine ? { routine_id: routine.id } : {}),
    ...(includes.length > 0 ? { includes } : {}),
  };
  const detailMax = MAX_DETAIL_CHARS - (Object.keys(planned).length > 0 ? JSON.stringify(planned).length : 0);
  const breakdownFits = buildActivityDetail(focus, volume, parsedExercises, detailMax).breakdown;
  const recordsBroken = exercises.reduce((a, x) => a + x.sets.filter((s) => s.done && s.pr?.length).length, 0);
  const title = focus ? t("workoutFocus", { focus: focusLabel(focus) }) : routine ? routine.title : planSession ? tp("session", { key: planSession }) : t("workout");

  function finish() {
    setMenuFor(null);
    if (incomplete.tickedEmpty + incomplete.unticked + incomplete.impossible > 0) setConfirm("finish");
    else {
      setConfirm(null);
      setPhase("summary");
    }
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setSaveError(null);
    const capped = Math.min(elapsed, 4 * 3600);
    const minutes = capped / 60;
    // eslint-disable-next-line react-hooks/purity
    const ts = Date.now();
    const clientId = crypto.randomUUID();
    const { detail } = buildActivityDetail(focus, volume, parsedExercises, detailMax);
    const result = await saveActivityNow({
      client_id: clientId,
      kind: "GYM",
      title: (focus ?? routine?.title ?? "Gimnasio").slice(0, 80),
      started_at: new Date(ts - capped * 1000).toISOString(),
      duration_sec: Math.max(1, Math.round(capped)),
      rpe,
      detail: { ...detail, ...planned },
      sets: sentSets,
    });
    if (result.status === "invalid") {
      // El servidor no la acepta: se dice por qué y no se pierde nada de lo escrito
      setSaveError(firstReason(result.errors) ?? t("saveRejected"));
      setSaving(false);
      return;
    }
    pushGymSession({
      id: `${ts}`,
      client_id: clientId,
      ts,
      focus,
      durationSec: capped,
      rpe,
      load: rpe ? Math.round(minutes * rpe) : null,
      volume,
      exercises: parsedExercises,
      ...(result.status !== "queued" && result.id ? { serverId: result.id } : {}),
    });
    if (routine && updateRoutine) await updateRoutineFromSession(routine.id, parsedExercises);
    localStorage.removeItem(GYM_LIVE_KEY);
    router.push(result.status === "queued" ? "/training/gym?saved=queued" : "/training/gym?saved=1");
  }
  function discard() {
    localStorage.removeItem(GYM_LIVE_KEY);
    router.push("/training/gym");
  }

  /* ===================== ENTRENO YA EN MARCHA (R4-14) ===================== */
  if (conflict) {
    return (
      <div className="pt-4 pb-24">
        <Link href="/training/gym" className="t-label inline-flex min-h-11 items-center text-muted">{t("backToGym")}</Link>
        <div role="alertdialog" aria-label={t("conflictTitle")} data-testid="live-conflict" className="glass mt-3 p-4">
          <h1 className="t-title text-lg text-ink">{t("conflictTitle")}</h1>
          <p className="t-body mt-1 text-sm text-muted">{t("conflictBody", { what: t("conflictWhat", { n: conflict.exercises.length }) })}</p>
          <div className="mt-3 flex gap-3">
            <button onClick={discardRunning} className="btn btn-outline min-h-11 flex-1">{t("conflictDiscard")}</button>
            <button onClick={keepRunning} className="btn btn-primary min-h-11 flex-1">{t("conflictKeep")}</button>
          </div>
        </div>
      </div>
    );
  }

  /* ============================ RESUMEN ============================ */
  if (phase === "summary") {
    return (
      <div className="pt-4 pb-8">
        <h1 className="t-display text-2xl text-ink">{t("howWasIt")}</h1>
        <div className="glass neon-edge mt-4 p-5">
          <p className="t-title text-ink">{focus ? t("workoutFocus", { focus: focusLabel(focus) }) : routine ? routine.title : t("gymWorkout")}</p>
          <div className="mt-3 flex justify-between text-center">
            <div><p className="stat text-xl text-ink">{fmtClock(elapsed)}</p><p className="t-label text-muted">{t("duration")}</p></div>
            <div><p data-testid="summary-sets" className="stat text-xl text-ink">{totalSets}</p><p className="t-label text-muted">{t("setsLabel", { n: totalSets })}</p></div>
            <div><p data-testid="summary-volume" className="stat text-xl neon-text">{volume.toLocaleString(locale)}</p><p className="t-label text-muted">{t("totalKg")}</p></div>
          </div>
          {recordsBroken > 0 && <p className="t-body mt-2 text-center text-xs text-neon">{t("recordsBroken", { n: recordsBroken })}</p>}
          {parsedExercises.length > 0 && (
            <ul data-testid="summary-list" className="mt-3 flex flex-col gap-2 border-t border-[rgba(150,190,255,0.1)] pt-3">
              {parsedExercises.map((x, i) => (
                <li key={`${x.key ?? x.name}-${i}`} className="t-body text-xs text-muted">
                  <div className="flex justify-between">
                    <span className="text-ink">{exLabel(x.name)}</span>
                    <span className="text-ink">{t("setCount", { n: x.sets.length })}</span>
                  </div>
                  <p className="mt-0.5">
                    {x.sets.map((s, j) => (
                      <span key={j} className="mr-2 inline-block">
                        {s.type && s.type !== "normal" ? `${t(`setTypeShort.${s.type}`)} ` : ""}
                        {s.kg > 0 ? t("previewKg", { kg: s.kg.toLocaleString(locale), reps: s.reps }) : t("previewReps", { reps: s.reps })}
                      </span>
                    ))}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {incomplete.impossible > 0 && (
            <p role="status" className="t-body mt-2 text-[11px] text-[#ffd08a]">{t("impossibleNotSaved", { n: incomplete.impossible })}</p>
          )}
        </div>

        <div className="glass mt-4 p-4">
          <div className="flex items-center gap-1.5">
            <p className="t-label text-ink">{t("sessionEffort")}</p>
            <button type="button" onClick={() => setRpeInfo((v) => !v)} aria-label={t("whatIsRpe")}
              className={`flex h-11 w-11 items-center justify-center ${rpeInfo ? "text-neon" : "text-muted hover:text-neon"}`}>
              <InfoIcon className="h-3.5 w-3.5" />
            </button>
          </div>
          {rpeInfo && <p className="t-body mt-2 rounded-xl border border-[rgba(150,190,255,0.12)] bg-[rgba(255,255,255,0.04)] p-2.5 text-xs text-[#cdd9ef]">{t("rpeInfo")}</p>}
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" onClick={() => setRpe(n)} aria-pressed={rpe === n}
                className="min-h-11 rounded-xl py-2 text-sm font-medium transition-colors"
                style={rpe === n
                  ? { background: "linear-gradient(180deg,#45e9ff,#3b74ff)", color: "#03101c" }
                  : { background: "rgba(255,255,255,0.05)", color: "var(--color-muted)" }}>
                {n}
              </button>
            ))}
          </div>
          {rpe && (
            <p className="t-body mt-2.5 text-center text-xs text-muted">
              {t.rich("loadLine", { au: Math.round((elapsed / 60) * rpe), neon: (c) => <span className="text-neon">{c}</span> })}
            </p>
          )}
        </div>

        <div className="glass mt-4 p-4">
          <p className="t-label text-ink">{t("includesTitle")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {GYM_INCLUDES.map((i) => (
              <button key={i} type="button" aria-pressed={includes.includes(i)}
                onClick={() => setIncludes((xs) => (xs.includes(i) ? xs.filter((x) => x !== i) : [...xs, i]))}
                className={`badge ${includes.includes(i) ? "badge-neon" : ""}`}>
                {t(`includes.${i}`)}
              </button>
            ))}
          </div>
          <VigorousWarning params={includes.length > 0 ? { kind: "GYM", includes } : null} />
        </div>

        {routine && (
          <label className="glass mt-4 flex min-h-11 items-center gap-3 p-4">
            <input type="checkbox" checked={updateRoutine} onChange={(e) => setUpdateRoutine(e.target.checked)} className="h-5 w-5" />
            <span className="t-body text-sm text-ink">{t("updateRoutine", { title: routine.title })}</span>
          </label>
        )}

        {saveError && (
          <p role="alert" data-testid="save-error" className="t-body mt-4 rounded-xl border border-[rgba(255,107,107,0.4)] p-3 text-sm text-[#ff8a8a]">
            {t("saveRejectedWhy", { reason: saveError })}
          </p>
        )}

        <div className="mt-4 flex gap-3">
          <button onClick={() => { setConfirm(null); setPhase("live"); }} className="btn btn-outline min-h-11 flex-1">{t("back")}</button>
          <button onClick={() => void save()} disabled={totalSets === 0 || saving} className="btn btn-primary flex-1 min-h-11 disabled:opacity-60">{saving ? t("saving") : t("save")}</button>
        </div>
        {totalSets === 0 && <p className="t-body mt-2 text-center text-[11px] text-muted">{t("saveHint")}</p>}
        {totalSets > 0 && !breakdownFits && (
          <p role="status" className="t-body mt-2 rounded-xl border border-[rgba(255,180,80,0.3)] p-2.5 text-center text-[11px] text-[#ffd08a]">
            {t("breakdownLocalOnly")}
          </p>
        )}
        {confirm === "discard" ? (
          <ConfirmBar text={t("discardConfirm")} confirmLabel={t("discardConfirmBtn")} cancelLabel={t("cancel")} onConfirm={discard} onCancel={() => setConfirm(null)} />
        ) : (
          <button onClick={() => setConfirm("discard")} className="t-label mt-3 min-h-11 w-full text-center text-muted">{t("discard")}</button>
        )}
      </div>
    );
  }

  /* ============================ EN VIVO ============================ */
  const lastUndo = undos[undos.length - 1];
  const undoAt = lastUndo ? Math.min(lastUndo.index, exercises.length) : -1;
  const undoBar = lastUndo && (
    <div role="status" className="glass flex items-center justify-between gap-3 px-4 py-1">
      <span className="t-body min-w-0 truncate text-xs text-ink">
        {t("removed", { name: exLabel(lastUndo.ex.name), more: undos.length - 1 })}
      </span>
      <button onClick={undoRemove} className="t-label min-h-11 shrink-0 px-2 text-neon">{t("undo")}</button>
    </div>
  );
  const groups = supersetGroups(exercises);
  const resting = restLeft !== null && restLeft > 0;
  const paused = routineSafety?.paused ?? [];
  const safetyReasons = (routineSafety?.reasons ?? []).map((r) => r.text).filter((x): x is string => !!x);

  return (
    // F18: con el descanso en marcha, sitio de sobra debajo para que la barra no tape «Terminar»
    <div className={`pt-4 ${resting ? "pb-48" : "pb-24"}`}>
      <div className="flex items-center justify-between">
        <Link href="/training/gym" className="t-label inline-flex min-h-11 items-center text-muted">{t("backToGym")}</Link>
        <span className="stat text-lg text-neon tabular-nums">{fmtClock(elapsed)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-neon"><TrainingIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{title}</h1>
      </div>

      {!engaged && exercises.length > 0 && (
        <button type="button" data-testid="start-now" onClick={() => { setEngaged(true); setStartedAt(Date.now()); }}
          className="btn btn-primary mt-3 min-h-11 w-full">{t("startNow")}</button>
      )}

      {routineError && <p role="alert" className="t-body mt-3 text-sm text-[#ffd08a]">{t("routineLoadError")}</p>}
      {(routineSafety?.blocked || paused.length > 0 || safetyReasons.length > 0) && (
        <div role="status" data-testid="routine-safety" className="glass mt-3 border border-[rgba(255,180,80,0.3)] p-3">
          {routineSafety?.blocked && <p className="t-body text-sm text-[#ffd08a]">{t("routineBlocked")}</p>}
          {paused.length > 0 && <p className="t-body text-sm text-[#ffd08a]">{t("routinePaused", { names: paused.map((p) => exLabel(p.name)).join(", ") })}</p>}
          {safetyReasons.length > 0 && (
            <ul className="mt-1 flex flex-col gap-0.5">
              {safetyReasons.map((r, i) => <li key={i} className="t-body text-xs text-[#ffd08a]">{r}</li>)}
            </ul>
          )}
        </div>
      )}

      {/* descanso por defecto y RPE/RIR */}
      <div className="glass mt-3 flex flex-wrap items-center justify-between gap-2 p-3">
        <span className="t-label text-muted">{t("restBetweenSets")}</span>
        <div className="flex gap-1.5">
          {REST_OPTS.map((v) => (
            <button key={v} type="button" onClick={() => changeRest(v)} aria-pressed={restDur === v} className={`badge min-h-11 min-w-11 justify-center ${restDur === v ? "badge-neon" : ""}`}>
              {v}s
            </button>
          ))}
        </div>
        <span className="t-label text-muted">{t("effortMode")}</span>
        <div className="flex gap-1.5">
          {(["rpe", "rir"] as const).map((m) => (
            <button key={m} type="button" onClick={() => changeEffort(m)} aria-pressed={effort === m} className={`badge min-h-11 min-w-11 justify-center ${effort === m ? "badge-neon" : ""}`}>
              {m.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* ejercicios */}
      <div className="mt-4 flex flex-col gap-3">
        {exercises.map((x, ei) => {
          const fromHistory = exerciseStats(x.name, gymHistory, locale);
          const fromSets = gymStats(x.name, serverStats, locale);
          const stats = fromSets.fromServer
            ? { ...fromSets, prKg: [fromSets.prKg, fromHistory.prKg].reduce<number | null>((a, b) => (b === null ? a : a === null ? b : Math.max(a, b)), null) }
            : { ...fromHistory, e1rmKg: null };
          const name = exLabel(x.name);
          const labels = setLabels(x.sets);
          const group = x.superset != null ? groups[x.superset] : undefined;
          const firstOpenKg = parseNum(x.sets[nextWorkSetIndex(x.sets)]?.kg ?? x.sets[x.sets.length - 1]?.kg);
          return (
            <Fragment key={`${x.key ?? x.name}-${ei}`}>
            {undoAt === ei && undoBar}
            <div ref={(el) => { cardRefs.current[ei] = el; }} data-testid="exercise-card"
              className={`glass p-4 ${group ? "border-l-4 border-l-[#c79bff]" : ""} ${nextHint === ei ? "neon-edge" : ""}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {group && <p className="t-label text-[11px] text-[#c79bff]">{t("supersetLabel", { group })}</p>}
                  <p className="t-title text-ink">{name}</p>
                  <p className="t-body text-[11px] text-muted">
                    {stats.last ? t("lastTime", { last: stats.last }) : historyReady ? t("firstTime") : " "}
                    {stats.prKg !== null ? ` · ${t("pr", { kg: formatNumber(locale, stats.prKg, { max: 2 }) })}` : ""}
                  </p>
                  {stats.e1rmKg !== null && (
                    <p data-testid="gym-e1rm" className="t-body mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      {t("e1rm", { kg: formatNumber(locale, stats.e1rmKg, { max: 1 }) })}
                      <span className="t-label inline-flex rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-muted">{tp("conventionCoach")}</span>
                    </p>
                  )}
                </div>
                <div className="flex shrink-0">
                  <button type="button" onClick={() => setMenuFor(menuFor === ei ? null : ei)} aria-expanded={menuFor === ei}
                    aria-label={t("exerciseMenu", { name })} className="t-label flex h-11 w-11 items-center justify-center text-muted">⋯</button>
                  <button onClick={() => removeExercise(ei)} aria-label={t("removeExercise", { name })} className="t-label flex h-11 w-11 items-center justify-center text-muted hover:text-bad">✕</button>
                </div>
              </div>

              {menuFor === ei && (
                <div className="mt-2 flex flex-wrap gap-1.5" data-testid="exercise-actions">
                  <button type="button" className="badge min-h-11" onClick={() => { setNotesOpen((o) => ({ ...o, [ei]: true })); setMenuFor(null); }}>{t("addNote")}</button>
                  <button type="button" className="badge min-h-11" onClick={() => { setPlates({ ei, kg: firstOpenKg !== null && !Number.isNaN(firstOpenKg) ? firstOpenKg : null }); setMenuFor(null); }}>{t("plates.open")}</button>
                  {ei + 1 < exercises.length && <button type="button" className="badge min-h-11" onClick={() => linkWithNext(ei)}>{t("supersetWithNext")}</button>}
                  {x.superset != null && <button type="button" className="badge min-h-11" onClick={() => unlink(ei)}>{t("supersetRemove")}</button>}
                  {ei > 0 && <button type="button" className="badge min-h-11" onClick={() => move(ei, -1)}>{t("moveUp")}</button>}
                  {ei + 1 < exercises.length && <button type="button" className="badge min-h-11" onClick={() => move(ei, 1)}>{t("moveDown")}</button>}
                </div>
              )}

              {(notesOpen[ei] || x.notes) && (
                <textarea value={x.notes ?? ""} onChange={(e) => patchExercise(ei, { notes: e.target.value.slice(0, 1000) })}
                  placeholder={t("notePlaceholder")} aria-label={t("noteAria", { name })} rows={2}
                  className="field mt-2 w-full px-3 py-2 text-sm" />
              )}

              <label className="mt-2 flex items-center justify-between gap-2">
                <span className="t-label text-[11px] text-muted">{t("exerciseRest")}</span>
                <select value={x.restS ?? ""} aria-label={t("exerciseRestAria", { name })}
                  onChange={(e) => patchExercise(ei, { restS: e.target.value === "" ? null : Number(e.target.value) })}
                  className="field min-h-11 px-2 py-1 text-sm">
                  <option value="">{t("restDefault", { s: restDur })}</option>
                  {EXERCISE_REST_OPTS.map((v) => <option key={v} value={v}>{v === 0 ? t("restOff") : fmtClock(v)}</option>)}
                </select>
              </label>

              <div className="mt-3 grid grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,0.8fr)_2.75rem] items-center gap-1.5">
                <span className="t-label text-center text-muted">{t("setCol")}</span>
                <span className="t-label text-center text-muted">kg</span>
                <span className="t-label text-center text-muted">{t("reps")}</span>
                <span className="t-label text-center text-muted">{effort.toUpperCase()}</span>
                <span />
                {x.sets.map((s, si) => {
                  const prev = previousSet(x.name, si, gymHistory);
                  const preview = prev
                    ? prev.kg > 0 ? t("previewKg", { kg: formatNumber(locale, prev.kg, { max: 2 }), reps: prev.reps }) : t("previewReps", { reps: prev.reps })
                    : null;
                  return (
                    <SetRow key={si} index={si} label={labels[si]} set={s} effort={effort} preview={preview} records={s.done ? s.pr : undefined}
                      onChange={(patch) => patchSet(ei, si, patch)}
                      onCycleType={() => patchSet(ei, si, { type: nextSetType(s.type) })}
                      onDone={() => toggleDone(ei, si)}
                      onUsePreview={prev ? () => applyPreviousSet(ei, si, prev) : undefined} />
                  );
                })}
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={() => addSet(ei)} className="btn btn-tonal btn-sm min-h-11 flex-1">{t("addSet")}</button>
                {x.sets.length > 1 && !x.sets[x.sets.length - 1].done && (
                  <button onClick={() => removeSet(ei, x.sets.length - 1)} aria-label={t("removeLastSet", { name })} className="btn btn-outline btn-sm min-h-11">−</button>
                )}
              </div>
              {nextHint !== null && group && nextInSuperset(exercises, ei)?.index === nextHint && (
                <button type="button" onClick={() => cardRefs.current[nextHint]?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
                  className="t-label mt-2 min-h-11 w-full text-left text-[#c79bff]">
                  {t("supersetNext", { name: exLabel(exercises[nextHint]?.name ?? "") })}
                </button>
              )}
            </div>
            </Fragment>
          );
        })}
        {undoAt === exercises.length && undoBar}
      </div>

      {/* añadir ejercicio: el selector de la biblioteca (rama E) */}
      <div className="mt-4">
        <button onClick={() => setAdding(true)} className="btn btn-tonal min-h-11 w-full">{t("addExerciseBtn")}</button>
      </div>
      {adding && (
        <ExercisePicker multiple onClose={() => setAdding(false)} onSelect={(ex) => addExercise(ex.name, ex.key)} />
      )}

      {confirm === "finish" ? (
        <ConfirmBar
          text={[
            incomplete.tickedEmpty > 0 && t("incompleteTicked", { n: incomplete.tickedEmpty }),
            incomplete.impossible > 0 && t("impossibleNotSaved", { n: incomplete.impossible }),
            incomplete.unticked > 0 && t("incompleteUnticked", { n: incomplete.unticked }),
          ].filter(Boolean).join(" ")}
          confirmLabel={t("finishAnyway")}
          cancelLabel={t("keepEditing")}
          onConfirm={() => { setConfirm(null); setPhase("summary"); }}
          onCancel={() => setConfirm(null)}
        />
      ) : (
        <button onClick={finish} className="btn btn-primary mt-4 min-h-11 w-full">{t("finish")}</button>
      )}

      {plates && (
        <PlateCalculator initialKg={plates.kg} onClose={() => setPlates(null)}
          onUse={(kg) => {
            const ex = exercises[plates.ei];
            const si = ex ? nextWorkSetIndex(ex.sets) : -1;
            if (si >= 0) patchSet(plates.ei, si, { kg: String(kg).replace(".", ",") });
          }} />
      )}

      {toast && (
        <div role="status" data-testid="record-toast" className="fixed inset-x-0 top-3 z-50 flex justify-center px-3">
          <p className="glass glow rounded-2xl px-4 py-2.5 text-sm text-ink">{toast}</p>
        </div>
      )}

      {/* chip flotante de descanso */}
      {resting && (
        <div data-testid="rest-bar" className="fixed inset-x-0 bottom-24 z-40 flex justify-center px-2">
          <div className="glass glow flex items-center gap-3 rounded-full px-4 py-2.5">
            <span className="t-label text-muted">{t("rest")}</span>
            <span className="stat text-xl neon-text tabular-nums">{restLeft}s</span>
            <button
              onClick={() => {
                restDone.current = false;
                setRestUntil((u) => (u !== null ? u + 30_000 : Date.now() + 30_000));
              }}
              className="badge min-h-11 min-w-11 justify-center"
            >
              +30s
            </button>
            <button onClick={() => setRestUntil(null)} className="badge min-h-11 min-w-11 justify-center">{t("skip")}</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Tras quitar o separar: un grupo de superserie con un solo ejercicio deja de serlo. */
function normaliseSupersets(xs: ExerciseEntry[]): ExerciseEntry[] {
  const count = new Map<number, number>();
  for (const x of xs) if (x.superset != null) count.set(x.superset, (count.get(x.superset) ?? 0) + 1);
  return xs.map((x) => (x.superset != null && (count.get(x.superset) ?? 0) < 2 ? { ...x, superset: null } : x));
}

function ConfirmBar({ text, confirmLabel, cancelLabel, onConfirm, onCancel }: {
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alertdialog" aria-label={text} className="glass mt-4 p-4">
      <p className="t-body text-sm text-ink">{text}</p>
      <div className="mt-3 flex gap-3">
        <button onClick={onCancel} className="btn btn-outline min-h-11 flex-1">{cancelLabel}</button>
        <button onClick={onConfirm} className="btn btn-primary min-h-11 flex-1">{confirmLabel}</button>
      </div>
    </div>
  );
}

export default function GymSessionPage() {
  const t = useTranslations("training.gymSession");
  return (
    <Suspense fallback={<div className="pt-6 text-center"><p className="t-body text-muted">{t("loading")}</p></div>}>
      <SessionInner />
    </Suspense>
  );
}
