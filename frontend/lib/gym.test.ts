import { describe, test, expect, beforeEach } from "vitest";
import { exerciseStats, GYM_SESS_KEY, type GymSession } from "./gym";

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
