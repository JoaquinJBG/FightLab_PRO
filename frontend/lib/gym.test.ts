import { describe, test, expect, beforeEach } from "vitest";
import {
  exerciseStats,
  previousSet,
  formatSetPreview,
  savedExercises,
  sessionTotals,
  incompleteSets,
  buildActivityDetail,
  gymSessionFromServer,
  GYM_SESS_KEY,
  MAX_DETAIL_CHARS,
  type ExerciseEntry,
  type GymSession,
} from "./gym";

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

const set = (kg: string, reps: string, done: boolean) => ({ kg, reps, done });

describe("savedExercises / sessionTotals", () => {
  test("solo se guardan series ✓ con reps > 0", () => {
    const xs: ExerciseEntry[] = [
      { name: "Press banca", sets: [set("80", "8", true), set("85", "6", false), set("90", "", true), set("90", "0", true)] },
      { name: "Sentadilla", sets: [set("100", "5", false)] },
    ];
    const saved = savedExercises(xs);
    expect(saved).toEqual([{ name: "Press banca", sets: [{ kg: 80, reps: 8 }] }]);
    expect(sessionTotals(saved)).toEqual({ totalSets: 1, volume: 640 });
  });

  test("kg en blanco con ✓ = peso corporal: cuenta la serie, suma 0 de volumen", () => {
    const saved = savedExercises([{ name: "Fondos", sets: [set("", "12", true), set("10", "5", true)] }]);
    expect(saved[0].sets).toEqual([{ kg: 0, reps: 12 }, { kg: 10, reps: 5 }]);
    expect(sessionTotals(saved)).toEqual({ totalSets: 2, volume: 50 });
  });

  test("acepta coma decimal", () => {
    expect(savedExercises([{ name: "Curl", sets: [set("22,5", "10", true)] }])[0].sets[0].kg).toBe(22.5);
  });
});

describe("incompleteSets", () => {
  test("cuenta marcadas sin reps y con datos sin marcar", () => {
    const xs: ExerciseEntry[] = [
      { name: "A", sets: [set("", "", true), set("50", "", false), set("", "", false), set("60", "5", false), set("60", "5", true)] },
    ];
    expect(incompleteSets(xs)).toEqual({ tickedEmpty: 1, unticked: 2 });
  });

  test("todo limpio: ceros", () => {
    expect(incompleteSets([{ name: "A", sets: [set("60", "5", true), set("", "", false)] }])).toEqual({ tickedEmpty: 0, unticked: 0 });
  });
});

describe("buildActivityDetail", () => {
  const big = (nEx: number, nSets: number): GymSession["exercises"] =>
    Array.from({ length: nEx }, (_, i) => ({
      name: `Ejercicio personalizado con un nombre bastante largo para la prueba ${i + 1}`,
      sets: Array.from({ length: nSets }, (_, j) => ({ kg: 102.5 + j, reps: 12 + j })),
    }));

  test("sesión normal: desglose completo", () => {
    const saved = big(2, 3);
    const { detail, breakdown } = buildActivityDetail("Pierna", 1000, saved);
    expect(breakdown).toBe(true);
    expect(detail.exercises).toEqual(saved);
  });

  test("30 ejercicios × 8 series: compacta, cabe en 8 KB y conserva todas las series", () => {
    const saved = big(30, 8);
    expect(JSON.stringify({ focus: null, volume_kg: 1, exercises: saved }).length).toBeGreaterThan(MAX_DETAIL_CHARS);
    const { detail, breakdown } = buildActivityDetail(null, 123456, saved);
    expect(breakdown).toBe(true);
    expect(JSON.stringify(detail).length).toBeLessThanOrEqual(MAX_DETAIL_CHARS);
    const back = gymSessionFromServer({
      client_id: "c1", started_at: "2026-01-01T10:00:00Z", duration_sec: 3600, rpe: 7, detail,
    } as Parameters<typeof gymSessionFromServer>[0]);
    expect(back.exercises).toEqual(saved);
    expect(back.volume).toBe(123456);
  });

  test("si ni compactado cabe: sin desglose y breakdown=false (el llamante avisa)", () => {
    const { detail, breakdown } = buildActivityDetail("X", 5, big(30, 8), 500);
    expect(breakdown).toBe(false);
    expect(detail).toEqual({ focus: "X", volume_kg: 5 });
  });
});
