import { describe, expect, it } from "vitest";
import { gymSets } from "@/lib/gym";

// Task 6.1: las series van aparte de `detail` (que se corta en 8 KB) para guardarse en `SetLog`.
describe("gymSets", () => {
  it("convierte ejercicios en series con su índice; 0 kg es el peso corporal", () => {
    expect(
      gymSets([
        { name: "Press banca", sets: [{ kg: 60, reps: 10 }, { kg: 62.5, reps: 8 }] },
        { name: "Dominadas", sets: [{ kg: 0, reps: 8 }] },
      ]),
    ).toEqual([
      { exercise: "Press banca", exercise_index: 0, set_index: 0, weight_kg: 60, reps: 10 },
      { exercise: "Press banca", exercise_index: 0, set_index: 1, weight_kg: 62.5, reps: 8 },
      { exercise: "Dominadas", exercise_index: 1, set_index: 0, weight_kg: null, reps: 8 },
    ]);
  });

  it("descarta lo que no se puede leer sin adivinar", () => {
    expect(
      gymSets([
        { name: "Sentadilla", sets: [{ kg: Number.NaN, reps: 5 }, { kg: 100, reps: 0 }, { kg: 100, reps: 2.5 }, { kg: 100, reps: 5 }] },
        { name: "", sets: [{ kg: 1, reps: 1 }] },
        null,
      ]),
    ).toEqual([{ exercise: "Sentadilla", exercise_index: 0, set_index: 3, weight_kg: 100, reps: 5 }]);
  });
});
