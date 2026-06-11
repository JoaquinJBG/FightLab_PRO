"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUpRight } from "@/components/icons";
import { credentials } from "@/lib/schemas";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = credentials.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    setLoading(false);
    if (res.ok) router.push("/dashboard");
    else setError("Credenciales incorrectas o cuenta sin verificar");
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 safe-top safe-bottom">
      <div className="flex flex-1 flex-col justify-center">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="glass glow mb-5 flex h-16 w-16 items-center justify-center rounded-2xl">
            <span className="font-display text-2xl font-bold neon-text">FL</span>
          </div>
          <h1 className="t-display text-3xl text-ink">
            FIGHTLAB <span className="neon-text">PRO</span>
          </h1>
          <p className="t-body mt-2 text-muted">Rendimiento de combate, medido y entrenado.</p>
        </div>
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1.5">
            <span className="t-label text-muted">Email</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="field px-4 py-3.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="t-label text-muted">Contraseña</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="field px-4 py-3.5 text-sm"
            />
          </label>
          {error && <p className="text-xs text-bad">{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary mt-2 disabled:opacity-60">
            {loading ? "Entrando…" : "Entrar"}
            <ArrowUpRight className="h-4 w-4" />
          </button>
        </form>
        <p className="t-body mt-6 text-center text-xs text-muted">
          ¿No tienes cuenta?{" "}
          <Link href="/register" className="text-neon">
            Crear cuenta
          </Link>
        </p>
      </div>
    </div>
  );
}
