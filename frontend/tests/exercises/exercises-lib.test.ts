import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RECENT_KEY,
  RECENT_MAX,
  createCustomExercise,
  exerciseApiPath,
  exerciseHref,
  fetchExercise,
  fetchExercises,
  filterExercises,
  forgetRecentKey,
  loadRecentKeys,
  normalize,
  pushRecentKeys,
  ExerciseApiError,
} from "@/lib/exercises";
import { BENCH, CRUNCH, LIST, MINE, PULLDOWN, PUSHDOWN } from "./fixtures";

const keys = (l: { key: string }[]) => l.map((e) => e.key);

describe("claves y rutas", () => {
  it("la ficha va sin «:» por el proxy", () => {
    expect(exerciseApiPath("cat:barbell-bench-press")).toBe("gym/exercises/cat/barbell-bench-press");
    expect(exerciseApiPath("custom:12")).toBe("gym/exercises/custom/12");
    expect(exerciseApiPath("Press banca")).toBeNull();
    expect(exerciseApiPath("cat:../admin")).toBeNull();
    expect(exerciseHref("cat:deadlift")).toBe("/training/exercises/cat/deadlift");
    expect(exerciseHref("custom:3")).toBe("/training/exercises/custom/3");
  });
});

describe("búsqueda en el navegador (la misma que la del servidor)", () => {
  it("normaliza mayúsculas, acentos y puntuación", () => {
    expect(normalize("  Jalón AL pecho (Cable) ")).toBe("jalon al pecho cable");
  });

  it("el nombre va antes que los alias", () => {
    expect(keys(filterExercises(LIST, { q: "jalon" }))).toEqual([PULLDOWN.key, PUSHDOWN.key]);
  });

  it("busca en los alias de los dos idiomas y en los de Hevy", () => {
    expect(keys(filterExercises(LIST, { q: "bench press (barbell)" }))).toEqual([BENCH.key]);
    expect(keys(filterExercises(LIST, { q: "meadows" }))).toEqual([MINE.key]);
  });

  it("filtra por músculo (principal primero) y por material", () => {
    expect(keys(filterExercises(LIST, { muscle: "triceps" }))).toEqual([PUSHDOWN.key, BENCH.key]);
    expect(keys(filterExercises(LIST, { equipment: "cable", muscle: "abs" }))).toEqual([CRUNCH.key]);
  });

  it("sin búsqueda, orden alfabético", () => {
    const names = filterExercises(LIST, {}).map((e) => normalize(e.name));
    expect(names).toEqual([...names].sort());
  });
});

describe("recientes", () => {
  beforeEach(() => localStorage.clear());

  it("el último elegido va primero, sin repetidos y con tope", () => {
    pushRecentKeys(["a", "b"]);
    pushRecentKeys(["a"]);
    expect(loadRecentKeys()).toEqual(["a", "b"]);
    pushRecentKeys(Array.from({ length: 20 }, (_, i) => `k${i}`));
    expect(loadRecentKeys()).toHaveLength(RECENT_MAX);
    expect(loadRecentKeys()[0]).toBe("k19");
  });

  it("aguanta basura en el almacenamiento y olvida los borrados", () => {
    localStorage.setItem(RECENT_KEY, "{no json");
    expect(loadRecentKeys()).toEqual([]);
    pushRecentKeys(["x", "y"]);
    forgetRecentKey("x");
    expect(loadRecentKeys()).toEqual(["y"]);
  });
});

describe("API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pide la lista con los filtros y la valida", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => LIST }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const out = await fetchExercises({ q: "press", lang: "es", muscle: "" });
    expect(out).toHaveLength(LIST.length);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("/api/proxy/gym/exercises?q=press&lang=es");
  });

  it("la ficha que no existe es null", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) }) as unknown as Response));
    expect(await fetchExercise("cat:nope")).toBeNull();
  });

  it("crear devuelve los errores por campo", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ name: ["Pon un nombre"] }) }) as unknown as Response),
    );
    const err = await createCustomExercise({ name: "", primary_muscles: [], secondary_muscles: [], equipment: [], notes: "" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(ExerciseApiError);
    expect(err.fields).toEqual({ name: ["Pon un nombre"] });
  });
});
