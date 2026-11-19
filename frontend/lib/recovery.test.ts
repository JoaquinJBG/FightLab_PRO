import { describe, test, expect } from "vitest";
import { computeRecovery } from "./recovery";
import type { Biometrics } from "./schemas";

// Un registro de biometría con solo las señales que usa computeRecovery
// (FC en reposo y HRV); el resto de campos van a null.
function bio(rhr: number | null, hrv: number | null): Biometrics {
  return {
    id: 0,
    weight_kg: null,
    body_fat_pct: null,
    resting_heart_rate: rhr,
    sleep_quality_score: null,
    hrv_ms: hrv,
    waist_cm: null,
    hip_cm: null,
    chest_cm: null,
    arm_cm: null,
    thigh_cm: null,
    neck_cm: null,
    timestamp: "2026-01-01T00:00:00Z",
    source: "manual",
  };
}

describe("computeRecovery", () => {
  test("devuelve null si no hay ninguna señal", () => {
    expect(computeRecovery([])).toBeNull();
  });

  test("devuelve null con menos de 4 registros de una señal", () => {
    // 3 registros de FC no bastan (requiere >= 4 para tener media de referencia)
    const logs = [bio(60, null), bio(60, null), bio(60, null)];
    expect(computeRecovery(logs)).toBeNull();
  });

  test("'cuidado' cuando la FC en reposo sube >= 5 sobre tu media", () => {
    // logs van del más reciente al más antiguo; el actual (65) vs media de 60
    const logs = [bio(65, null), bio(60, null), bio(60, null), bio(60, null)];
    const r = computeRecovery(logs);
    expect(r?.state).toBe("cuidado");
  });

  test("'listo' cuando FC baja y HRV sube sobre tu media", () => {
    const logs = [
      bio(58, 70),
      bio(60, 60),
      bio(60, 60),
      bio(60, 60),
    ];
    const r = computeRecovery(logs);
    expect(r?.state).toBe("listo");
  });

  test("'cuidado' manda: una señal mala basta aunque otra sea buena", () => {
    // FC sube +5 (mala) pero HRV sube (buena) -> gana 'cuidado'
    const logs = [
      bio(65, 70),
      bio(60, 60),
      bio(60, 60),
      bio(60, 60),
    ];
    const r = computeRecovery(logs);
    expect(r?.state).toBe("cuidado");
  });

  test("'normal' cuando la señal está en torno a tu media (ni buena ni mala)", () => {
    // FC +2 sobre media: ni <= 0 (buena) ni >= 5 (mala)
    const logs = [bio(62, null), bio(60, null), bio(60, null), bio(60, null)];
    const r = computeRecovery(logs);
    expect(r?.state).toBe("normal");
  });
});
