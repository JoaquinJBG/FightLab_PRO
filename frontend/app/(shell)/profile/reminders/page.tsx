"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { RemindersSettings } from "@/components/reminders/RemindersSettings";

export default function RemindersPage() {
  const t = useTranslations("reminders");
  return (
    <div>
      <Link href="/profile" className="t-label mt-4 inline-block text-muted">
        ← {t("back")}
      </Link>
      <RemindersSettings />
    </div>
  );
}
