export function ModulePlaceholder({
  icon,
  title,
  tag,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  tag: string;
  description: string;
}) {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center px-2 text-center">
      <div className="glass neon-edge rise flex flex-col items-center gap-4 p-8" style={{ animationDelay: "40ms" }}>
        <span className="text-neon glow flex h-16 w-16 items-center justify-center rounded-2xl bg-[rgba(53,230,255,0.06)]">
          {icon}
        </span>
        <div>
          <p className="text-[10px] uppercase tracking-[0.2em] text-neon">{tag}</p>
          <h1 className="mt-1 font-display text-2xl font-semibold text-ink">{title}</h1>
        </div>
        <p className="max-w-[16rem] text-sm leading-relaxed text-muted">{description}</p>
        <span className="mt-1 rounded-full border border-[rgba(96,165,255,0.2)] px-3 py-1 text-[11px] text-muted">
          Próximamente
        </span>
      </div>
    </div>
  );
}
