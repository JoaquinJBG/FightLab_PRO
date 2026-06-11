"use client";

import { useState } from "react";
import Link from "next/link";
import { credentials } from "@/lib/schemas";

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
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
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.data),
    });
    setLoading(false);
    if (res.status === 201) setDone(true);
    else {
      const d = await res.json().catch(() => ({}));
      setError(typeof d?.detail === "string" ? d.detail : "No se pudo registrar");
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 safe-top safe-bottom">
      <h1 className="t-display text-3xl text-ink">
        Crear <span className="neon-text">cuenta</span>
      </h1>
      {done ? (
        <div className="glass neon-edge mt-6 p-6">
          <p className="t-title text-ink">Revisa tu email</p>
          <p className="t-body mt-2 text-muted">
            Te enviamos un enlace de verificación. En desarrollo aparece en la consola del backend.
          </p>
          <Link href="/login" className="btn btn-tonal mt-5">
            Ir a iniciar sesión
          </Link>
        </div>
      ) : (
        <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1.5">
            <span className="t-label text-muted">Email</span>
            <input
              type="email"
              inputMode="email"
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
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="mínimo 8 caracteres"
              className="field px-4 py-3.5 text-sm"
            />
          </label>
          {error && <p className="text-xs text-bad">{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary mt-2 disabled:opacity-60">
            {loading ? "Creando…" : "Crear cuenta"}
          </button>
          <p className="t-body mt-3 text-center text-xs text-muted">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="text-neon">
              Entrar
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
