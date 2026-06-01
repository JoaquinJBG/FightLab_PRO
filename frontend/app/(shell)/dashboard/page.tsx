import Link from "next/link";
import {
  ScaleIcon,
  MoonIcon,
  HeartIcon,
  PulseIcon,
  BoltIcon,
  ArrowUpRight,
} from "@/components/icons";

/* --- Datos de ejemplo (se conectarán a /api/v1/me/biometrics) --- */
const data = {
  name: "Joaquín",
  readiness: 82,
  acwr: 1.12,
  weight: { value: 78.4, delta: -0.6, spark: [80.1, 79.8, 79.9, 79.3, 79.0, 78.7, 78.4] },
  sleep: 8.0,
  rhr: 48,
  hrv: 96,
  weekLoad: [320, 540, 410, 0, 620, 480, 700],
};

function ReadinessRing({ value }: { value: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value / 100);
  return (
    <svg viewBox="0 0 120 120" className="h-28 w-28 -rotate-90">
      <circle cx="60" cy="60" r={r} fill="none" stroke="rgba(96,165,255,0.12)" strokeWidth="10" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        stroke="url(#ringGrad)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        style={{ filter: "drop-shadow(0 0 6px rgba(53,230,255,0.6))" }}
      />
      <defs>
        <linearGradient id="ringGrad" x1="0" y1="0" x2="120" y2="120">
          <stop stopColor="#35e6ff" />
          <stop offset="1" stopColor="#2b6bff" />
        </linearGradient>
      </defs>
    </svg>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 100;
  const h = 34;
  const step = w / (points.length - 1);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - ((p - min) / span) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-9 w-full" preserveAspectRatio="none">
      <path d={path} fill="none" stroke="#35e6ff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ filter: "drop-shadow(0 0 4px rgba(53,230,255,0.7))" }} />
    </svg>
  );
}

function AcwrBar({ value }: { value: number }) {
  // Escala 0.5 – 1.8; banda óptima 0.8 – 1.3
  const lo = 0.5;
  const hi = 1.8;
  const pct = (v: number) => ((v - lo) / (hi - lo)) * 100;
  return (
    <div className="mt-3">
      <div className="relative h-2.5 w-full rounded-full bg-[rgba(96,165,255,0.12)]">
        <div
          className="absolute inset-y-0 rounded-full bg-[rgba(62,230,143,0.35)]"
          style={{ left: `${pct(0.8)}%`, width: `${pct(1.3) - pct(0.8)}%` }}
        />
        <div
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-neon glow"
          style={{ left: `${pct(value)}%` }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[10px] text-muted">
        <span>0.5</span>
        <span className="text-good">zona óptima</span>
        <span>1.8</span>
      </div>
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  unit,
  delay,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  unit?: string;
  delay: number;
}) {
  return (
    <div className="glass rise p-3.5" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-2 text-muted">
        <span className="text-neon">{icon}</span>
        <span className="text-xs">{label}</span>
      </div>
      <div className="mt-2 flex items-end gap-1">
        <span className="stat text-2xl text-ink">{value}</span>
        {unit && <span className="mb-0.5 text-xs text-muted">{unit}</span>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const maxLoad = Math.max(...data.weekLoad);
  const days = ["L", "M", "X", "J", "V", "S", "D"];

  return (
    <div className="pt-3">
      {/* Cabecera */}
      <header className="rise flex items-center justify-between" style={{ animationDelay: "0ms" }}>
        <div>
          <p className="text-xs text-muted">Buenas,</p>
          <h1 className="font-display text-2xl font-semibold text-ink">{data.name}</h1>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-full glass font-display text-sm text-neon">
          JB
        </div>
      </header>

      {/* Hero: readiness */}
      <section className="glass neon-edge rise mt-5 flex items-center gap-4 p-5" style={{ animationDelay: "60ms" }}>
        <div className="relative shrink-0">
          <ReadinessRing value={data.readiness} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="stat text-3xl neon-text">{data.readiness}</span>
            <span className="text-[10px] uppercase tracking-widest text-muted">ready</span>
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted">Estado de hoy</p>
          <p className="mt-1 font-display text-lg leading-tight text-ink">
            Listo para <span className="text-neon">alta intensidad</span>
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Buen descanso y HRV al alza. Día ideal para sparring o trabajo de potencia.
          </p>
        </div>
      </section>

      {/* ACWR */}
      <section className="glass rise mt-4 p-4" style={{ animationDelay: "120ms" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-neon"><BoltIcon className="h-[18px] w-[18px]" /></span>
            <span className="text-sm text-ink">ACWR · riesgo de lesión</span>
          </div>
          <span className="stat text-xl text-good">{data.acwr.toFixed(2)}</span>
        </div>
        <AcwrBar value={data.acwr} />
      </section>

      {/* Peso */}
      <section className="glass rise mt-4 p-4" style={{ animationDelay: "180ms" }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted">
            <span className="text-neon"><ScaleIcon className="h-[18px] w-[18px]" /></span>
            <span className="text-xs">Peso · 7 días</span>
          </div>
          <span className="text-xs text-good">{data.weight.delta} kg</span>
        </div>
        <div className="mt-2 flex items-end justify-between gap-4">
          <div className="flex items-end gap-1">
            <span className="stat text-3xl text-ink">{data.weight.value}</span>
            <span className="mb-1 text-xs text-muted">kg</span>
          </div>
          <div className="w-32"><Sparkline points={data.weight.spark} /></div>
        </div>
      </section>

      {/* Métricas */}
      <section className="mt-4 grid grid-cols-3 gap-3">
        <MetricCard delay={220} icon={<MoonIcon className="h-[18px] w-[18px]" />} label="Sueño" value={data.sleep.toFixed(1)} unit="/10" />
        <MetricCard delay={260} icon={<HeartIcon className="h-[18px] w-[18px]" />} label="FC reposo" value={`${data.rhr}`} unit="bpm" />
        <MetricCard delay={300} icon={<PulseIcon className="h-[18px] w-[18px]" />} label="HRV" value={`${data.hrv}`} unit="ms" />
      </section>

      {/* Carga semanal */}
      <section className="glass rise mt-4 p-4" style={{ animationDelay: "340ms" }}>
        <div className="flex items-center justify-between">
          <span className="text-sm text-ink">Carga semanal</span>
          <span className="text-xs text-muted">AU / día</span>
        </div>
        <div className="mt-4 flex h-24 items-end justify-between gap-2">
          {data.weekLoad.map((v, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                className="w-full rounded-md"
                style={{
                  height: `${Math.max((v / maxLoad) * 100, 4)}%`,
                  opacity: v === 0 ? 0.25 : 1,
                  background: "linear-gradient(to top, #2b6bff, #35e6ff)",
                }}
              />
              <span className="text-[10px] text-muted">{days[i]}</span>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <Link
        href="/dashboard"
        className="btn-neon rise mt-5 flex w-full items-center justify-center gap-2 py-3.5 text-sm"
        style={{ animationDelay: "380ms" }}
      >
        Registrar biometría
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  );
}
