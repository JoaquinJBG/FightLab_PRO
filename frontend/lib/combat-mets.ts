// METs de las sesiones de combate (E.5): las entradas del Compendio de Actividades Físicas 2024
// para adultos que recoge el anexo (combat-sports "Use 2024 Compendium METs as combat intensity
// anchors"), con el nombre de la entrada. MMA, BJJ y grappling no tienen entrada propia: se usa
// la general y se marca como aproximación. El gasto se muestra como un rango (convención de
// FightLab: ±20 %), nunca como el gasto real (combat-sports "METs classify intensity but do not
// give individual kcal").

export type MetEntry = {
  met: number;
  entry: string; // la entrada del Compendio 2024 como la describe el anexo (en inglés)
  approx?: boolean; // sin entrada propia: se usa la general
  estimated?: boolean; // el Compendio marca el valor como estimado
};

// Entradas del anexo (Compendio 2024)
const BOXING_SPARRING: MetEntry = { met: 7.8, entry: "boxing, sparring" };
const BOXING_BAG: MetEntry = { met: 5.8, entry: "boxing, punching bag, general" };
const MARTIAL_MODERATE: MetEntry = { met: 10.3, entry: "martial arts, moderate pace" };
const MARTIAL_NOVICE: MetEntry = { met: 5.3, entry: "martial arts, novice slower-pace practice" };
const KICKBOXING: MetEntry = { met: 7.3, entry: "kickboxing" };
const TAEKWONDO_COMBAT: MetEntry = { met: 14.3, entry: "taekwondo, combat simulation" };
const WRESTLING: MetEntry = { met: 6.0, entry: "competitive wrestling (one 5-min match)", estimated: true };

const approx = (e: MetEntry): MetEntry => ({ ...e, approx: true });

/** La entrada del Compendio para un arte y un tipo de trabajo del registro de MMA, o `null` si
 * el Compendio no tiene una que encaje (acondicionamiento, pads de boxeo): no se estima. */
export function metFor(art: string, workType: string): MetEntry | null {
  if (workType === "Acondicionamiento") return null;
  if (workType === "Técnica") return art === "Boxeo" ? null : approx(MARTIAL_NOVICE);
  switch (art) {
    case "Boxeo":
      if (workType === "Sparring") return BOXING_SPARRING;
      if (workType === "Saco") return BOXING_BAG;
      return null;
    case "Kickboxing":
      return KICKBOXING;
    case "Taekwondo":
      return workType === "Sparring" ? TAEKWONDO_COMBAT : MARTIAL_MODERATE;
    case "Muay Thai":
    case "Karate":
      return MARTIAL_MODERATE;
    case "Lucha":
      return approx(WRESTLING);
    case "BJJ":
    case "MMA":
      return approx(MARTIAL_MODERATE);
    default:
      return null;
  }
}

/** Convención de FightLab (sin revisar): ancho del rango alrededor de la estimación. */
export const KCAL_BAND = 0.2;

/** kcal ≈ MET × 3,5 × kg / 200 × min, como rango de ±20 %, redondeado a 10 kcal. */
export function kcalRange(met: number, weightKg: number, minutes: number): { low: number; high: number } {
  const mid = ((met * 3.5 * weightKg) / 200) * minutes;
  const round10 = (x: number) => Math.round(x / 10) * 10;
  return { low: round10(mid * (1 - KCAL_BAND)), high: round10(mid * (1 + KCAL_BAND)) };
}
