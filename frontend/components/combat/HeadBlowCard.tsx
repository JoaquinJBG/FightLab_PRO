"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EvidenceChip } from "@/components/evidence/EvidenceChip";
import { useSafety } from "@/lib/hooks";
import { COMBAT_RULES, type RuleRef } from "@/lib/combat-rules";
import { blocksContact, noContact, todayIso, useClearContact, useHeadImpacts, useReportHeadImpact } from "@/lib/combat";

const STOP = "#ff5a6e";
const STEPS = ["1", "2", "3", "4", "5", "6"] as const;
const Chip = ({ r }: { r: RuleRef }) => <EvidenceChip ruleKey={r.key} grade={r.grade} />;

function Crt6Link({ url }: { url?: string | null }) {
  const tc = useTranslations("combat.head");
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" data-testid="crt6-link" className="t-body mt-2 block text-xs text-neon underline">
      {tc("crt6")}
    </a>
  );
}

function YesNo({ label, hint, value, onChange, name }: {
  label: string; hint: string; value: boolean | null; onChange: (v: boolean) => void; name: string;
}) {
  const tc = useTranslations("combat.head");
  return (
    <fieldset className="mt-3">
      <legend className="t-label text-ink">{label}</legend>
      <p className="t-body mt-0.5 text-[11px] text-muted">{hint}</p>
      <div className="mt-2 flex gap-2">
        {([true, false] as const).map((v) => (
          <button key={String(v)} type="button" data-testid={`${name}-${v ? "yes" : "no"}`} onClick={() => onChange(v)}
            className={`btn btn-sm flex-1 ${value === v ? "btn-primary" : "btn-outline"}`}>
            {v ? tc("yes") : tc("no")}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Golpe en la cabeza (E.5): aviso estructurado, urgencias con señales de alarma, bloqueo del
 * contacto hasta el alta de un clínico y la vuelta graduada como información. El CRT6 se enlaza,
 * nunca se copia. Los textos son de FightLab y están pendientes de revisión clínica. */
export function HeadBlowCard() {
  const tc = useTranslations("combat.head");
  const { data: safety } = useSafety();
  const blocked = noContact(safety);
  const { data: impacts = [] } = useHeadImpacts(blocked);
  const report = useReportHeadImpact();
  const clear = useClearContact();

  const [open, setOpen] = useState(false);
  const [symptoms, setSymptoms] = useState<boolean | null>(null);
  const [redFlags, setRedFlags] = useState<boolean | null>(null);
  const [savedNoSymptoms, setSavedNoSymptoms] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [who, setWho] = useState("");

  const disclaimer = safety?.disclaimer;
  const emergency = safety?.emergency_number;

  function submit() {
    if (symptoms == null || redFlags == null) return;
    report.mutate(
      { symptoms, red_flags: redFlags, origin: "mma_session" },
      {
        onSuccess: () => {
          setSavedNoSymptoms(!symptoms && !redFlags);
          setOpen(false);
          setSymptoms(null);
          setRedFlags(null);
        },
      },
    );
  }

  if (blocked) {
    const ids = impacts.filter(blocksContact).map((i) => i.id);
    return (
      <section data-testid="no-contact-card" className="glass mt-4 p-4" style={{ borderColor: STOP }}>
        <p className="t-eyebrow" style={{ color: STOP }}>{tc("blockedTitle")}</p>
        <p className="t-body mt-2 text-sm text-ink">{tc("blockedBody")}</p>
        <div className="mt-2 flex flex-wrap gap-1.5"><Chip r={COMBAT_RULES.noContact} /><Chip r={COMBAT_RULES.relativeRest} /></div>
        <Crt6Link url={safety?.crt6_url} />

        <p className="t-label mt-4 text-ink">{tc("stepsTitle")}</p>
        <ol className="t-body mt-1.5 list-decimal pl-5 text-xs text-muted">
          {STEPS.map((k) => <li key={k}>{tc(`steps.${k}`)}</li>)}
        </ol>
        <p className="t-body mt-1.5 text-[11px] text-muted">{tc("stepsNote")} <Chip r={COMBAT_RULES.returnSteps} /></p>
        <p className="t-body mt-1 text-[11px] text-muted">{tc("stepsMap")} <Chip r={COMBAT_RULES.clearance} /></p>
        <p className="t-body mt-1 text-[11px] text-muted">{tc("headgear")} <Chip r={COMBAT_RULES.headgear} /></p>

        <div className="mt-4 rounded-xl border border-[rgba(150,190,255,0.14)] p-3">
          <p className="t-label text-ink">{tc("clearTitle")}</p>
          <label className="t-body mt-2 flex items-start gap-2 text-xs text-ink">
            <input type="checkbox" data-testid="clear-confirm" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5" />
            {tc("clearConfirm")}
          </label>
          <input value={who} onChange={(e) => setWho(e.target.value)} placeholder={tc("clearWho")} maxLength={120}
            className="field mt-2 w-full px-3 py-2 text-sm" />
          <button type="button" data-testid="clear-contact" disabled={!confirm || !ids.length || clear.isPending}
            onClick={() => clear.mutate({ ids, clearedOn: todayIso(), clearedBy: who.trim() || null })}
            className="btn btn-outline btn-sm mt-2 w-full disabled:opacity-50">
            {tc("clear")}
          </button>
          <p className="t-body mt-1.5 text-[10px] text-muted">{tc("clearNote")}</p>
        </div>
        {disclaimer && <p data-testid="combat-disclaimer" className="t-body mt-3 text-[11px] italic text-muted">{disclaimer}</p>}
      </section>
    );
  }

  return (
    <section data-testid="head-blow-card" className="glass mt-4 p-4">
      <p className="t-eyebrow text-muted">{tc("title")}</p>
      <p className="t-body mt-1.5 text-xs text-muted">{tc("intro")} <Chip r={COMBAT_RULES.stopAfterHeadBlow} /></p>
      {savedNoSymptoms && (
        <p data-testid="head-no-symptoms" className="t-body mt-2 text-xs text-ink">{tc("noSymptoms")} <Chip r={COMBAT_RULES.feelingNormal} /></p>
      )}
      {!open ? (
        <button type="button" data-testid="head-report" onClick={() => { setOpen(true); setSavedNoSymptoms(false); }} className="btn btn-tonal btn-sm mt-3">
          {tc("report")}
        </button>
      ) : (
        <div>
          <YesNo name="head-symptoms" label={tc("symptomsQ")} hint={tc("symptomsHint")} value={symptoms} onChange={setSymptoms} />
          <YesNo name="head-red-flags" label={tc("redFlagsQ")} hint={tc("redFlagsHint")} value={redFlags} onChange={setRedFlags} />
          {redFlags && (
            <div data-testid="head-emergency" className="mt-3 rounded-xl p-3" style={{ border: `1px solid ${STOP}` }}>
              <p className="t-label" style={{ color: STOP }}>{tc("emergencyNow")}</p>
              {emergency && (
                <a href={`tel:${emergency}`} className="t-label mt-1 block" style={{ color: STOP }}>{tc("call", { number: emergency })}</a>
              )}
              <div className="mt-1.5"><Chip r={COMBAT_RULES.redFlags} /></div>
            </div>
          )}
          <Crt6Link url={safety?.crt6_url} />
          {report.isError && <p className="t-body mt-2 text-xs text-warn">{tc("error")}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn btn-outline btn-sm flex-1">{tc("cancel")}</button>
            <button type="button" data-testid="head-send" onClick={submit} disabled={symptoms == null || redFlags == null || report.isPending}
              className="btn btn-primary btn-sm flex-1 disabled:opacity-50">
              {report.isPending ? tc("sending") : tc("send")}
            </button>
          </div>
        </div>
      )}
      {disclaimer && <p data-testid="combat-disclaimer" className="t-body mt-3 text-[11px] italic text-muted">{disclaimer}</p>}
    </section>
  );
}

/** Aviso en el registro de MMA si el contacto está bloqueado y el trabajo elegido tiene contacto. */
export function ContactBlockNote({ contact }: { contact: boolean }) {
  const tc = useTranslations("combat.head");
  const { data: safety } = useSafety();
  if (!contact || !noContact(safety)) return null;
  return (
    <p data-testid="contact-block-note" className="t-body mt-2 rounded-xl p-2.5 text-xs text-ink" style={{ border: `1px solid ${STOP}` }}>
      {tc("contactNote")} <Chip r={COMBAT_RULES.clearance} />
    </p>
  );
}
