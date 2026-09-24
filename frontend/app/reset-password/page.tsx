"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

/**
 * true cuando el enlace viene de verify-email porque la cuenta se quedó
 * sin contraseña utilizable (needs_password): mismo formulario que el
 * reset normal, pero con el mensaje "crea tu contraseña" en vez de
 * "restablécela".
 *
 * Exportada para poder testearla sin montar el componente.
 */
export function isCreatePasswordMode(mode: string | null): boolean {
  return mode === "create";
}

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const uid = params.get("uid");
  const token = params.get("token");
  const creating = isCreatePasswordMode(params.get("mode"));

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const missingLink = !uid || !token;
  const heading = creating ? (
    <>
      Crea tu <span className="neon-text">contraseña</span>
    </>
  ) : (
    <>
      Elige una <span className="neon-text">contraseña nueva</span>
    </>
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (missingLink) {
      setError("El enlace no es válido. Pide uno nuevo.");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres.");
      return;
    }
    if (password !== confirm) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid, token, password }),
      });
      if (res.ok) {
        setDone(true);
        return;
      }
      const d = await res.json().catch(() => ({}));
      setError(typeof d?.detail === "string" ? d.detail : "El enlace no es válido o ha caducado.");
    } catch {
      setError("No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <>
        <h1 className="t-display text-3xl text-ink">{heading}</h1>
        <div className="glass neon-edge mt-6 p-6 text-center">
          <p className="t-title text-ink">Contraseña actualizada ✅</p>
          <p className="t-body mt-2 text-muted">Ya puedes iniciar sesión con tu nueva contraseña.</p>
          <button type="button" onClick={() => router.push("/login")} className="btn btn-primary mt-5">
            Iniciar sesión
          </button>
        </div>
      </>
    );
  }

  if (missingLink) {
    return (
      <>
        <h1 className="t-display text-3xl text-ink">{heading}</h1>
        <div className="glass neon-edge mt-6 p-6 text-center">
          <p className="t-title text-ink">Enlace no válido</p>
          <p className="t-body mt-2 text-muted">
            Vuelve a pedir la recuperación de contraseña desde el enlace de tu email.
          </p>
          <Link href="/forgot-password" className="btn btn-tonal mt-5">
            Pedir un enlace nuevo
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="t-display text-3xl text-ink">{heading}</h1>
      <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
        <label className="flex flex-col gap-1.5">
          <span className="t-label text-muted">{creating ? "Contraseña" : "Nueva contraseña"}</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="mínimo 8 caracteres"
            className="field px-4 py-3.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="t-label text-muted">Repite la contraseña</span>
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="mínimo 8 caracteres"
            className="field px-4 py-3.5 text-sm"
          />
        </label>
        {error && <p className="text-xs text-bad">{error}</p>}
        <button type="submit" disabled={loading} className="btn btn-primary mt-2 disabled:opacity-60">
          {loading ? "Guardando…" : creating ? "Crear contraseña" : "Guardar contraseña"}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 safe-top safe-bottom">
      <Suspense
        fallback={
          <>
            <h1 className="t-display text-3xl text-ink">
              Elige una <span className="neon-text">contraseña nueva</span>
            </h1>
            <p className="t-body mt-6 text-muted">Cargando…</p>
          </>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
