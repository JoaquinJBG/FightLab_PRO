import { describe, expect, it } from "vitest";
import {
  ageOn,
  askVigorousReview,
  firstMissingStep,
  isOnboardingComplete,
  scoffOutcome,
  steps,
  triToBool,
  type ScoffAnswer,
} from "@/lib/onboarding";

const NO: ScoffAnswer = { answer: "no" };
const YES: ScoffAnswer = { answer: "yes" };

describe("SCOFF (setup/SKILL.md, paso 2)", () => {
  it("cuenta solo los síes claros", () => {
    expect(scoffOutcome([YES, NO, NO, NO, NO])).toEqual({ scoff_yes_count: 1, scoff_positive: true });
    expect(scoffOutcome([NO, NO, YES, YES, NO])).toEqual({ scoff_yes_count: 2, scoff_positive: false });
  });

  it("una respuesta parcial cuenta según la pregunta de seguimiento", () => {
    const partialYes: ScoffAnswer = { answer: "partial", followUp: true };
    const partialNo: ScoffAnswer = { answer: "partial", followUp: false };
    expect(scoffOutcome([NO, NO, partialYes, NO, NO]).scoff_yes_count).toBe(1);
    expect(scoffOutcome([NO, NO, partialNo, NO, NO]).scoff_yes_count).toBe(0);
  });

  it("señales de alarma: provocarse el vómito, pérdida de peso reciente o atracones", () => {
    expect(scoffOutcome([NO, NO, NO, NO, YES]).scoff_positive).toBe(true); // pérdida de peso
    expect(scoffOutcome([NO, NO, YES, NO, NO]).scoff_positive).toBe(false);
    // Pérdida de control: el atracón (la pregunta de seguimiento) es la señal de alarma
    expect(scoffOutcome([NO, { answer: "yes", followUp: true }, NO, NO, NO])).toEqual({
      scoff_yes_count: 1,
      scoff_positive: true,
    });
    expect(scoffOutcome([NO, { answer: "yes", followUp: false }, NO, NO, NO])).toEqual({
      scoff_yes_count: 1,
      scoff_positive: false,
    });
  });

  it("no aplica el punto de corte: eso lo hace el motor", () => {
    // 2 síes sin señal de alarma: scoff_positive sigue en false; el motor decide con el recuento
    expect(scoffOutcome([NO, NO, YES, YES, NO]).scoff_positive).toBe(false);
  });
});

describe("PAR-Q+ (spec §8.1)", () => {
  it("'no lo sé' deja el campo nulo", () => {
    expect(triToBool("yes")).toBe(true);
    expect(triToBool("no")).toBe(false);
    expect(triToBool("unsure")).toBeNull();
  });

  it("pregunta por la revisión con algún SÍ o con 45 años o más", () => {
    expect(askVigorousReview(true, null, 30)).toBe(true);
    expect(askVigorousReview(false, null, 30)).toBe(false);
    expect(askVigorousReview(false, false, 45)).toBe(true);
    expect(askVigorousReview(false, false, 44)).toBe(false);
    expect(askVigorousReview(null, null, 50)).toBe(true);
  });

  it("calcula la edad el día del cumpleaños", () => {
    expect(ageOn("1981-10-29", new Date(2026, 9, 29))).toBe(45);
    expect(ageOn("1981-10-30", new Date(2026, 9, 29))).toBe(44);
    expect(ageOn(null, new Date(2026, 9, 29))).toBeNull();
  });
});

describe("pasos", () => {
  it("el ciclo solo para mujeres y la tensión solo con hipertensión o lectura conocida", () => {
    expect(steps({ female: false, hypertension: false })).not.toContain("cycle");
    expect(steps({ female: true, hypertension: false })).toContain("cycle");
    expect(steps({ female: false, hypertension: true })).toContain("bp");
    expect(steps({ female: false, hypertension: false })).not.toContain("bp");
  });

  it("el SCOFF va antes de los datos básicos (antes de preguntar el peso)", () => {
    const s = steps({ female: true, hypertension: true });
    expect(s.indexOf("scoff")).toBeLessThan(s.indexOf("basics"));
    expect(s).toEqual([
      "welcome", "language", "scoff", "basics", "parq", "cardiac", "medical", "bp", "cycle", "goals", "done",
    ]);
  });

  const complete = {
    profile: { date_of_birth: "1990-01-01", height_cm: 175, region: "es", emergency_number: null },
    screening: { scoff_yes_count: 0, cardiac_symptoms: false },
  };

  it("reanuda en el primer paso obligatorio que falta", () => {
    expect(firstMissingStep(complete.profile, complete.screening)).toBeNull();
    expect(isOnboardingComplete(complete.profile, complete.screening)).toBe(true);
    expect(firstMissingStep({ ...complete.profile, region: null }, complete.screening)).toBe("language");
    expect(
      firstMissingStep({ ...complete.profile, region: null, emergency_number: "911" }, complete.screening),
    ).toBeNull();
    expect(firstMissingStep(complete.profile, { ...complete.screening, scoff_yes_count: null })).toBe("scoff");
    expect(firstMissingStep({ ...complete.profile, height_cm: null }, complete.screening)).toBe("basics");
    expect(firstMissingStep(complete.profile, { ...complete.screening, cardiac_symptoms: null })).toBe("cardiac");
  });

  it("el PAR-Q+ no bloquea: 'no lo sé' deja el onboarding completo", () => {
    expect(isOnboardingComplete(complete.profile, { ...complete.screening })).toBe(true);
  });
});
