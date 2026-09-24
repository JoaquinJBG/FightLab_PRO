"use client";

import { useState } from "react";
import Link from "next/link";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError("Escribe tu email.");
      return;
    }
    setStatus("sending");
    try {
      await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      // Siempre "enviado": el servidor nunca revela si el email existe.
      setStatus("sent");
    } catch {
      setStatus("idle");
      setError("No se pudo conectar. Comprueba tu conexión e inténtalo de nuevo.");
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 safe-top safe-bottom">
      <h1 className="t-display text-3xl text-ink">
        Recuperar <span className="neon-text">contraseña</span>
      </h1>

      {status === "sent" ? (
        <div className="glass neon-edge mt-6 p-6">
          <p className="t-title text-ink">Revisa tu email</p>
          <p className="t-body mt-2 text-muted">
            Si existe una cuenta con <span className="text-ink">{email}</span>, te hemos enviado
            un enlace para elegir una nueva contraseña. Revisa también la carpeta de spam.
          </p>
          <Link href="/login" className="btn btn-tonal mt-5">
            Volver a iniciar sesión
          </Link>
        </div>
      ) : (
        <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
          <p className="t-body text-muted">
            Escribe el email de tu cuenta y te enviaremos un enlace para elegir una contraseña
            nueva.
          </p>
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
          {error && <p className="text-xs text-bad">{error}</p>}
          <button
            type="submit"
            disabled={status === "sending"}
            className="btn btn-primary mt-2 disabled:opacity-60"
          >
            {status === "sending" ? "Enviando…" : "Enviar enlace"}
          </button>
          <p className="t-body mt-3 text-center text-xs text-muted">
            <Link href="/login" className="text-neon">
              Volver a iniciar sesión
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
