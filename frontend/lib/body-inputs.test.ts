import { describe, test, expect } from "vitest";
import { ageFromDob, latestWeightKg, nutriGoalFromOnboarding, nutritionInputs } from "./body-inputs";

const NOW = new Date("2026-06-15T12:00:00");

describe("latestWeightKg", () => {
  test("sin registros o sin peso no inventa un valor", () => {
    expect(latestWeightKg([])).toBeNull();
    expect(latestWeightKg([{ weight_kg: null }])).toBeNull();
  });
  test("toma el primer peso válido (lista más reciente primero)", () => {
    expect(latestWeightKg([{ weight_kg: null }, { weight_kg: "81.5" }, { weight_kg: "90" }])).toBe(81.5);
  });
});

describe("ageFromDob", () => {
  test("null cuando falta o es inválida", () => {
    expect(ageFromDob(null, NOW)).toBeNull();
    expect(ageFromDob("nope", NOW)).toBeNull();
  });
  test("calcula la edad antes y después del cumpleaños", () => {
    expect(ageFromDob("1996-06-16", NOW)).toBe(29);
    expect(ageFromDob("1996-06-15", NOW)).toBe(30);
  });
});

describe("nutritionInputs", () => {
  test("sin peso, altura ni edad: sin cálculo y lista lo que falta", () => {
    const r = nutritionInputs([], { height_cm: null, date_of_birth: null }, NOW);
    expect(r.inputs).toBeNull();
    expect(r.missing).toEqual(["peso", "altura", "edad"]);
  });
  test("sin peso solo pide el peso", () => {
    const r = nutritionInputs([], { height_cm: 180, date_of_birth: "1996-01-01" }, NOW);
    expect(r.inputs).toBeNull();
    expect(r.missing).toEqual(["peso"]);
  });
  test("con todo, devuelve los datos reales", () => {
    const r = nutritionInputs([{ weight_kg: "80.0" }], { height_cm: 180, date_of_birth: "1996-01-01" }, NOW);
    expect(r.inputs).toEqual({ weight: 80, height: 180, age: 30 });
    expect(r.missing).toEqual([]);
  });
});

describe("nutriGoalFromOnboarding", () => {
  test("mapea el objetivo del onboarding", () => {
    expect(nutriGoalFromOnboarding("lose")).toBe("perder");
    expect(nutriGoalFromOnboarding("muscle")).toBe("ganar");
    expect(nutriGoalFromOnboarding("fit")).toBe("mantener");
    expect(nutriGoalFromOnboarding("")).toBeNull();
  });
});
