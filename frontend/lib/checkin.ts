// Check-in diario (fase 5): del formulario al cuerpo de `POST /coach/checkin`.
// Aquí solo se traduce lo que escribe la persona; el servidor valida los rangos y decide qué se
// guarda (`no_weight_targets`), y qué efecto tiene cada señal de alarma.
import { SCORE_KEYS } from "./schemas";

export type ScoreKey = (typeof SCORE_KEYS)[number];

/** Las señales de alarma de `checkin/SKILL.md` paso 3, tal como las marca la persona. */
export const SIGN_KEYS = [
  "cardiac",
  "systemic_illness",
  "head_cold",
  "disordered_eating",
  "rhabdo",
  "injury",
] as const;
export type SignKey = (typeof SIGN_KEYS)[number];

export type CheckinForm = {
  scores: Partial<Record<ScoreKey, number>>;
  zones: string[];
  sleepHours: string;
  intake: string;
  weight: string;
  waist: string;
  rhr: string;
  hrv: string;
  notes: string;
  signs: Record<SignKey, boolean>;
  cardiacEmergency: boolean;
  disorderedUrgent: boolean;
  injury: { area: string; exercises: string; professional: string; severe: boolean };
  period: string | null;
  contraception: boolean;
  bpSystolic: string;
  bpDiastolic: string;
};

export const EMPTY_FORM: CheckinForm = {
  scores: {},
  zones: [],
  sleepHours: "",
  intake: "",
  weight: "",
  waist: "",
  rhr: "",
  hrv: "",
  notes: "",
  signs: {
    cardiac: false,
    systemic_illness: false,
    head_cold: false,
    disordered_eating: false,
    rhabdo: false,
    injury: false,
  },
  cardiacEmergency: false,
  disorderedUrgent: false,
  injury: { area: "", exercises: "", professional: "", severe: false },
  period: null,
  contraception: false,
  bpSystolic: "",
  bpDiastolic: "",
};

/** Un número escrito a mano (acepta la coma decimal); null si está vacío o no es un número. */
export function parseNum(value: string): number | null {
  const text = value.trim().replace(",", ".");
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export type Sign = Record<string, unknown> & { code: string };

export function buildSigns(form: CheckinForm): Sign[] {
  const out: Sign[] = [];
  if (form.signs.cardiac) out.push({ code: "cardiac", emergency: form.cardiacEmergency });
  if (form.signs.systemic_illness) out.push({ code: "systemic_illness" });
  if (form.signs.head_cold) out.push({ code: "head_cold" });
  if (form.signs.disordered_eating) out.push({ code: "disordered_eating", urgent: form.disorderedUrgent });
  if (form.signs.rhabdo) out.push({ code: "rhabdo" });
  if (form.signs.injury) {
    const exercises = form.injury.exercises.split(",").map((e) => e.trim()).filter(Boolean);
    const sign: Sign = { code: "injury", area: form.injury.area.trim(), exercises, severe: form.injury.severe };
    if (form.injury.professional.trim()) sign.professional = form.injury.professional.trim();
    out.push(sign);
  }
  return out;
}

/** El cuerpo de la petición. Con el pesaje bloqueado no se manda peso, cintura ni kcal (el
 * formulario ni los pide), y lo vacío no se manda: en el motor, vacío es "no dado". */
export function buildPayload(
  form: CheckinForm,
  opts: { blocked: boolean; weekly: { menstrual: boolean; bp: boolean } },
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== null && value !== undefined && value !== "") payload[key] = value;
  };
  if (!opts.blocked) {
    put("weight_kg", parseNum(form.weight));
    put("waist_cm", parseNum(form.waist));
    put("intake_kcal", parseNum(form.intake));
  }
  put("sleep_hours", parseNum(form.sleepHours));
  for (const key of SCORE_KEYS) put(key, form.scores[key]);
  if (form.zones.length) payload.soreness_zones = form.zones;
  put("resting_heart_rate", parseNum(form.rhr));
  put("hrv_ms", parseNum(form.hrv));
  put("notes", form.notes.trim());
  if (opts.weekly.menstrual && form.period) {
    payload.period_status = form.period;
    if (form.contraception) payload.hormonal_contraception = true;
  }
  if (opts.weekly.bp) {
    put("bp_systolic", parseNum(form.bpSystolic));
    put("bp_diastolic", parseNum(form.bpDiastolic));
  }
  const signs = buildSigns(form);
  if (signs.length) payload.signs = signs;
  return payload;
}

/** Las claves de `checkin.result.items.*` de lo que lleva la petición, para el resumen. */
export function recordedItems(payload: Record<string, unknown>): string[] {
  const has = (...keys: string[]) => keys.some((k) => k in payload);
  const items: [string, boolean][] = [
    ["weight", has("weight_kg")],
    ["waist", has("waist_cm")],
    ["intake", has("intake_kcal")],
    ["sleep", has("sleep_hours")],
    ["wellness", has(...SCORE_KEYS, "soreness_zones")],
    ["rhr", has("resting_heart_rate")],
    ["hrv", has("hrv_ms")],
    ["notes", has("notes")],
    ["weekly", has("period_status", "bp_systolic", "bp_diastolic")],
    ["signs", has("signs")],
  ];
  return items.filter(([, on]) => on).map(([key]) => key);
}

/** Pesajes que faltan para la tendencia (el motor pide `min_points`). */
export function missingWeighIns(points: number, minPoints: number): number {
  return Math.max(0, minPoints - points);
}
