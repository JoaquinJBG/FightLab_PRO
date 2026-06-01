import Link from "next/link";
import { ArrowUpRight } from "@/components/icons";

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 safe-top safe-bottom">
      {/* Marca */}
      <div className="rise flex flex-1 flex-col justify-center" style={{ animationDelay: "0ms" }}>
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="glass glow mb-5 flex h-16 w-16 items-center justify-center rounded-2xl">
            <span className="font-display text-2xl font-bold neon-text">FL</span>
          </div>
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink">
            FIGHTLAB <span className="neon-text">PRO</span>
          </h1>
          <p className="mt-2 text-sm text-muted">
            Rendimiento de combate, medido y entrenado.
          </p>
        </div>

        {/* Formulario */}
        <form className="flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Email</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="tu@email.com"
              className="field px-4 py-3.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted">Contraseña</span>
            <input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className="field px-4 py-3.5 text-sm"
            />
          </label>

          <Link
            href="/dashboard"
            className="btn-neon mt-2 flex items-center justify-center gap-2 py-3.5 text-sm"
          >
            Entrar
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </form>

        <p className="mt-6 text-center text-xs text-muted">
          ¿No tienes cuenta?{" "}
          <Link href="/dashboard" className="text-neon">
            Crear cuenta
          </Link>
        </p>
      </div>

      <p className="rise pb-2 text-center text-[10px] text-muted" style={{ animationDelay: "200ms" }}>
        v0.1 · vista previa
      </p>
    </div>
  );
}
