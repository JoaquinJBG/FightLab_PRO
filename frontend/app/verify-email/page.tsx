"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";

function Verify() {
  const t = useTranslations("auth.verifyEmail");
  const token = useSearchParams().get("token");
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    if (!token) {
      setState("error");
      return;
    }
    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => setState(r.ok ? "ok" : "error"))
      .catch(() => setState("error"));
  }, [token]);

  return (
    <div className="glass neon-edge mt-6 p-6 text-center">
      {state === "loading" && <p className="t-body text-muted">{t("verifying")}</p>}
      {state === "ok" && (
        <>
          <p className="t-title text-ink">{t("verified")}</p>
          <Link href="/login" className="btn btn-primary mt-5">
            {t("signIn")}
          </Link>
        </>
      )}
      {state === "error" && (
        <>
          <p className="t-title text-ink">{t("invalidLink")}</p>
          <Link href="/register" className="btn btn-tonal mt-5">
            {t("backToRegister")}
          </Link>
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  const t = useTranslations("auth.verifyEmail");
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 safe-top safe-bottom">
      <h1 className="t-display text-3xl text-ink">{t("title")}</h1>
      <Suspense fallback={<p className="t-body mt-6 text-muted">{t("loading")}</p>}>
        <Verify />
      </Suspense>
    </div>
  );
}
