"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

export default function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError(t("forgotPassword.emailRequired"));
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (res.status === 429) {
        setStatus("idle");
        setError(t("common.tooManyAttempts"));
        return;
      }
      // Siempre "enviado" (salvo el 429 anterior): el servidor nunca revela
      // si el email existe.
      setStatus("sent");
    } catch {
      setStatus("idle");
      setError(t("common.networkError"));
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 safe-top safe-bottom">
      <h1 className="t-display text-3xl text-ink">
        {t.rich("forgotPassword.title", { neon: (c) => <span className="neon-text">{c}</span> })}
      </h1>

      {status === "sent" ? (
        <div className="glass neon-edge mt-6 p-6">
          <p className="t-title text-ink">{t("forgotPassword.sentTitle")}</p>
          <p className="t-body mt-2 text-muted">
            {t.rich("forgotPassword.sentBody", { email, strong: (c) => <span className="text-ink">{c}</span> })}
          </p>
          <Link href="/login" className="btn btn-tonal mt-5">
            {t("forgotPassword.backToLogin")}
          </Link>
        </div>
      ) : (
        <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
          <p className="t-body text-muted">
            {t("forgotPassword.intro")}
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="t-label text-muted">{t("common.email")}</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("common.emailPlaceholder")}
              className="field px-4 py-3.5 text-sm"
            />
          </label>
          {error && <p className="text-xs text-bad">{error}</p>}
          <button
            type="submit"
            disabled={status === "sending"}
            className="btn btn-primary mt-2 disabled:opacity-60"
          >
            {status === "sending" ? t("forgotPassword.sending") : t("forgotPassword.submit")}
          </button>
          <p className="t-body mt-3 text-center text-xs text-muted">
            <Link href="/login" className="text-neon">
              {t("forgotPassword.backToLogin")}
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
