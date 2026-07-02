import { describe, test, expect } from "vitest";
import { scale, targets } from "./nutrition";

describe("scale", () => {
  test("escala los macros por gramos (valores por 100 g)", () => {
    // Pechuga de pollo por 100 g -> 200 g duplica y redondea
    const r = scale({ kcal: 165, p: 31, c: 0, f: 3.6 }, 200);
    expect(r).toEqual({ kcal: 330, p: 62, c: 0, f: 7 }); // 3.6*2 = 7.2 -> 7
  });

  test("con menos de 100 g escala hacia abajo y redondea", () => {
    const r = scale({ kcal: 100, p: 10, c: 20, f: 5 }, 50);
    expect(r).toEqual({ kcal: 50, p: 5, c: 10, f: 3 }); // 5*0.5 = 2.5 -> 3
  });
});

describe("targets", () => {
  test("calcula kcal y macros (hombre, mantener) con Mifflin-St Jeor × 1.55", () => {
    const r = targets(80, 180, 30, "MALE", "mantener");
    // BMR = 1780, TDEE = 2759
    expect(r.kcal).toBe(2759);
    expect(r.p).toBe(160); // 2 g/kg
    expect(r.f).toBe(77); // 25% de kcal / 9
    expect(r.c).toBe(357); // resto de kcal / 4
  });

  test("mujer usa el término -161 del BMR y 'perder' resta 500 kcal", () => {
    const r = targets(60, 165, 28, "FEMALE", "perder");
    expect(r.kcal).toBe(1562);
    expect(r.p).toBe(120);
  });

  test("'ganar' > 'mantener' > 'perder' con los mismos datos", () => {
    const base = [80, 180, 30, "MALE"] as const;
    const ganar = targets(...base, "ganar").kcal;
    const mantener = targets(...base, "mantener").kcal;
    const perder = targets(...base, "perder").kcal;
    expect(ganar).toBeGreaterThan(mantener);
    expect(mantener).toBeGreaterThan(perder);
  });
});
