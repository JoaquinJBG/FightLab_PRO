import { describe, test, expect } from "vitest";
import { credentials, biometrics } from "./schemas";

describe("credentials", () => {
  test("acepta email válido y contraseña de 8+ caracteres", () => {
    const r = credentials.safeParse({ email: "atleta@flp.com", password: "12345678" });
    expect(r.success).toBe(true);
  });

  test("rechaza email mal formado", () => {
    const r = credentials.safeParse({ email: "no-es-email", password: "12345678" });
    expect(r.success).toBe(false);
  });

  test("rechaza contraseña de menos de 8 caracteres", () => {
    const r = credentials.safeParse({ email: "atleta@flp.com", password: "1234567" });
    expect(r.success).toBe(false);
  });
});

describe("biometrics", () => {
  const valido = {
    id: 1,
    weight_kg: "80.5",
    body_fat_pct: null,
    resting_heart_rate: 58,
    sleep_quality_score: null,
    hrv_ms: 65,
    waist_cm: null,
    hip_cm: null,
    chest_cm: null,
    arm_cm: null,
    thigh_cm: null,
    neck_cm: null,
    timestamp: "2026-07-02T08:00:00Z",
    source: "manual",
  };

  test("acepta un registro completo válido", () => {
    expect(biometrics.safeParse(valido).success).toBe(true);
  });

  test("el peso debe ser string|null, no número (viene serializado del backend)", () => {
    const r = biometrics.safeParse({ ...valido, weight_kg: 80.5 });
    expect(r.success).toBe(false);
  });
});
