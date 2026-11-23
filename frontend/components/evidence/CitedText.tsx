"use client";

import { splitCitations } from "@/lib/evidence";
import { EvidenceChip } from "./EvidenceChip";

export type Citation = { key: string; grade: string; title: string };

/** Texto del chat con las citas `[[regla:clave]]` convertidas en chips de evidencia.
 * El backend ya ha quitado las citas inválidas; si una clave no viene en `citations`
 * (no debería pasar) se muestra el chip sin grado. */
export function CitedText({ text, citations = [] }: { text: string; citations?: Citation[] }) {
  const byKey = new Map(citations.map((c) => [c.key, c]));
  return (
    <>
      {splitCitations(text).map((part, i) =>
        part.key ? (
          <EvidenceChip key={i} ruleKey={part.key} grade={byKey.get(part.key)?.grade} />
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}
