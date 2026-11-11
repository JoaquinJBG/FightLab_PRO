"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight } from "@/components/icons";
import { credentials } from "@/lib/schemas";
import { resetActivityUid } from "@/lib/activities";
import { claimDeviceForCurrentUser } from "@/lib/user-state";

export default function LoginPage() {
  const t = useTranslations("auth");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const expired = useSyncExternalStore(
    () => () => {},
    () => new URLSearchParams(window.location.search).get("reason") === "expired",
    () => false,
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = credentials.safeParse({ email, password });
    if (!parsed.success) {
      setError(parsed.error.issues[0].path[0] === "email" ? t("common.emailInvalid") : t("common.passwordMin"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (res.ok) {
        resetActivityUid(); // que nada se encole a nombre del usuario anterior de este móvil
        await claimDeviceForCurrentUser(); // si los datos locales eran de otra cuenta, se borran antes de entrar
        // Carga completa: el login ha puesto la cookie con el idioma del perfil y el layout raíz
        // tiene que volver a leer los textos (con router.push se quedaría el idioma del navegador).
        window.location.assign("/today");
        return;
      }
      setError(t("login.badCredentials"));
    } catch {
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
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
          <p className="t-body mt-2 text-muted">{t("login.tagline")}</p>
        </div>
        {expired && (
          <p role="status" className="t-body mb-3 text-center text-sm text-muted">
            {t("login.sessionExpired")}
          </p>
        )}
        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <label className="flex flex-col gap-1.5">
            <span className="t-label text-muted">{t("common.email")}</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("common.emailPlaceholder")}
              className="field px-4 py-3.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="t-label text-muted">{t("common.password")}</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="field px-4 py-3.5 text-sm"
            />
          </label>
          <Link href="/forgot-password" className="t-body self-end text-xs text-neon">
            {t("login.forgotPassword")}
          </Link>
          {error && <p className="text-xs text-bad">{error}</p>}
          <button type="submit" disabled={loading} className="btn btn-primary mt-2 disabled:opacity-60">
            {loading ? t("login.submitting") : t("login.submit")}
            <ArrowUpRight className="h-4 w-4" />
          </button>
        </form>
        <p className="t-body mt-6 text-center text-xs text-muted">
          {t("login.noAccount")}{" "}
          <Link href="/register" className="text-neon">
            {t("login.createAccount")}
          </Link>
        </p>
      </div>
    </div>
  );
}
