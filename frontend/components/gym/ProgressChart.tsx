"use client";

/** Gráfica de líneas sencilla (SVG, sin librerías) de una métrica por sesión. Lleva una tabla
    oculta para lectores de pantalla con los mismos números. */
export function ProgressChart({ points, label, unit, locale }: {
  points: { date: string; value: number | null }[];
  label: string;
  unit: string;
  locale: string;
}) {
  const data = points.filter((p): p is { date: string; value: number } => p.value !== null);
  const W = 320;
  const H = 160;
  const pad = { l: 36, r: 8, t: 10, b: 22 };
  if (data.length === 0) return null;
  const vals = data.map((p) => p.value);
  let lo = Math.min(...vals);
  let hi = Math.max(...vals);
  if (lo === hi) { lo -= 1; hi += 1; }
  const span = hi - lo;
  lo -= span * 0.1;
  hi += span * 0.1;
  const x = (i: number) => pad.l + (data.length === 1 ? (W - pad.l - pad.r) / 2 : (i / (data.length - 1)) * (W - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const path = data.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const fmt = (v: number) => Math.round(v).toLocaleString(locale);
  const short = (d: string) => new Date(d).toLocaleDateString(locale, { day: "numeric", month: "short" });
  return (
    <figure data-testid="progress-chart">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${label}: ${fmt(vals[0])}–${fmt(vals[vals.length - 1])} ${unit}`}>
        {[lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="rgba(150,190,255,0.12)" />
            <text x={pad.l - 4} y={y(v) + 3} textAnchor="end" fontSize="9" fill="var(--color-muted)">{fmt(v)}</text>
          </g>
        ))}
        <path d={path} fill="none" stroke="#45e9ff" strokeWidth="2" />
        {data.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r="3" fill="#45e9ff" />)}
        <text x={pad.l} y={H - 6} fontSize="9" fill="var(--color-muted)">{short(data[0].date)}</text>
        {data.length > 1 && <text x={W - pad.r} y={H - 6} textAnchor="end" fontSize="9" fill="var(--color-muted)">{short(data[data.length - 1].date)}</text>}
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((p, i) => <tr key={i}><td>{p.date}</td><td>{fmt(p.value)} {unit}</td></tr>)}
        </tbody>
      </table>
    </figure>
  );
}
