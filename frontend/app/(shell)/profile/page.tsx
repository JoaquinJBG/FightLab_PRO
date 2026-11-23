"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/locale";
import { useMe, useProfile, useLogout, useDisciplines, useSetDiscipline } from "@/lib/hooks";

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[12px]">
      <span className="t-label text-muted">{label}</span>
      <span className="t-body truncate text-ink">{value}</span>
    </div>
  );
}

const row = "glass flex min-h-10 items-center justify-center px-3 py-1.5 text-center leading-tight";

function LinkRow({ href, label, testId }: { href: string; label: string; testId?: string }) {
  return (
    <Link href={href} data-testid={testId} className={row}>
      <span className="t-label text-ink">{label}</span>
    </Link>
  );
}

function Switch({ label, checked, onToggle, testId }: { label: string; checked: boolean; onToggle: () => void; testId: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      data-testid={testId}
      onClick={onToggle}
      className="flex min-h-10 w-full items-center justify-between gap-3 text-left"
    >
      <span className="t-label min-w-0 text-ink">{label}</span>
      <span
        aria-hidden="true"
        className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${checked ? "border-[rgba(69,233,255,0.6)] bg-[rgba(69,233,255,0.35)]" : "border-[rgba(150,190,255,0.25)] bg-[rgba(150,190,255,0.08)]"}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-ink transition-all ${checked ? "left-[1.375rem]" : "left-0.5"}`} />
      </span>
    </button>
  );
}

/** «Qué entrenas»: oculta lo que no se usa (solo navegación; nada se borra ni se oculta de seguridad). */
function DisciplinesCard() {
  const t = useTranslations("profile.disciplines");
  const { gym, combat } = useDisciplines();
  const set = useSetDiscipline();
  return (
    <section data-testid="disciplines" aria-label={t("title")} className="glass rise mt-2 px-4 py-2" style={{ animationDelay: "80ms" }}>
      <p className="t-eyebrow text-muted">{t("title")}</p>
      <Switch label={t("gym")} checked={gym} testId="switch-gym" onToggle={() => set.mutate({ show_gym: !gym })} />
      <Switch label={t("combat")} checked={combat} testId="switch-combat" onToggle={() => set.mutate({ show_combat: !combat })} />
      <p className="t-body text-[11px] text-muted">{t("hint")}</p>
      {set.isError && <p role="alert" className="t-body mt-1 text-xs text-warn">{t("saveError")}</p>}
    </section>
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
  const tr = useTranslations("reminders");
  // Valor desconocido del servidor: se muestra tal cual en vez de romper la vista
  const opt = (group: string, v?: string | null) => (v ? (t.has(`options.${group}.${v}`) ? t(`options.${group}.${v}`) : v) : null);

  // useLogout limpia el dispositivo y abre /login con una carga completa (F15).
  async function onLogout() {
    await logout.mutateAsync();
  }

  const dash = (x?: string | number | null) => (x === null || x === undefined || x === "" ? "—" : String(x));

  return (
    <div className="pt-3">
      <h1 className="t-display text-2xl text-ink">{t("title")}</h1>

      <section className="glass rise mt-2 p-3" style={{ animationDelay: "40ms" }}>
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full glass font-display text-neon">
            {me?.email ? me.email[0].toUpperCase() : "?"}
          </div>
          <div className="min-w-0">
            <p className="t-body truncate text-ink">{me?.email ?? "—"}</p>
            <span className="badge badge-neon mt-1">{me?.role ? (t.has(`roles.${me.role}`) ? t(`roles.${me.role}`) : me.role) : "—"}</span>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-[rgba(150,190,255,0.08)] pt-2">
          <Info label={t("dob")} value={profile?.date_of_birth ? formatDate(locale, profile.date_of_birth, "longYear") : "—"} />
          <Info label={t("gender")} value={dash(opt("gender", profile?.gender))} />
          <Info label={t("height")} value={profile?.height_cm != null ? t("heightValue", { cm: profile.height_cm }) : "—"} />
          <Info label={t("stance")} value={dash(opt("stance", profile?.dominant_stance))} />
        </div>
      </section>

      <DisciplinesCard />

      <nav aria-label={t("title")} className="mt-2 grid grid-cols-2 gap-2">
        <LinkRow href="/profile/edit" label={t("edit.link")} testId="edit-profile-link" />
        <LinkRow href="/onboarding?redo=1" label={ts("redo")} testId="redo-screening" />
        <LinkRow href="/profile/reminders" label={tr("link")} testId="reminders-link" />
        <LinkRow href="/profile/import-hub" label={t("importData")} testId="import-hub-link" />
        <LinkRow href="/profile/credits" label={tc("creditsLink")} testId="credits-link" />
        <button type="button" onClick={onLogout} className={row}>
          <span className="t-label text-ink">{t("logout")}</span>
        </button>
      </nav>
    </div>
  );
}
