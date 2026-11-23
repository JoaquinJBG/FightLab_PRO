"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { BatchRuleChip, KNOWN_APPLIANCES } from "@/components/menu/BatchSessions";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { intlLocale } from "@/lib/locale";
import { batchRuleName, useMenu, type BatchSession, type Menu } from "@/lib/menu";
import {
  EMPTY_CLOCK,
  elapsedSec,
  fmtClock,
  laneNow,
  lanes,
  pause,
  readClock,
  start,
  stepStatus,
  storageKey,
  timerLeft,
  toggleDone,
  toggleTimer,
  writeClock,
  type BatchClock,
} from "@/lib/batch-timer";

const STATUS_STYLE: Record<string, string> = {
  done: "text-muted line-through",
  now: "text-ink",
  late: "text-warn",
  next: "text-muted",
};

function beep() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    o.start();
    o.stop(ctx.currentTime + 0.65);
  } catch {
    // sin audio: queda el aviso en pantalla
  }
  try {
    navigator.vibrate?.([200, 100, 200]);
  } catch {
    // sin vibración
  }
}

/** Mantiene la pantalla encendida mientras la sesión corre (Wake Lock, si el navegador lo tiene). */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    (navigator as unknown as { wakeLock: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock
      .request("screen")
      .then((l) => {
        if (cancelled) l.release().catch(() => {});
        else lock = l;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      lock?.release().catch(() => {});
    };
  }, [active]);
}

