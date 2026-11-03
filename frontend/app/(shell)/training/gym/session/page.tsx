"use client";

import { Fragment, Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { intlLocale } from "@/lib/locale";
import { TrainingIcon, InfoIcon } from "@/components/icons";
import {
  LIBRARY,
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
} from "@/lib/gym";
import { enqueueActivity, fetchServerActivities, pendingQueueItems, mergeByClientId } from "@/lib/activities";
import { useWeeklyPlan } from "@/lib/plan";
import { gymStats, useLastStats } from "@/lib/strength";
import { GYM_INCLUDES, type GymInclude } from "@/lib/session-check";
import { VigorousWarning } from "@/components/safety/VigorousWarning";

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

const REST_OPTS = [60, 90, 120];

function SessionInner() {
  const t = useTranslations("training.gymSession");
  const tg = useTranslations("training.gym");
  const tp = useTranslations("weeklyPlan");
  const locale = intlLocale(useLocale());
  const focusLabel = (f: string) => (FOCUS_KEYS[f] ? tg(`foci.${FOCUS_KEYS[f]}`) : f);
  const exLabel = (n: string) => (EXERCISE_KEYS[n] ? tg(`exercises.${EXERCISE_KEYS[n]}`) : n);
  const groupLabel = (g: string) => (FOCUS_KEYS[g] ? tg(`foci.${FOCUS_KEYS[g]}`) : g);
  const router = useRouter();
  const params = useSearchParams();
  const focusParam = params.get("focus");
  // Sesión del plan de la semana (Mi rutina → "Empezar sesión A"): se rellena con sus ejercicios.
  const planParam = params.get("plan");
  const [planSession, setPlanSession] = useState<string | null>(null);
  // Id del plan con el que ya se rellenó la sesión (-1: sesión restaurada, no se rellena).
  const [filledFrom, setFilledFrom] = useState<number | null>(null);
  const { data: planState } = useWeeklyPlan(planParam !== null);

  const [focus, setFocus] = useState<string | null>(null);
  const [exercises, setExercises] = useState<ExerciseEntry[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [phase, setPhase] = useState<"live" | "summary">("live");
  const [rpe, setRpe] = useState<number | null>(DEFAULT_RPE);
  const [rpeInfo, setRpeInfo] = useState(false);
  const [confirm, setConfirm] = useState<"finish" | "discard" | null>(null);
  const [undos, setUndos] = useState<{ ex: ExerciseEntry; index: number }[]>([]);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Test de 1RM o pliometría: trabajo vigoroso que pide el aviso (spec §8.2)
  const [includes, setIncludes] = useState<GymInclude[]>([]);

  // descanso entre series
  const [restDur, setRestDur] = useState(90);
  const [restUntil, setRestUntil] = useState<number | null>(null);
  const restDone = useRef(false);

  // búsqueda de ejercicios
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");

  /* ---------- historial para "Última vez"/PR: local + servidor (otro dispositivo) ---------- */
  const [gymHistory, setGymHistory] = useState<GymSession[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  useEffect(() => {
    // Pintura inmediata desde local; el servidor sobreescribe al llegar.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGymHistory(loadGymSessions());
    let alive = true;
    fetchServerActivities("GYM").then((server) => {
      if (!alive) return;
      setHistoryReady(true);
      if (!server) return; // el servidor no respondió: se queda con lo local
      const pending = pendingQueueItems("GYM").map(gymSessionFromPending);
      const merged = mergeByClientId(loadGymSessions(), pending, server.map(gymSessionFromServer));
      merged.sort((a, b) => b.ts - a.ts);
      setGymHistory(merged);
    });
    return () => { alive = false; };
  }, []);

  /* ---------- arranque: reanudar sesión viva o empezar nueva ---------- */
  useEffect(() => {
    let restored = false;
    try {
      const raw = localStorage.getItem(GYM_LIVE_KEY);
      if (raw) {
        const live: LiveGym = JSON.parse(raw);
        // Lectura síncrona de localStorage tras montar (no existe en el
        // servidor, evita el desajuste de hidratación).
        if (live && Array.isArray(live.exercises) && Date.now() - live.savedAt < 12 * 3600_000) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setFocus(live.focus);
          setExercises(live.exercises);
          setStartedAt(live.startedAt);
          setPlanSession(live.plan ?? null);
          setFilledFrom(-1);
          restored = true;
        }
      }
      const rd = Number(localStorage.getItem(GYM_REST_KEY));
      if (REST_OPTS.includes(rd)) setRestDur(rd);
    } catch { /* sesión corrupta */ }

    if (!restored && planParam) {
      setFocus(null);
      setPlanSession(planParam);
      setExercises([]);
      setStartedAt(Date.now());
    } else if (!restored) {
      const f = focusParam && FOCUS_EXERCISES[focusParam] ? focusParam : null;
      setFocus(f);
      setExercises(
        (f ? FOCUS_EXERCISES[f] : []).map((name) => ({
          name,
          sets: [{ kg: "", reps: "", done: false }],
        })),
      );
      setStartedAt(Date.now());
    }
    setNow(Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------- ejercicios de la sesión del plan (cargas del motor; sin carga, vacío) ---------- */
  // Se ajusta el estado al llegar el plan, en el render (sin efecto): una sola vez por plan.
  const activePlan = planState?.active;
  const planSessionData = planSession && activePlan ? activePlan.sessions.find((s) => s.key === planSession) : undefined;
  if (planSessionData && activePlan && filledFrom === null) {
    setFilledFrom(activePlan.id);
    setExercises(
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
    return () => clearInterval(id);
  }, []);
  const elapsed = startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;

  /* ---------- "Última vez" y récords: del servidor (`SetLog`), o del navegador si aún no están ---------- */
  const { data: serverStats } = useLastStats(exercises.map((x) => x.name));

  /* ---------- persistencia de la sesión viva ---------- */
  useEffect(() => {
    if (phase !== "live" || startedAt === null) return;
    try {
      localStorage.setItem(
        GYM_LIVE_KEY,
        JSON.stringify({ startedAt, focus, exercises, savedAt: Date.now(), plan: planSession } satisfies LiveGym),
      );
    } catch { /* sin espacio */ }
  }, [exercises, focus, startedAt, phase, planSession]);

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
      setRestUntil(null);
    }
  }, [restLeft, restUntil]);

  function startRest() {
    // Se dispara al marcar una serie hecha (evento de usuario), no durante el render.
    restDone.current = false;
    // eslint-disable-next-line react-hooks/purity
    setRestUntil(Date.now() + restDur * 1000);
  }
  function changeRest(v: number) {
    setRestDur(v);
    try { localStorage.setItem(GYM_REST_KEY, String(v)); } catch { /* noop */ }
  }

  /* ---------- edición de ejercicios/series ---------- */
  function updateSet(ei: number, si: number, field: "kg" | "reps", value: string) {
    setExercises((xs) =>
      xs.map((x, i) =>
        i !== ei ? x : { ...x, sets: x.sets.map((s, j) => (j !== si ? s : { ...s, [field]: value.replace(/[^\d.,]/g, "").slice(0, 6) })) },
      ),
    );
  }
  // logging fricción-mínima: un toque en "anterior: 80 kg × 8" copia esos
  // valores a la serie actual (no toca `done`, por si el usuario quiere ajustarlos antes)
  function applyPreviousSet(ei: number, si: number, set: { kg: number; reps: number }) {
    setExercises((xs) =>
      xs.map((x, i) =>
        i !== ei
          ? x
          : { ...x, sets: x.sets.map((s, j) => (j !== si ? s : { ...s, kg: String(set.kg), reps: String(set.reps) })) },
      ),
    );
  }
  function toggleDone(ei: number, si: number) {
    // se decide ANTES del setState (updater puro: seguro en StrictMode y con clics rápidos)
    const willStart = !exercises[ei]?.sets[si]?.done;
    setExercises((xs) =>
      xs.map((x, i) =>
        i !== ei
          ? x
          : { ...x, sets: x.sets.map((s, j) => (j !== si ? s : { ...s, done: !s.done })) },
      ),
    );
    if (willStart) startRest(); // al COMPLETAR una serie arranca el descanso
  }
  function addSet(ei: number) {
    setExercises((xs) =>
      xs.map((x, i) => {
        if (i !== ei) return x;
        const prev = x.sets[x.sets.length - 1];
        return { ...x, sets: [...x.sets, { kg: prev?.kg ?? "", reps: prev?.reps ?? "", done: false }] };
      }),
    );
  }
  function removeExercise(ei: number) {
    const ex = exercises[ei];
    if (!ex) return;
    setExercises((xs) => xs.filter((_, i) => i !== ei));
    setUndos((u) => [...u, { ex, index: ei }]);
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
  useEffect(() => () => { if (undoTimer.current) clearTimeout(undoTimer.current); }, []);
  function addExercise(name: string) {
    setExercises((xs) =>
      xs.some((x) => x.name === name) ? xs : [...xs, { name, sets: [{ kg: "", reps: "", done: false }] }],
    );
    setAdding(false);
    setQ("");
  }

  /* ---------- terminar y guardar ---------- */
  const parsedExercises = savedExercises(exercises);
  const { totalSets, volume } = sessionTotals(parsedExercises);
  const incomplete = incompleteSets(exercises);
  // `plan_session` e `includes` (aviso de sesión vigorosa) van en el detail: se les reserva su
  // sitio para no pasar del tope del backend.
  const planned: Record<string, unknown> = {
    ...(planSession ? { plan_session: planSession } : {}),
    ...(includes.length > 0 ? { includes } : {}),
  };
  const detailMax = MAX_DETAIL_CHARS - (Object.keys(planned).length > 0 ? JSON.stringify(planned).length : 0);
  const breakdownFits = buildActivityDetail(focus, volume, parsedExercises, detailMax).breakdown;

  function finish() {
    if (incomplete.tickedEmpty + incomplete.unticked > 0) setConfirm("finish");
    else {
      setConfirm(null);
      setPhase("summary");
    }
  }

  function save() {
    // Se ejecuta al pulsar "Guardar" (evento de usuario), no durante el render.
    // tope de 4 h: una sesión restaurada horas después no debe inflar la carga
    const capped = Math.min(elapsed, 4 * 3600);
    const minutes = capped / 60;
    // eslint-disable-next-line react-hooks/purity
    const ts = Date.now();
    const clientId = crypto.randomUUID();
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
    });
    // Si el desglose no cabe en el detail, las series siguen yendo enteras en `sets` (SetLog).
    const { detail } = buildActivityDetail(focus, volume, parsedExercises, detailMax);
    enqueueActivity({
      client_id: clientId,
      kind: "GYM",
      title: focus ?? "Gimnasio",
      started_at: new Date(ts - capped * 1000).toISOString(),
      duration_sec: Math.max(1, Math.round(capped)),
      rpe,
      detail: { ...detail, ...planned },
      sets: gymSets(parsedExercises),
    });
    localStorage.removeItem(GYM_LIVE_KEY);
    router.push("/training/gym");
  }
  function discard() {
    localStorage.removeItem(GYM_LIVE_KEY);
    router.push("/training/gym");
  }

  const results = q.trim().length > 0
    ? LIBRARY.flatMap((g) => g.items.filter((i) => exLabel(i).toLocaleLowerCase(locale).includes(q.toLocaleLowerCase(locale))).map((i) => ({ group: g.group, name: i })))
    : LIBRARY.flatMap((g) => g.items.map((i) => ({ group: g.group, name: i })));

  /* ============================ RESUMEN ============================ */
  if (phase === "summary") {
    return (
      <div className="pt-4">
        <h1 className="t-display text-2xl text-ink">{t("howWasIt")}</h1>
        <div className="glass neon-edge mt-4 p-5">
          <p className="t-title text-ink">{focus ? t("workoutFocus", { focus: focusLabel(focus) }) : t("gymWorkout")}</p>
          <div className="mt-3 flex justify-between text-center">
            <div><p className="stat text-xl text-ink">{fmtClock(elapsed)}</p><p className="t-label text-muted">{t("duration")}</p></div>
            <div><p className="stat text-xl text-ink">{totalSets}</p><p className="t-label text-muted">{t("setsLabel", { n: totalSets })}</p></div>
            <div><p className="stat text-xl neon-text">{volume.toLocaleString(locale)}</p><p className="t-label text-muted">{t("totalKg")}</p></div>
          </div>
          {parsedExercises.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 border-t border-[rgba(150,190,255,0.1)] pt-3">
              {parsedExercises.map((x) => (
                <li key={x.name} className="t-body flex justify-between text-xs text-muted">
                  <span>{exLabel(x.name)}</span>
                  <span className="text-ink">{t("setCount", { n: x.sets.length })}</span>
                </li>
              ))}
            </ul>
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

        <div className="mt-4 flex gap-3">
          <button onClick={() => { setConfirm(null); setPhase("live"); }} className="btn btn-outline min-h-11 flex-1">{t("back")}</button>
          <button onClick={save} disabled={totalSets === 0} className="btn btn-primary flex-1 min-h-11 disabled:opacity-60">{t("save")}</button>
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

  return (
    <div className="pt-4 pb-24">
      <div className="flex items-center justify-between">
        <Link href="/training/gym" className="t-label inline-flex min-h-11 items-center text-muted">{t("backToGym")}</Link>
        <span className="stat text-lg text-neon tabular-nums">{fmtClock(elapsed)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-neon"><TrainingIcon className="h-6 w-6" /></span>
        <h1 className="t-display text-2xl text-ink">{focus ? t("workoutFocus", { focus: focusLabel(focus) }) : planSession ? tp("session", { key: planSession }) : t("workout")}</h1>
      </div>

      {/* descanso entre series */}
      <div className="glass mt-3 flex items-center justify-between p-3">
        <span className="t-label text-muted">{t("restBetweenSets")}</span>
        <div className="flex gap-1.5">
          {REST_OPTS.map((v) => (
            <button key={v} type="button" onClick={() => changeRest(v)} className={`badge min-h-11 min-w-11 justify-center ${restDur === v ? "badge-neon" : ""}`}>
              {v}s
            </button>
          ))}
        </div>
      </div>

      {/* ejercicios */}
      <div className="mt-4 flex flex-col gap-3">
        {exercises.map((x, ei) => {
          // "Última vez" y récord: del servidor (`SetLog`) si tiene el ejercicio; si no, del
          // historial de sesiones (servidor + este navegador).
          const fromHistory = exerciseStats(x.name, gymHistory);
          const fromSets = gymStats(x.name, serverStats);
          const stats = fromSets.fromServer
            ? { ...fromSets, prKg: [fromSets.prKg, fromHistory.prKg].reduce<number | null>((a, b) => (b === null ? a : a === null ? b : Math.max(a, b)), null) }
            : { ...fromHistory, e1rmKg: null };
          const name = exLabel(x.name);
          return (
            <Fragment key={x.name}>
            {undoAt === ei && undoBar}
            <div className="glass p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="t-title text-ink">{name}</p>
                  <p className="t-body text-[11px] text-muted">
                    {stats.last ? t("lastTime", { last: stats.last }) : historyReady ? t("firstTime") : " "}
                    {stats.prKg !== null ? ` · ${t("pr", { kg: stats.prKg })}` : ""}
                  </p>
                  {stats.e1rmKg !== null && (
                    // Epley con las repeticiones en reserva: convención del coach, sin regla
                    <p data-testid="gym-e1rm" className="t-body mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                      {t("e1rm", { kg: stats.e1rmKg })}
                      <span className="t-label inline-flex rounded-full border border-white/20 px-2 py-0.5 text-[10px] text-muted">{tp("conventionCoach")}</span>
                    </p>
                  )}
                </div>
                <button onClick={() => removeExercise(ei)} aria-label={t("removeExercise", { name })} className="t-label flex h-11 w-11 shrink-0 items-center justify-center text-muted hover:text-bad">✕</button>
              </div>

              <div className="mt-3 grid grid-cols-[1.25rem_minmax(0,1fr)_minmax(0,1fr)_2.75rem] items-center gap-2">
                <span className="t-label text-muted">#</span>
                <span className="t-label text-muted">kg</span>
                <span className="t-label text-muted">{t("reps")}</span>
                <span />
                {x.sets.map((s, si) => {
                  const prev = previousSet(x.name, si, gymHistory);
                  // Texto del chip "anterior" desde el catálogo (no `formatSetPreview`, que es literal)
                  const preview = prev
                    ? prev.kg > 0 ? t("previewKg", { kg: prev.kg, reps: prev.reps }) : t("previewReps", { reps: prev.reps })
                    : null;
                  return (
                    <SetRow key={si} index={si} set={s} preview={preview}
                      onKg={(v) => updateSet(ei, si, "kg", v)}
                      onReps={(v) => updateSet(ei, si, "reps", v)}
                      onDone={() => toggleDone(ei, si)}
                      onUsePreview={prev ? () => applyPreviousSet(ei, si, prev) : undefined} />
                  );
                })}
              </div>
              <button onClick={() => addSet(ei)} className="btn btn-tonal btn-sm mt-3 min-h-11 w-full">{t("addSet")}</button>
            </div>
            </Fragment>
          );
        })}
        {undoAt === exercises.length && undoBar}
      </div>

      {/* añadir ejercicio */}
      <div className="mt-4">
        {adding ? (
          <div className="glass p-4">
            <div className="flex items-center justify-between">
              <p className="t-label text-ink">{t("addExercise")}</p>
              <button onClick={() => { setAdding(false); setQ(""); }} className="t-label min-h-11 px-2 text-muted">{t("close")}</button>
            </div>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("searchPlaceholder")} autoFocus
              className="field mt-2 w-full px-4 py-3 text-sm" />
            <div className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto">
              {results.map((r) => (
                <button key={r.name} onClick={() => addExercise(r.name)} className="flex items-center justify-between rounded-xl px-3 py-2.5 text-left hover:bg-[rgba(255,255,255,0.05)]">
                  <span className="t-body text-sm text-ink">{exLabel(r.name)}</span>
                  <span className="t-body text-[11px] text-muted">{groupLabel(r.group)}</span>
                </button>
              ))}
              {results.length === 0 && <p className="t-body py-3 text-center text-xs text-muted">{t("noResults")}</p>}
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="btn btn-tonal min-h-11 w-full">{t("addExerciseBtn")}</button>
        )}
      </div>

      {confirm === "finish" ? (
        <ConfirmBar
          text={[
            incomplete.tickedEmpty > 0 && t("incompleteTicked", { n: incomplete.tickedEmpty }),
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

      {/* chip flotante de descanso */}
      {restLeft !== null && restLeft > 0 && (
        <div className="fixed inset-x-0 bottom-24 z-40 flex justify-center px-2">
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

function SetRow({ index, set, preview, onKg, onReps, onDone, onUsePreview }: {
  index: number;
  set: { kg: string; reps: string; done: boolean };
  preview: string | null;
  onKg: (v: string) => void;
  onReps: (v: string) => void;
  onDone: () => void;
  onUsePreview?: () => void;
}) {
  const t = useTranslations("training.gymSession");
  const n = index + 1;
  const inputCls = `field min-h-11 w-full min-w-0 px-2 py-2 text-center text-base ${set.done ? "opacity-60" : ""}`;
  return (
    <>
      <span className="t-body text-sm text-muted">{n}</span>
      <input value={set.kg} onChange={(e) => onKg(e.target.value)} inputMode="decimal" placeholder="—"
        aria-label={t("weightAria", { n })} className={inputCls} />
      <input value={set.reps} onChange={(e) => onReps(e.target.value)} inputMode="numeric" placeholder="—"
        aria-label={t("repsAria", { n })} className={inputCls} />
      <button type="button" onClick={onDone} aria-label={t("setDone", { n })} aria-pressed={set.done}
        className="flex h-11 w-11 items-center justify-center rounded-full border text-sm transition-colors"
        style={set.done
          ? { background: "#43e8a0", borderColor: "transparent", color: "#03101c" }
          : { borderColor: "rgba(150,190,255,0.25)", color: "var(--color-muted)" }}>
        ✓
      </button>
      {preview && !set.done && (
        <button type="button" onClick={onUsePreview} className="col-span-4 -mt-1 flex min-h-11 items-center text-left"
          aria-label={t("previousAria", { preview })}>
          <span className="t-body text-[11px] text-muted hover:text-neon">{t("previous", { preview })}</span>
        </button>
      )}
    </>
  );
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
