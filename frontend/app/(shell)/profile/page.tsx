"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/locale";
import { useMe, useProfile, useLogout } from "@/lib/hooks";
import { SafetyBanner } from "@/components/safety/SafetyBanner";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[rgba(150,190,255,0.08)] py-3 last:border-0">
      <span className="t-label text-muted">{label}</span>
      <span className="t-body text-ink">{value}</span>
    </div>
  );
}

export default function ProfilePage() {
  const { data: me } = useMe();
  const { data: profile } = useProfile();
  const logout = useLogout();
  const tc = useTranslations("common");
  const ts = useTranslations("safety");
  const t = useTranslations("profile");
  const locale = useLocale();
  const th = useTranslations("historyImport");
  const tr = useTranslations("reminders");
  const tk = useTranslations("kitchen");
  // Valor desconocido del servidor: se muestra tal cual en vez de romper la vista
  const opt = (group: string, v?: string | null) => (v ? (t.has(`options.${group}.${v}`) ? t(`options.${group}.${v}`) : v) : null);

  // useLogout limpia el dispositivo y abre /login con una carga completa (F15).
  async function onLogout() {
    await logout.mutateAsync();
  }

  const dash = (x?: string | number | null) => (x === null || x === undefined || x === "" ? "—" : String(x));

  return (
    <div className="pt-4">
      <h1 className="t-display text-2xl text-ink">{t("title")}</h1>

      <section className="glass rise mt-5 p-5" style={{ animationDelay: "40ms" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full glass font-display text-neon">
            {me?.email ? me.email[0].toUpperCase() : "?"}
          </div>
          <div>
            <p className="t-body text-ink">{me?.email ?? "—"}</p>
            <span className="badge badge-neon mt-1">{me?.role ?? "—"}</span>
          </div>
        </div>
      </section>

      <section className="glass rise mt-4 px-5 py-2" style={{ animationDelay: "100ms" }}>
        <Row label={t("dob")} value={profile?.date_of_birth ? formatDate(locale, profile.date_of_birth, "longYear") : "—"} />
        <Row label={t("gender")} value={dash(opt("gender", profile?.gender))} />
        <Row label={t("height")} value={profile?.height_cm != null ? t("heightValue", { cm: profile.height_cm }) : "—"} />
        <Row label={t("stance")} value={dash(opt("stance", profile?.dominant_stance))} />
      </section>

      <SafetyBanner showEmpty />
      <Link href="/onboarding?redo=1" data-testid="redo-screening" className="btn btn-outline mt-3 w-full">
        {ts("redo")}
      </Link>

      <Link href="/profile/edit" className="btn btn-tonal mt-4 w-full">
        {t("edit.link")}
      </Link>
      <Link href="/profile/import" data-testid="history-import-link" className="btn btn-outline mt-3 w-full">
        {th("profileLink")}
      </Link>
      <Link href="/profile/kitchen" data-testid="kitchen-link" className="btn btn-outline mt-3 w-full">
        {tk("link")}
      </Link>
      <Link href="/profile/reminders" data-testid="reminders-link" className="btn btn-outline mt-3 w-full">
        {tr("link")}
      </Link>
      <Link href="/profile/credits" className="btn btn-outline mt-3 w-full">
        {tc("creditsLink")}
      </Link>
      <button onClick={onLogout} className="btn btn-outline mt-3 w-full">
        {t("logout")}
      </button>
    </div>
  );
}
