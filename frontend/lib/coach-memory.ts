// Memoria persistente del coach (P0.3): lo que el atleta cuenta de sí mismo y
// que el coach recuerda entre conversaciones — lesión/molestias activas, fase
// del campamento o de la temporada, fecha de la pelea/competición, objetivo de
// peso, tono preferido y frecuencia de avisos.
//
// Se guarda con `useUserState("coach_memory", ...)`: localStorage primero,
// copia de seguridad en el servidor (ver backend/userstate). El servidor la
// lee directamente del modelo `UserState` para construir el system prompt del
// coach (ver backend/ai/services.py), sanitizada y acotada igual que aquí.

export type CoachTone = "directo" | "motivador" | "tecnico";
export type CoachAlertFrequency = "alta" | "media" | "baja";

/** Forma canónica guardada: claves opcionales, solo las que el atleta rellenó. */
export type CoachMemory = {
  lesion?: string;
  fase?: string;
  fecha_pelea?: string; // YYYY-MM-DD
  objetivo_peso_kg?: number;
  tono?: CoachTone;
  frecuencia_avisos?: CoachAlertFrequency;
};

export const EMPTY_COACH_MEMORY: CoachMemory = {};

/** Forma "de formulario": todo string, cómoda para inputs controlados. */
export type CoachMemoryDraft = {
  lesion: string;
  fase: string;
  fechaPelea: string;
  objetivoPesoKg: string;
  tono: CoachTone | "";
  frecuenciaAvisos: CoachAlertFrequency | "";
};

export const EMPTY_DRAFT: CoachMemoryDraft = {
  lesion: "",
  fase: "",
  fechaPelea: "",
  objetivoPesoKg: "",
  tono: "",
  frecuenciaAvisos: "",
};

const MAX_LESION = 200;
const MAX_FASE = 120;
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const TONOS: readonly CoachTone[] = ["directo", "motivador", "tecnico"];
const FRECUENCIAS: readonly CoachAlertFrequency[] = ["alta", "media", "baja"];

function isTono(v: unknown): v is CoachTone {
  return typeof v === "string" && (TONOS as readonly string[]).includes(v);
}
function isFrecuencia(v: unknown): v is CoachAlertFrequency {
  return typeof v === "string" && (FRECUENCIAS as readonly string[]).includes(v);
}

/** Defensivo: lo que venga de localStorage o del servidor puede estar
 *  corrupto, desactualizado o (en teoría) manipulado — nunca se usa tal cual. */
export function sanitizeCoachMemory(raw: unknown): CoachMemory {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: CoachMemory = {};
  if (typeof r.lesion === "string" && r.lesion.trim()) out.lesion = r.lesion.trim().slice(0, MAX_LESION);
  if (typeof r.fase === "string" && r.fase.trim()) out.fase = r.fase.trim().slice(0, MAX_FASE);
  if (typeof r.fecha_pelea === "string" && FECHA_RE.test(r.fecha_pelea)) out.fecha_pelea = r.fecha_pelea;
  const peso = r.objetivo_peso_kg;
  if (typeof peso === "number" && Number.isFinite(peso) && peso > 0 && peso < 400) {
    out.objetivo_peso_kg = Math.round(peso * 10) / 10;
  }
  if (isTono(r.tono)) out.tono = r.tono;
  if (isFrecuencia(r.frecuencia_avisos)) out.frecuencia_avisos = r.frecuencia_avisos;
  return out;
}

export function isCoachMemoryEmpty(m: CoachMemory): boolean {
  return Object.keys(m).length === 0;
}

export function draftFromMemory(m: CoachMemory): CoachMemoryDraft {
  return {
    lesion: m.lesion ?? "",
    fase: m.fase ?? "",
    fechaPelea: m.fecha_pelea ?? "",
    objetivoPesoKg: m.objetivo_peso_kg != null ? String(m.objetivo_peso_kg) : "",
    tono: m.tono ?? "",
    frecuenciaAvisos: m.frecuencia_avisos ?? "",
  };
}

/** Convierte el formulario a la forma canónica, aplicando los mismos límites
 *  que `sanitizeCoachMemory` (un input vacío o inválido simplemente no entra). */
export function memoryFromDraft(d: CoachMemoryDraft): CoachMemory {
  return sanitizeCoachMemory({
    lesion: d.lesion,
    fase: d.fase,
    fecha_pelea: d.fechaPelea,
    objetivo_peso_kg: d.objetivoPesoKg.trim() ? Number(d.objetivoPesoKg.replace(",", ".")) : null,
    tono: d.tono || null,
    frecuencia_avisos: d.frecuenciaAvisos || null,
  });
}

export const TONE_LABELS: Record<CoachTone, string> = {
  directo: "Directo",
  motivador: "Motivador",
  tecnico: "Técnico",
};

export const FREQUENCY_LABELS: Record<CoachAlertFrequency, string> = {
  alta: "Frecuentes",
  media: "Normal",
  baja: "Solo lo esencial",
};

/** Frecuencia de avisos: con "baja" el atleta pidió que le molestemos poco,
 *  así que las recomendaciones puramente informativas ("info") se ocultan y
 *  solo se muestran los avisos que de verdad importan (warn) o la confirmación
 *  de que todo va bien (good). Con "alta"/"media" (o sin preferencia) no se
 *  filtra nada. */
export function shouldShowRecForFrequency(tone: "warn" | "info" | "good", frequency: CoachAlertFrequency | undefined): boolean {
  if (frequency !== "baja") return true;
  return tone !== "info";
}
