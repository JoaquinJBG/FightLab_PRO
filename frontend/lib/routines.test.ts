import { describe, expect, it } from "vitest";
import {
  applyOrder,
  linkWithNext,
  move,
  newSet,
  normaliseSupersets,
  parseNumber,
  repsLabel,
  START_PATH,
  toDraft,
  unlink,
  type Routine,
  type RoutineSummary,
} from "./routines";

const ex = (name: string, superset: number | null = null) => ({ name, superset });

describe("move", () => {
  it("mueve un elemento a otra posición sin tocar la lista original", () => {
    const list = ["a", "b", "c", "d"];
    expect(move(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(move(list, 3, 0)).toEqual(["d", "a", "b", "c"]);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });
  it("ignora posiciones fuera de rango", () => {
    expect(move(["a", "b"], 0, 5)).toEqual(["a", "b"]);
    expect(move(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  });
});

describe("superseries", () => {
  it("normaliza: grupos 0, 1… en orden y sin grupos de uno", () => {
    const out = normaliseSupersets([ex("a", 7), ex("b", 7), ex("c", 3), ex("d", 9), ex("e", 9)]);
    expect(out.map((e) => e.superset)).toEqual([0, 0, null, 1, 1]);
  });
  it("une con el siguiente y amplía un grupo existente", () => {
    let list = [ex("a"), ex("b"), ex("c"), ex("d")];
    list = linkWithNext(list, 0);
    expect(list.map((e) => e.superset)).toEqual([0, 0, null, null]);
    list = linkWithNext(list, 1); // b ya está en el 0: c se une a ese grupo (triserie)
    expect(list.map((e) => e.superset)).toEqual([0, 0, 0, null]);
    expect(linkWithNext(list, 3)).toBe(list); // el último no tiene siguiente
  });
  it("separar deja al resto juntos si quedan dos o más", () => {
    const list = [ex("a", 0), ex("b", 0), ex("c", 0), ex("d")];
    expect(unlink(list, 0).map((e) => e.superset)).toEqual([null, 0, 0, null]);
    expect(unlink([ex("a", 0), ex("b", 0)], 1).map((e) => e.superset)).toEqual([null, null]);
  });
});

describe("parseNumber", () => {
  it("acepta coma o punto, un solo separador", () => {
    expect(parseNumber("62,5")).toBe(62.5);
    expect(parseNumber("62.5")).toBe(62.5);
    expect(parseNumber(" 80 ")).toBe(80);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("6,2,5")).toBeUndefined();
    expect(parseNumber("6.2.5")).toBeUndefined();
    expect(parseNumber("-3")).toBeUndefined();
    expect(parseNumber("abc")).toBeUndefined();
  });
});

describe("series", () => {
  it("una serie nueva es normal y vacía; copiando, igual que la anterior", () => {
    expect(newSet()).toEqual({ set_type: "normal", reps: null, reps_max: null, weight_kg: null, rpe: null, rir: null });
    const prev = { set_type: "drop" as const, reps: 8, reps_max: 10, weight_kg: 50, rpe: null, rir: 1 };
    expect(newSet(prev)).toEqual(prev);
    expect(newSet(prev)).not.toBe(prev);
  });
  it("etiqueta del rango", () => {
    expect(repsLabel({ reps: 8, reps_max: 12 })).toBe("8-12");
    expect(repsLabel({ reps: 5, reps_max: null })).toBe("5");
    expect(repsLabel({ reps: 5, reps_max: 5 })).toBe("5");
    expect(repsLabel({ reps: null, reps_max: null })).toBe("—");
  });
});

describe("applyOrder", () => {
  const r = (id: number, folder: number | null, order: number): RoutineSummary => ({
    id, folder, order, title: `R${id}`, notes: "", source: "user", source_ref: "", exercise_count: 0, set_count: 0,
    exercise_names: [], exercise_keys: [], updated_at: "",
  });
  it("reordena solo la carpeta indicada", () => {
    const list = [r(1, null, 0), r(2, null, 1), r(3, 5, 0), r(4, 5, 1)];
    const out = applyOrder(list, 5, [4, 3]);
    expect(out.filter((x) => x.folder === 5).map((x) => x.id)).toEqual([4, 3]);
    expect(out.filter((x) => x.folder === null).map((x) => x.id)).toEqual([1, 2]);
  });
});

describe("toDraft y START_PATH", () => {
  it("quita ids y orden y lleva al registro con ?routine=", () => {
    const routine: Routine = {
      id: 3, title: "A", notes: "n", folder: null, order: 0, source: "user", source_ref: "", created_at: "", updated_at: "",
      exercises: [{ id: 9, order: 0, exercise_key: "cat:dips", name: "Fondos", superset: null, notes: "", rest_s: 90, sets: [] }],
    };
    expect(toDraft(routine).exercises[0]).toEqual({
      exercise_key: "cat:dips", name: "Fondos", superset: null, notes: "", rest_s: 90, sets: [],
    });
    expect(START_PATH(3)).toBe("/training/gym/session?routine=3");
  });
});
