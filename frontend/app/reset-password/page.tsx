"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

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
  const t = useTranslations("auth");
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
  // F27: el email de la cuenta del enlace, para el campo de usuario oculto. Sin él, Chrome no sabe
  // de qué cuenta es la contraseña nueva: sugiere la suya y luego pide «Añade tu nombre de usuario».
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!uid || !token) return;
    let alive = true;
    fetch("/api/auth/password-reset/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, token }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { email?: unknown } | null) => {
        if (alive && typeof d?.email === "string") setEmail(d.email);
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [uid, token]);

  const missingLink = !uid || !token;
  const heading = t.rich(creating ? "resetPassword.titleCreate" : "resetPassword.titleReset", { neon: (c) => <span className="neon-text">{c}</span> });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (missingLink) {
      setError(t("resetPassword.invalidLinkError"));
      return;
    }
    if (password.length < 8) {
      setError(t("resetPassword.tooShort"));
      return;
    }
    if (password !== confirm) {
      setError(t("resetPassword.mismatch"));
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
      setError(typeof d?.detail === "string" ? d.detail : t("resetPassword.expired"));
    } catch {
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <>
        <h1 className="t-display text-3xl text-ink">{heading}</h1>
        <div className="glass neon-edge mt-6 p-6 text-center">
          <p className="t-title text-ink">{t("resetPassword.doneTitle")}</p>
          <p className="t-body mt-2 text-muted">{t("resetPassword.doneBody")}</p>
          <button type="button" onClick={() => router.push("/login")} className="btn btn-primary mt-5">
            {t("resetPassword.signIn")}
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
          <p className="t-title text-ink">{t("resetPassword.invalidLinkTitle")}</p>
          <p className="t-body mt-2 text-muted">
            {t("resetPassword.invalidLinkBody")}
          </p>
          <Link href="/forgot-password" className="btn btn-tonal mt-5">
            {t("resetPassword.requestNew")}
          </Link>
        </div>
      </>
    );
  }

  return (
    <>
      <h1 className="t-display text-3xl text-ink">{heading}</h1>
      <form className="mt-6 flex flex-col gap-3" onSubmit={onSubmit}>
        {/* Campo de usuario oculto para el gestor de contraseñas (F27): no se ve ni se puede tocar */}
        <input
          type="email"
          name="username"
          autoComplete="username"
          value={email}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
          data-testid="reset-username"
          className="sr-only"
        />
        <label className="flex flex-col gap-1.5">
          <span className="t-label text-muted">{creating ? t("common.password") : t("resetPassword.newPassword")}</span>
          <input
            type="password"
            name="new-password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("register.passwordPlaceholder")}
            className="field px-4 py-3.5 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="t-label text-muted">{t("resetPassword.confirm")}</span>
          <input
            type="password"
            name="confirm-password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={t("register.passwordPlaceholder")}
            className="field px-4 py-3.5 text-sm"
          />
        </label>
        {error && <p className="text-xs text-bad">{error}</p>}
        <button type="submit" disabled={loading} className="btn btn-primary mt-2 disabled:opacity-60">
          {loading ? t("resetPassword.saving") : creating ? t("resetPassword.submitCreate") : t("resetPassword.submitReset")}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
  const t = useTranslations("auth.resetPassword");
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 safe-top safe-bottom">
      <Suspense
        fallback={
          <>
            <h1 className="t-display text-3xl text-ink">{t.rich("titleReset", { neon: (c) => <span className="neon-text">{c}</span> })}</h1>
            <p className="t-body mt-6 text-muted">{t("loading")}</p>
          </>
        }
      >
        <ResetPasswordForm />
      </Suspense>
    </div>
  );
}