function Session({ menu, session, index }: { menu: Menu; session: BatchSession; index: number }) {
  const t = useTranslations("menu.batchScreen");
  const tb = useTranslations("menu.batch");
  const locale = intlLocale(useLocale());
  const key = storageKey(menu.id, session.date);
  // Solo se pinta en el cliente (tras cargar el menú), así que se puede leer localStorage al montar.
  const [clock, setClock] = useState<BatchClock>(() => readClock(key));
  const [now, setNow] = useState(() => Date.now());
  const [rang, setRang] = useState<number[]>([]);
  const timers = useRef(clock.timers);
  const rangRef = useRef<number[]>([]);

  useEffect(() => {
    writeClock(key, clock);
    timers.current = clock.timers;
  }, [key, clock]);
  useEffect(() => {
    rangRef.current = rang;
  }, [rang]);
  useEffect(() => {
    // Cada segundo: el reloj y, si el temporizador de un paso llega a cero, que suene una vez.
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      const ended = Object.entries(timers.current)
        .filter(([idx, end]) => end <= t && !rangRef.current.includes(Number(idx)))
        .map(([idx]) => Number(idx));
      if (ended.length) {
        rangRef.current = [...rangRef.current, ...ended];
        setRang(rangRef.current);
        beep();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const running = clock.startedAt != null && clock.pausedAt == null;
  useWakeLock(running || Object.keys(clock.timers).length > 0);
  const elapsed = elapsedSec(clock, now);

  const name = (where: string) => (KNOWN_APPLIANCES.includes(where) ? tb(`appliances.${where}`) : where);
  const day = new Date(`${session.date}T12:00:00`).toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" });
  const done = clock.done.length;

  return (
    <div data-testid="batch-screen" data-running={running ? "true" : "false"}
      className="fixed inset-0 z-50 overflow-y-auto bg-[var(--color-bg,#05070d)] px-4 pb-10 pt-[max(env(safe-area-inset-top),1rem)]">
      <div className="mx-auto w-full max-w-md">
        <div className="flex items-center justify-between gap-2">
          <Link href={`/nutrition/menu?id=${menu.id}`} data-testid="batch-close" className="t-label text-muted">{t("close")}</Link>
          <span className="t-label text-muted">{t("progress", { done, total: session.timeline.length })}</span>
        </div>
        <h1 className="t-display mt-2 text-xl text-ink first-letter:uppercase">{t("title", { date: day })}</h1>
        <p className="t-body text-xs text-muted">{session.dishes.map((d) => d.name).join(" · ")}</p>

        <section className="glass mt-4 p-4 text-center">
          <p className="t-eyebrow text-muted">{t("elapsed")}</p>
          <p data-testid="batch-clock" className="stat mt-1 text-5xl text-ink">{fmtClock(elapsed)}</p>
          <p className="t-label mt-1 text-muted">{t("planned", { minutes: session.total_min })}</p>
          <div className="mt-3 flex justify-center gap-2">
            {running ? (
              <button type="button" data-testid="batch-pause" className="btn btn-tonal" onClick={() => setClock((c) => pause(c, Date.now()))}>{t("pause")}</button>
            ) : (
              <button type="button" data-testid="batch-start" className="btn btn-primary" onClick={() => setClock((c) => start(c, Date.now()))}>
                {clock.startedAt == null ? t("start") : t("resume")}
              </button>
            )}
            {clock.startedAt != null && (
              <button type="button" data-testid="batch-reset" className="btn btn-tonal"
                onClick={() => { if (window.confirm(t("confirmReset"))) { setClock(EMPTY_CLOCK); setRang([]); } }}>
                {t("reset")}
              </button>
            )}
          </div>
        </section>

        {session.eve.length > 0 && <p className="t-body mt-3 text-xs text-ink">{tb("eve", { list: session.eve.join("; ") })}</p>}
        {session.missing.map((m, i) => (
          <p key={`${m.step}-${i}`} className="t-body mt-1 text-xs text-bad">{tb("missing", { step: m.step })}</p>
        ))}

        <section data-testid="batch-lanes" className="mt-4 grid grid-cols-2 gap-2">
          {lanes(session.timeline).map((lane) => {
            const current = laneNow(lane, clock, elapsed);
            return (
              <div key={lane.where} data-testid="batch-lane" data-where={lane.where} className="glass p-3">
                <p className="t-label text-muted">{name(lane.where)}</p>
                {current ? (
                  <>
                    <p className="t-body mt-1 line-clamp-2 text-xs text-ink">{current.step.step}</p>
                    <p data-testid="batch-lane-left" className="stat mt-1 text-lg text-ink">
                      {current.started ? fmtClock(current.left) : t("startsIn", { time: fmtClock(current.left) })}
                    </p>
                  </>
                ) : (
                  <p className="t-body mt-1 text-xs text-good">{t("laneDone")}</p>
                )}
              </div>
            );
          })}
        </section>

        <section className="mt-4">
          <p className="t-eyebrow text-muted">{t("steps")}</p>
          <ol className="mt-2 flex flex-col gap-2">
            {session.timeline.map((step, i) => {
              const status = stepStatus(step, i, clock, elapsed);
              const left = timerLeft(clock, i, now);
              return (
                <li key={i} data-testid="batch-step" data-status={status} className="glass flex items-start gap-3 p-3">
                  <input type="checkbox" aria-label={step.step} checked={clock.done.includes(i)} className="mt-1"
                    onChange={() => setClock((c) => toggleDone(c, i))} />
                  <div className="min-w-0 flex-1">
                    <p className="t-label text-muted">
                      {t("slot", { from: step.min, to: step.until })} · {name(step.where)}
                      {step.substituted_from && <> · {tb("substituted", { what: name(step.substituted_from) })}</>}
                    </p>
                    <p className={`t-body text-sm ${STATUS_STYLE[status]}`}>{step.step}</p>
                    {status === "now" && <span className="badge badge-neon mt-1">{t("now")}</span>}
                    {status === "late" && <span className="badge mt-1">{t("late")}</span>}
                  </div>
                  <button type="button" data-testid="batch-step-timer" className={`btn btn-sm ${left != null ? "btn-primary" : "btn-tonal"}`}
                    onClick={() => { setRang((r) => r.filter((x) => x !== i)); setClock((c) => toggleTimer(c, i, step, Date.now())); }}>
                    {left == null ? t("timer", { minutes: step.until - step.min }) : left === 0 ? t("timerDone") : fmtClock(left)}
                  </button>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="mt-4 flex flex-col gap-1.5">
          {session.rules.map((key) => (
            <p key={key} className="t-body flex flex-wrap items-center gap-2 text-[11px] text-muted">
              <span>{batchRuleName(key) ? tb(`rules.${batchRuleName(key)}`) : key}</span>
              <BatchRuleChip menu={menu} ruleKey={key} />
            </p>
          ))}
          <p className="t-body flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span>{tb("conventionNote")}</span>
            <EvidenceChip ruleKey={null} />
          </p>
        </section>
        <p className="sr-only" aria-live="polite">{rang.length ? t("timerDone") : ""}</p>
        <p className="t-label mt-4 text-muted">{t("session", { n: index + 1 })}</p>
      </div>
    </div>
  );
}

function BatchScreen() {
  const t = useTranslations("menu.batchScreen");
  const params = useSearchParams();
  const id = Number(params.get("menu"));
  const index = Number(params.get("session") ?? 0);
  const state = useMenu(Number.isInteger(id) && id > 0 ? id : null);
  const menu = state.data?.menu;
  const session = menu?.batch_sessions[index];
  if (state.isLoading) return <p className="t-body pt-6 text-muted">{t("loading")}</p>;
  if (!menu || !session) {
    return (
      <div className="pt-6">
        <p data-testid="batch-none" className="t-body text-muted">{t("none")}</p>
        <Link href="/nutrition/menu" className="btn btn-tonal btn-sm mt-3">{t("close")}</Link>
      </div>
    );
  }
  return <Session key={`${menu.id}-${session.date}`} menu={menu} session={session} index={index} />;
}

export default function BatchPage() {
  return (
    <Suspense fallback={null}>
      <BatchScreen />
    </Suspense>
  );
}
