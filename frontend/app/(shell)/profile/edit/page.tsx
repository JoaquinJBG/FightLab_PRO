"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ProfileForm } from "@/components/profile-form";

export default function ProfileEditPage() {
  const router = useRouter();
  const t = useTranslations("profile");
  return (
    <div className="pt-4">
      <Link href="/profile" className="t-label text-muted">
        {t("edit.back")}
      </Link>
      <h1 className="t-display mt-2 text-2xl text-ink">
        {t.rich("edit.title", { neon: (c) => <span className="neon-text">{c}</span> })}
      </h1>
      <div className="mt-5">
        <ProfileForm submitLabel={t("edit.save")} onSaved={() => router.push("/profile")} />
      </div>
    </div>
  );
}
