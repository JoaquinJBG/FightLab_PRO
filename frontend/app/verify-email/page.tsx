"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

type VerifyEmailResponse = {
  detail?: string;
  needs_password?: boolean;
  uid?: string;
  token?: string;
};

/**
 * Si alguien se registró dos veces antes de verificar el email, la cuenta
 * se queda sin contraseña utilizable (set_unusable_password, para no
 * permitir el pre-secuestro) y VerifyEmailView lo señala con
 * needs_password + uid + token en vez de dejar que el login falle sin
 * ninguna pista. Decide a dónde mandar al usuario tras verificar.
 *
 * Exportada para poder testearla sin montar el componente.
 */
export function resolveVerifyRedirect(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const { needs_password, uid, token } = data as VerifyEmailResponse;
  if (needs_password && uid && token) {
    const params = new URLSearchParams({ uid, token, mode: "create" });
    return `/reset-password?${params.toString()}`;
  }
  return null;
}

function ResendVerification() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onResend(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setError(null);
    setStatus("sending");
    try {
      const res = await fetch("/api/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 429) {
        setStatus("idle");
        setError("Demasiados intentos. Prueba de nuevo en un rato.");
        return;
      }
    } catch {
      // no revela nada de todos modos: seguimos al estado "enviado"
    }
    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <p className="t-body mt-4 text-xs text-muted">
        Si la cuenta existe y no está verificada, te hemos reenviado el enlace.
      </p>
    );
  }

  return (
    <form className="mt-4 flex flex-col gap-2" onSubmit={onResend}>
      <label className="flex flex-col gap-1.5 text-left">
        <span className="t-label text-muted">Reenviar el email de verificación</span>
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(ev) => setEmail(ev.target.value)}
          placeholder="tu@email.com"
          className="field px-4 py-3 text-sm"
        />
      </label>
      {error && <p className="text-xs text-bad">{error}</p>}
      <button type="submit" disabled={status === "sending"} className="btn btn-tonal disabled:opacity-60">
        {status === "sending" ? "Enviando…" : "Reenviar email"}
      </button>
    </form>
  );
}

function Verify() {
  const router = useRouter();
  const token = useSearchParams().get("token");
  const [state, setState] = useState<"loading" | "ok" | "error">(token ? "loading" : "error");

  useEffect(() => {
    if (!token) return;
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        if (!r.ok) {
          setState("error");
          return;
        }
        const data = await r.json().catch(() => null);
        const redirect = resolveVerifyRedirect(data);
        if (redirect) {
          router.replace(redirect);
          return;
        }
        setState("ok");
      })
      .catch(() => setState("error"));
  }, [token, router]);

  return (
    <div className="glass neon-edge mt-6 p-6 text-center">
      {state === "loading" && <p className="t-body text-muted">Verificando…</p>}
      {state === "ok" && (
        <>
          <p className="t-title text-ink">¡Email verificado! ✅</p>
          <Link href="/login" className="btn btn-primary mt-5">
            Iniciar sesión
          </Link>
        </>
      )}
      {state === "error" && (
        <>
          <p className="t-title text-ink">Enlace no válido o caducado</p>
          <Link href="/register" className="btn btn-tonal mt-5">
            Volver a registrarme
          </Link>
          <ResendVerification />
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 safe-top safe-bottom">
      <h1 className="t-display text-3xl text-ink">Verificación</h1>
      <Suspense fallback={<p className="t-body mt-6 text-muted">Cargando…</p>}>
        <Verify />
      </Suspense>
    </div>
  );
}
