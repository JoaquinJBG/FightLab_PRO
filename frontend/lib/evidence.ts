import type { RuleDetail } from "./schemas";

export const GRADES = ["strong", "moderate", "emerging"] as const;
export type Grade = (typeof GRADES)[number];

export function asGrade(g: string | null | undefined): Grade | null {
  return (GRADES as readonly string[]).includes(g ?? "") ? (g as Grade) : null;
}

// Colores fijos en toda la app (no dependen del tema ni del idioma).
export const GRADE_COLOR: Record<Grade, string> = {
  strong: "var(--color-good)",
  moderate: "var(--color-warn)",
  emerging: "var(--color-neon)",
};

export type RuleLabel = "machine" | "untranslated" | null;

export type RuleText = {
  heading: string;
  rule_text: string;
  applies_to: string;
  conflicts: string;
  label: RuleLabel;
};

/** Qué texto de la regla se muestra en cada idioma (spec §7.2).
 * `en`: el original. Otro idioma: la traducción (con la etiqueta "traducción
 * automática" mientras no esté revisada) o, si no hay o está obsoleta, el original
 * con la etiqueta "sin traducir". */
export function pickRuleText(rule: RuleDetail, locale: string): RuleText {
  const original = {
    heading: rule.heading,
    rule_text: rule.rule_text,
    applies_to: rule.applies_to,
    conflicts: rule.conflicts,
  };
  if (locale === "en") return { ...original, label: null };
  const tr = rule.translation;
  if (!tr || tr.lang !== locale || tr.status === "stale") {
    return { ...original, label: "untranslated" };
  }
  return {
    heading: tr.heading || original.heading,
    rule_text: tr.rule_text || original.rule_text,
    applies_to: tr.applies_to || original.applies_to,
    conflicts: tr.conflicts || original.conflicts,
    label: tr.status === "machine" ? "machine" : null,
  };
}

/* F20 de la prueba en móvil: las reglas de la base de evidencia están escritas también para el motor
 * («El texto del coach puede decir que…», «la app no debe decir…»). Al usuario se le enseña lo que
 * le sirve: la frase «X puede/debe decir que Y» queda en «Y», y las prohibiciones dirigidas a la
 * app (qué no debe decir o cómo etiquetar un aviso) se quitan. */
const ENGINE_ONLY =
  /\b(?:must not|should not|may not)\s+(?:say|imply|suggest|tell|present)\b|\bmust be label+ed\b|\bno debe(?:n)?\s+(?:decir|dar a entender|sugerir|presentar)\b|\bdebe etiquetarse\b/i;
const SPEAKER_PREFIX =
  /^.*?\b(?:FightLab|the app|la app|(?:the )?coach(?:'s)? text|el texto del coach)\s+(?:may|can|must|should|puede|debe)\s+(?:say|tell|decir)\b[^.;]*?\s(?:that|que)\s+/i;

export function userFacingRuleText(text: string): string {
  if (!text) return text;
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    if (ENGINE_ONLY.test(sentence)) continue;
    const m = SPEAKER_PREFIX.exec(sentence);
    if (m) {
      const rest = sentence.slice(m[0].length);
      out.push(rest.charAt(0).toLocaleUpperCase() + rest.slice(1));
    } else out.push(sentence);
  }
  return out.length > 0 ? out.join(" ") : text;
}

/** `[[regla:clave]]` en un texto del chat → trozos de texto y claves de regla. */
export function splitCitations(text: string): { text?: string; key?: string }[] {
  const out: { text?: string; key?: string }[] = [];
  const re = /\[\[regla:([^\]\s]+)\]\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ key: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
