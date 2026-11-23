"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  RunIcon,
  GloveIcon,
  TrainingIcon,
  ClipboardIcon,
  TimerIcon,
  ChevronRight,
} from "@/components/icons";
import { useToday, type PlanEntry } from "@/lib/today";
import { useDisciplines } from "@/lib/hooks";

const registrar = [
  { href: "/training/gym", Icon: TrainingIcon, id: "gym", needs: "gym" },
  { href: "/training/mma", Icon: GloveIcon, id: "mma", needs: "combat" },
  { href: "/training/sports", Icon: RunIcon, id: "sports", needs: null },
  { href: "/training/gym", Icon: ClipboardIcon, id: "history", needs: "gym" },
] as const;

const planificar = [
  { href: "/training/plan", id: "week", needs: null },
  { href: "/training/routines", id: "routines", needs: "gym" },
] as const;

/* Con una sola celda, a ancho completo; con dos o más, a dos columnas (sin huecos raros). */
const gridFor = (n: number) => (n === 1 ? "grid-cols-1" : "grid-cols-2");

/* «Hoy toca»: lo de hoy del plan activo (el mismo `coach/today` que usa Hoy). */
function TodayCard() {
  const t = useTranslations("training.index.today");
  const { data, isLoading } = useToday();
  const { gym: showGym } = useDisciplines();
  const plan = data?.plan ?? null;

  if (isLoading) return <section className="glass neon-edge mt-3 min-h-[5.5rem] p-4" aria-busy="true" />;

  if (!plan) {
    return (
      <section data-testid="hub-today" className="glass neon-edge mt-3 p-4">
        <p className="t-eyebrow text-muted">{t("title")}</p>
        <p className="t-body mt-1 text-sm text-muted">{t("none")}</p>
        <Link href="/training/plan" data-testid="hub-today-plan" className="btn btn-tonal btn-sm mt-2">{t("makePlan")}</Link>
      </section>
    );
  }

  const entries: PlanEntry[] = plan.entries;
  const gym = entries.find((e) => e.kind === "gym" && e.session);
  const label = (e: PlanEntry) =>
    e.kind === "gym" ? t("gym", { session: e.session ?? "?" }) : e.kind === "cardio" ? t("cardio", { minutes: e.minutes ?? 0 }) : t("mma");

  return (
    <section data-testid="hub-today" className="glass neon-edge mt-3 p-4">
      <p className="t-eyebrow text-muted">{t("title")}</p>
      {entries.length === 0 ? (
        <p className="t-title mt-1 text-ink">{t("rest")}</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5">
          {entries.map((e, i) => (
            <li key={i} className="t-title truncate text-ink">{label(e)}{e.time ? ` · ${e.time}` : ""}</li>
          ))}
        </ul>
      )}
      {gym?.exercises && gym.exercises.length > 0 && (
        <p className="t-body mt-0.5 truncate text-xs text-muted">{gym.exercises.join(" · ")}</p>
      )}
      {gym && showGym && (
        <Link
          href={`/training/gym/session?plan=${encodeURIComponent(gym.session!)}`}
          data-testid="hub-today-start"
          className="btn btn-primary btn-sm mt-3 w-full"
        >
          {t("start")}
        </Link>
      )}
    </section>
  );
}

export default function TrainingHubPage() {
  const t = useTranslations("training.index");
  const shown = useDisciplines();
  const visible = <T extends { needs: "gym" | "combat" | null }>(items: readonly T[]) =>
    items.filter((i) => i.needs === null || shown[i.needs]);
  const registrarShown = visible(registrar);
  const planificarShown = visible(planificar);

  return (
    <div className="pt-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="t-display text-2xl text-ink">{t("title")}</h1>
        <Link href="/training/tools" data-testid="hub-timer" className="btn btn-tonal btn-sm inline-flex items-center gap-1.5">
          <TimerIcon className="h-4 w-4" />
          {t("timer")}
        </Link>
      </div>

      <TodayCard />

      <p className="t-eyebrow mt-4 text-muted">{t("register")}</p>
      <div className={`mt-2 grid gap-2 ${gridFor(registrarShown.length)}`}>
        {registrarShown.map(({ href, Icon, id }) => (
          <Link key={id} href={href} data-testid={`hub-${id}`} className="glass flex items-center gap-2.5 p-3">
            <span className="text-neon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(69,233,255,0.07)]">
              <Icon className="h-5 w-5" />
            </span>
            <span className="t-title min-w-0 text-sm leading-tight text-ink">{t(`registerCards.${id}`)}</span>
          </Link>
        ))}
      </div>

      <p className="t-eyebrow mt-4 text-muted">{t("planify")}</p>
      <div className={`mt-2 grid gap-2 ${gridFor(planificarShown.length)}`}>
        {planificarShown.map(({ href, id }) => (
          <Link key={id} href={href} data-testid={`hub-${id}`} className="glass flex items-center justify-between gap-2 p-3">
            <span className="t-title min-w-0 text-sm leading-tight text-ink">{t(`planifyCards.${id}`)}</span>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
          </Link>
        ))}
      </div>
    </div>
  );
}
