"use client";

import { useState } from "react";
import Link from "next/link";
import { credentials } from "@/lib/schemas";

function passwordChecks(password: string, email: string) {
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  return [
    { label: "Al menos 8 caracteres", ok: password.length >= 8 },
    { label: "No solo números", ok: password.length > 0 && !/^\d+$/.test(password) },
    {
      label: "Distinta de tu email",
      ok: password.length > 0 && (local.length < 3 || !password.toLowerCase().includes(local)),
    },
  ];
}

export default function RegisterPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const checks = passwordChecks(password, email);
  const allOk = checks.every((c) => c.ok);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = credentials.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (!allOk) {
      setError("Revisa los requisitos de la contraseña.");
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
            Te enviamos un enlace de verificación a <span className="text-ink">{email}</span>.
            Revisa tu bandeja de entrada (y la carpeta de spam). El enlace vence en 24 horas.
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
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
              className="field px-4 py-3.5 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="t-label text-muted">Contraseña</span>
            <div className="relative">
              <input
                type={showPass ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="mínimo 8 caracteres"
                className="field w-full px-4 py-3.5 pr-20 text-sm"
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="t-label absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-neon"
              >
                {showPass ? "Ocultar" : "Mostrar"}
              </button>
            </div>
          </label>

          {/* checklist positiva en vivo */}
          {password.length > 0 && (
            <ul className="flex flex-col gap-1 px-1">
              {checks.map((c) => (
                <li key={c.label} className={`t-body flex items-center gap-2 text-xs ${c.ok ? "text-good" : "text-muted"}`}>
                  <span
                    className="flex h-4 w-4 items-center justify-center rounded-full text-[10px]"
                    style={{
                      background: c.ok ? "rgba(67,232,160,0.15)" : "rgba(150,190,255,0.1)",
                      color: c.ok ? "#43e8a0" : "var(--color-muted)",
                    }}
                  >
                    {c.ok ? "✓" : "·"}
                  </span>
                  {c.label}
                </li>
              ))}
            </ul>
          )}

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
