import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  COACH_REPO_URL,
  CC_BY_URL,
  FIGHTLAB_LICENSE_CONTENT_URL,
  FIGHTLAB_LICENSE_URL,
  ODBL_URL,
  OFF_URL,
  PARQ_URL,
  USDA_URL,
} from "@/lib/credits";
import { EngineLine } from "@/components/evidence/EngineLine";

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-neon underline">
      {children}
    </a>
  );
}

export default function CreditsPage() {
  const t = useTranslations("credits");
  const tc = useTranslations("common");
  const link = {
    coach: (c: React.ReactNode) => <Ext href={COACH_REPO_URL}>{c}</Ext>,
    ccby: (c: React.ReactNode) => <Ext href={CC_BY_URL}>{c}</Ext>,
    usda: (c: React.ReactNode) => <Ext href={USDA_URL}>{c}</Ext>,
    off: (c: React.ReactNode) => <Ext href={OFF_URL}>{c}</Ext>,
    odbl: (c: React.ReactNode) => <Ext href={ODBL_URL}>{c}</Ext>,
    parq: (c: React.ReactNode) => <Ext href={PARQ_URL}>{c}</Ext>,
    license: (c: React.ReactNode) => <Ext href={FIGHTLAB_LICENSE_URL}>{c}</Ext>,
    licenseContent: (c: React.ReactNode) => <Ext href={FIGHTLAB_LICENSE_CONTENT_URL}>{c}</Ext>,
  };

  return (
    <div className="pt-4">
      <Link href="/profile" className="t-label text-muted">
        ← {tc("back")}
      </Link>
      <h1 className="t-display mt-2 text-2xl text-ink">{t("title")}</h1>

      <section className="glass rise mt-5 p-5">
        <h2 className="t-label text-muted">{t("coach.title")}</h2>
        <p className="t-body mt-2 text-ink">{t.rich("coach.body", link)}</p>
        <p className="t-body mt-3 text-ink">{t("changes.title")}</p>
        <p className="t-body mt-1 text-muted">{t("changes.body")}</p>
        <EngineLine />
      </section>

      <section className="glass rise mt-4 p-5">
        <h2 className="t-label text-muted">{t("data.title")}</h2>
        <ul className="t-body mt-2 list-disc space-y-2 pl-5 text-ink">
          <li>{t.rich("data.usda", link)}</li>
          <li>{t.rich("data.off", link)}</li>
          <li>{t.rich("data.parq", link)}</li>
        </ul>
      </section>

      <section className="glass rise mt-4 p-5">
        <h2 className="t-label text-muted">{t("fightlab.title")}</h2>
        <p className="t-body mt-2 text-ink">{t.rich("fightlab.body", link)}</p>
      </section>
    </div>
  );
}
