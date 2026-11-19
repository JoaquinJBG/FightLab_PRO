import { describe, expect, test } from "vitest";
import {
  sanitizeDecimal,
  setIssue,
  platesFor,
  detectRecords,
  supersetGroups,
  nextInSuperset,
  nextSetType,
  type PriorRecords,
} from "./gym-log";
import { gymSets, savedExercises, sessionTotals, type ExerciseEntry } from "./gym";

describe("sanitizeDecimal (fallo F2)", () => {
  test("un solo separador decimal: coma o punto", () => {
    expect(sanitizeDecimal("9295,.")).toBe("9295,");
    expect(sanitizeDecimal("92.5,5")).toBe("92.55");
    expect(sanitizeDecimal("95,5")).toBe("95,5");
    expect(sanitizeDecimal("1.2.3")).toBe("1.23");
  });
  test("sin letras ni signos y como mucho dos decimales y cuatro cifras enteras", () => {
    expect(sanitizeDecimal("-8a0kg")).toBe("80");
    expect(sanitizeDecimal("80,125")).toBe("80,12");
    expect(sanitizeDecimal("123456")).toBe("1234");
    expect(sanitizeDecimal("")).toBe("");
  });
});

describe("setIssue: límites con aviso", () => {
  const set = (kg: string, reps: string, extra = {}) => ({ kg, reps, done: false, ...extra });
  test("valores normales: sin aviso", () => {
    expect(setIssue(set("92,5", "6"))).toBeNull();
    expect(setIssue(set("", "12"))).toBeNull();
  });
  test("imposibles: error que impide guardar la serie", () => {
    expect(setIssue(set("9295", "6"))).toEqual({ level: "error", code: "kgMax" });
    expect(setIssue(set("80", "1001"))).toEqual({ level: "error", code: "repsMax" });
    expect(setIssue(set("80", "6", { rpe: "11" }))).toEqual({ level: "error", code: "rpeRange" });
    expect(setIssue(set("80", "6", { rir: "12" }))).toEqual({ level: "error", code: "rirRange" });
  });
  test("poco habituales: aviso que deja guardar", () => {
    expect(setIssue(set("520", "3"))).toEqual({ level: "warn", code: "kgHigh" });
    expect(setIssue(set("40", "150"))).toEqual({ level: "warn", code: "repsHigh" });
  });
});

describe("lo que se guarda es lo que se enseña", () => {
  const xs: ExerciseEntry[] = [
    {
      name: "Sentadilla", key: "cat:barbell-squat", notes: "Cinturón", restS: 180, superset: null,
      sets: [
        { kg: "60", reps: "8", done: true, type: "warmup" },
        { kg: "92,5", reps: "6", done: true, rpe: "8,5" },
        { kg: "9295", reps: "65", done: true }, // imposible: no se guarda y se avisa
        { kg: "92.5", reps: "5", done: false },
      ],
    },
  ];
  test("las series imposibles no entran ni en el resumen ni en lo enviado", () => {
    const saved = savedExercises(xs);
    expect(saved[0].sets).toHaveLength(2);
    const totals = sessionTotals(saved);
    expect(totals).toEqual({ totalSets: 2, volume: 60 * 8 + 92.5 * 6 });
    const rows = gymSets(saved);
    expect(rows).toHaveLength(totals.totalSets);
    expect(rows[0]).toMatchObject({
      exercise: "Sentadilla", exercise_key: "cat:barbell-squat", set_type: "warmup", notes: "Cinturón", rest_s: 180,
    });
    expect(rows[1]).toMatchObject({ weight_kg: 92.5, reps: 6, rpe: 8.5 });
  });
});

describe("calculadora de discos", () => {
  test("100 kg con barra de 20: 40 por lado", () => {
    expect(platesFor(100, 20, [25, 20, 15, 10, 5, 2.5, 1.25])).toEqual({ perSide: [25, 15], remainder: 0 });
  });
  test("lo que no se puede cargar exacto queda como resto por lado", () => {
    expect(platesFor(101, 20, [25, 20, 10, 5, 2.5])).toEqual({ perSide: [25, 10, 5, 0], remainder: 0.5 }.perSide ? { perSide: [25, 10, 5], remainder: 0.5 } : null);
  });
  test("barra configurable y peso por debajo de la barra", () => {
    expect(platesFor(15, 15, [20, 10])).toEqual({ perSide: [], remainder: 0 });
    expect(platesFor(10, 20, [20, 10])).toBeNull();
  });
  test("discos repetidos cuando hacen falta", () => {
    expect(platesFor(180, 20, [20, 10, 5])).toEqual({ perSide: [20, 20, 20, 20], remainder: 0 });
  });
});

describe("récords durante el entreno", () => {
  const prior: PriorRecords = {
    max_weight_kg: 100,
    best_e1rm_kg: 110,
    best_set_volume_kg: 800,
    reps_by_weight: [{ weight_kg: 100, reps: 3 }, { weight_kg: 80, reps: 10 }],
    sessions: 4,
  };
  test("batir el peso máximo, el e1RM y las reps a un peso", () => {
    expect(detectRecords({ kg: 102.5, reps: 3, type: "normal" }, prior, [])).toEqual(["weight", "e1rm"]);
    // 80 × 11: e1RM 109,3 (< 110), volumen 880 (> 800) y 11 reps a 80 kg (> 10)
    expect(detectRecords({ kg: 80, reps: 11, type: "normal" }, prior, [])).toEqual(["volume", "reps"]);
  });
  test("los calentamientos y la primera vez no son récord", () => {
    expect(detectRecords({ kg: 120, reps: 5, type: "warmup" }, prior, [])).toEqual([]);
    expect(detectRecords({ kg: 120, reps: 5, type: "normal" }, null, [])).toEqual([]);
  });
  test("una serie de hoy ya batida sube el listón", () => {
    const today = [{ kg: 105, reps: 3, type: "normal" as const }];
    expect(detectRecords({ kg: 102.5, reps: 3, type: "normal" }, prior, today)).toEqual([]);
  });
});

describe("superseries", () => {
  const xs = [
    { name: "A", sets: [], superset: 1 },
    { name: "B", sets: [], superset: 1 },
    { name: "C", sets: [], superset: null },
    { name: "D", sets: [], superset: 2 },
    { name: "E", sets: [], superset: 2 },
  ] as ExerciseEntry[];
  test("grupos con letra por orden de aparición", () => {
    expect(supersetGroups(xs)).toEqual({ 1: "A", 2: "B" });
  });
  test("la pareja: del primero al segundo y del último vuelve al primero", () => {
    expect(nextInSuperset(xs, 0)).toEqual({ index: 1, last: false });
    expect(nextInSuperset(xs, 1)).toEqual({ index: 0, last: true });
    expect(nextInSuperset(xs, 2)).toBeNull();
  });
});

test("tipo de serie: normal → calentamiento → drop → al fallo", () => {
  expect(nextSetType(undefined)).toBe("warmup");
  expect(nextSetType("warmup")).toBe("drop");
  expect(nextSetType("drop")).toBe("failure");
  expect(nextSetType("failure")).toBe("normal");
});
