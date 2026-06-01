import Link from "next/link";
import { ArrowUpRight, BoltIcon } from "@/components/icons";

export default function UiKitPage() {
  return (
    <div className="mx-auto w-full max-w-md px-5 safe-top pb-16">
      <header className="rise pt-6" style={{ animationDelay: "0ms" }}>
        <p className="t-eyebrow text-neon">Design System</p>
        <h1 className="t-display mt-2 text-ink">
          Sistema <span className="neon-text">visual</span>
        </h1>
        <p className="t-body mt-3 text-muted">
          Plus Jakarta Sans para titulares, Roboto Flex para el cuerpo. Componentes
          estilo Material 3 sobre el tema neón.
        </p>
      </header>

      {/* A) BANNER / HERO */}
      <section className="rise mt-7" style={{ animationDelay: "60ms" }}>
        <p className="t-eyebrow mb-2 text-muted">A · Banner</p>
        <div className="glass neon-edge overflow-hidden p-6">
          <span className="badge badge-neon">Nuevo</span>
          <h2 className="t-display mt-3 text-2xl text-ink">
            Entrena al <span className="neon-text">límite</span>
          </h2>
          <p className="t-body mt-2 text-muted">
            Mide tu carga, previene lesiones y deja que el coach IA ajuste tu plan.
          </p>
          <Link href="/dashboard" className="btn btn-primary mt-5">
            Empezar ahora
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      {/* B) CARD */}
      <section className="rise mt-7" style={{ animationDelay: "120ms" }}>
        <p className="t-eyebrow mb-2 text-muted">B · Tarjeta</p>
        <div className="glass p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[rgba(69,233,255,0.1)] text-neon">
                <BoltIcon className="h-5 w-5" />
              </span>
              <h3 className="t-title text-ink">Carga aguda</h3>
            </div>
            <span className="badge badge-good">Óptimo</span>
          </div>
          <p className="t-body mt-3 text-muted">
            Tu ratio carga aguda/crónica está dentro del rango seguro esta semana.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <span className="badge">ACWR 1.12</span>
            <span className="badge">7 días</span>
            <span className="badge">+8%</span>
          </div>
          <div className="mt-5 flex gap-2.5">
            <button className="btn btn-tonal btn-sm">Ver detalle</button>
            <button className="btn btn-outline btn-sm">Ignorar</button>
          </div>
        </div>
      </section>

      {/* C) BOTONES */}
      <section className="rise mt-7" style={{ animationDelay: "180ms" }}>
        <p className="t-eyebrow mb-2 text-muted">C · Botones &amp; estados</p>
        <div className="glass flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-2">
            <span className="t-label text-muted">Primary</span>
            <button className="btn btn-primary btn-block">Guardar sesión</button>
          </div>
          <div className="flex flex-col gap-2">
            <span className="t-label text-muted">Tonal</span>
            <button className="btn btn-tonal btn-block">Añadir comida</button>
          </div>
          <div className="flex flex-col gap-2">
            <span className="t-label text-muted">Outlined</span>
            <button className="btn btn-outline btn-block">Cancelar</button>
          </div>
          <div className="flex flex-col gap-2">
            <span className="t-label text-muted">Tamaño pequeño (sm)</span>
            <div className="flex gap-2.5">
              <button className="btn btn-primary btn-sm">Sí</button>
              <button className="btn btn-tonal btn-sm">Quizá</button>
              <button className="btn btn-outline btn-sm">No</button>
            </div>
          </div>
        </div>
      </section>

      {/* Tipografía */}
      <section className="rise mt-7" style={{ animationDelay: "240ms" }}>
        <p className="t-eyebrow mb-2 text-muted">Tipografía</p>
        <div className="glass flex flex-col gap-4 p-5">
          <div>
            <span className="t-eyebrow text-muted">Display · Jakarta 700</span>
            <p className="t-display mt-1 text-3xl text-ink">78.4 kg</p>
          </div>
          <div>
            <span className="t-eyebrow text-muted">Title · Jakarta 700</span>
            <p className="t-title mt-1 text-ink">Plan de fuerza máxima</p>
          </div>
          <div>
            <span className="t-eyebrow text-muted">Body · Roboto Flex 400</span>
            <p className="t-body mt-1 text-muted">
              Texto de cuerpo legible para descripciones, tablas y explicaciones largas.
            </p>
          </div>
        </div>
      </section>

      <Link href="/dashboard" className="btn btn-outline mt-8 w-full">
        ← Volver al dashboard
      </Link>
    </div>
  );
}
