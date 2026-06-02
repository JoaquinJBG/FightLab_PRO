import Link from "next/link";
import {
  RunIcon,
  GloveIcon,
  TrainingIcon,
  ClipboardIcon,
  TimerIcon,
  ChevronRight,
  BoltIcon,
} from "@/components/icons";

const cards = [
  { href: "/training/sports", Icon: RunIcon, title: "Deportes", sub: "Corre, nada, pedalea… y cuenta kcal" },
  { href: "/training/mma", Icon: GloveIcon, title: "Entrenamiento MMA", sub: "Sparring, técnica, intensidad · coach IA" },
  { href: "/training/gym", Icon: TrainingIcon, title: "Gimnasio", sub: "Calendario + crear rutina con IA" },
  { href: "/training/my-routine", Icon: ClipboardIcon, title: "Mi rutina", sub: "La que te asigna tu coach" },
  { href: "/training/tools", Icon: TimerIcon, title: "Herramientas", sub: "Cronómetro y timer de rounds" },
];

export default function TrainingHubPage() {
  return (
    <div className="pt-4">
      <h1 className="t-display text-2xl text-ink">Entreno</h1>

      {/* Mini-resumen carga/estado */}
      <Link
        href="/training/load"
        className="glass neon-edge rise mt-4 flex items-center gap-4 p-4"
        style={{ animationDelay: "0ms" }}
      >
        <span className="text-neon"><BoltIcon className="h-5 w-5" /></span>
        <div className="flex flex-1 items-center gap-5">
          <div>
            <p className="t-label text-muted">ACWR</p>
            <p className="stat text-xl text-good">
              1.12 <span className="text-xs text-good">· óptimo</span>
            </p>
          </div>
          <div>
            <p className="t-label text-muted">Readiness</p>
            <p className="stat text-xl neon-text">82</p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted" />
      </Link>

      {/* Tarjetas */}
      <div className="mt-4 flex flex-col gap-3">
        {cards.map(({ href, Icon, title, sub }, i) => (
          <Link
            key={href}
            href={href}
            className="glass rise flex items-center gap-4 p-4"
            style={{ animationDelay: `${60 + i * 50}ms` }}
          >
            <span className="text-neon glow flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.07)]">
              <Icon className="h-6 w-6" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="t-title text-lg text-ink">{title}</p>
              <p className="t-body text-xs text-muted">{sub}</p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-muted" />
          </Link>
        ))}
      </div>
    </div>
  );
}
