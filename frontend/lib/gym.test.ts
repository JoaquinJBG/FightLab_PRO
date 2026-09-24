import { describe, test, expect, beforeEach } from "vitest";
import { exerciseStats, previousSet, formatSetPreview, GYM_SESS_KEY, type GymSession } from "./gym";

function seed(sessions: GymSession[]) {
  localStorage.setItem(GYM_SESS_KEY, JSON.stringify(sessions));
}

function session(exercises: GymSession["exercises"]): GymSession {
  return {
    id: "s1",
    ts: Date.now(),
    focus: null,
    durationSec: 0,
    rpe: null,
    load: null,
    volume: 0,
    exercises,
  };
}

describe("exerciseStats", () => {
  beforeEach(() => localStorage.clear());

  test("ejercicio nunca registrado: sin datos", () => {
    expect(exerciseStats("Press banca")).toEqual({ last: null, prKg: null });
  });

  test("PR = kg máximo y 'última vez' con la serie más pesada", () => {
    seed([
      session([{ name: "Press banca", sets: [{ kg: 80, reps: 5 }, { kg: 100, reps: 3 }] }]),
    ]);
    expect(exerciseStats("Press banca")).toEqual({ last: "2×3 · 100 kg", prKg: 100 });
  });

  test("el peso corporal (0 kg) no cuenta como PR", () => {
    seed([session([{ name: "Dominadas", sets: [{ kg: 0, reps: 10 }] }])]);
    expect(exerciseStats("Dominadas")).toEqual({ last: "1×10", prKg: null });
  });

  test("PR es el máximo histórico entre varias sesiones", () => {
    seed([
      session([{ name: "Sentadilla", sets: [{ kg: 120, reps: 2 }] }]), // más reciente
      session([{ name: "Sentadilla", sets: [{ kg: 140, reps: 1 }] }]), // más antigua, pero PR
    ]);
    const r = exerciseStats("Sentadilla");
    expect(r.prKg).toBe(140);
    expect(r.last).toBe("1×2 · 120 kg"); // 'última vez' = la primera del array (más reciente)
  });
});

describe("previousSet", () => {
  beforeEach(() => localStorage.clear());

  test("sin historial: no hay serie previa", () => {
    expect(previousSet("Press banca", 0, [])).toBeNull();
  });

  test("ejercicio no registrado en ninguna sesión: null", () => {
    seed([session([{ name: "Sentadilla", sets: [{ kg: 100, reps: 5 }] }])]);
    expect(previousSet("Press banca", 0, [session([{ name: "Sentadilla", sets: [{ kg: 100, reps: 5 }] }])])).toBeNull();
  });

  test("misma posición de serie en la sesión más reciente que tiene el ejercicio", () => {
    const sessions = [
      session([{ name: "Press banca", sets: [{ kg: 80, reps: 8 }, { kg: 85, reps: 6 }] }]), // más reciente
      session([{ name: "Press banca", sets: [{ kg: 70, reps: 10 }] }]), // más antigua
    ];
    expect(previousSet("Press banca", 1, sessions)).toEqual({ kg: 85, reps: 6 });
  });

  test("si la sesión previa tuvo menos series, cae en la última registrada", () => {
    const sessions = [session([{ name: "Press banca", sets: [{ kg: 80, reps: 8 }] }])];
    expect(previousSet("Press banca", 3, sessions)).toEqual({ kg: 80, reps: 8 });
  });

  test("salta sesiones donde el ejercicio no tiene series (aunque exista la entrada)", () => {
    const sessions = [
      session([{ name: "Press banca", sets: [] }]),
      session([{ name: "Press banca", sets: [{ kg: 90, reps: 5 }] }]),
    ];
    expect(previousSet("Press banca", 0, sessions)).toEqual({ kg: 90, reps: 5 });
  });
});

describe("formatSetPreview", () => {
  test("null sin serie previa", () => {
    expect(formatSetPreview(null)).toBeNull();
  });

  test("con peso: 'kg × reps'", () => {
    expect(formatSetPreview({ kg: 80, reps: 8 })).toBe("80 kg × 8");
  });

  test("peso corporal (0 kg): solo reps", () => {
    expect(formatSetPreview({ kg: 0, reps: 12 })).toBe("12 reps");
  });
});
