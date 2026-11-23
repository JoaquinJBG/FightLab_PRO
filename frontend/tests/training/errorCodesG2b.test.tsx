import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import es from "@/messages/es.json";
import en from "@/messages/en.json";
import { ImportError, useImportSets } from "@/lib/gym-import";
import { CatalogueError, useImportCatalogue } from "@/lib/chain-catalogue";
import { createCustomExercise, ExerciseApiError } from "@/lib/exercises";

// Códigos de error nuevos del backend (G1): cada uno llega al frontend con su código (no como
// «server»/«invalid» genérico) y tiene texto en es y en.

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
);
const csv = () => new File(["a,b\n1,2"], "x.csv", { type: "text/csv" });
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("importación del gimnasio", () => {
  it.each(["too_many_exercises", "too_many_custom_exercises"])("%s llega con su código", async (code) => {
    vi.stubGlobal("fetch", reply(400, { code, params: { max: 300 } }));
    const { result } = renderHook(() => useImportSets(), { wrapper });
    result.current.mutate({ file: csv(), importer: "hevy_csv", dryRun: false });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toBeInstanceOf(ImportError);
    expect((result.current.error as ImportError).code).toBe(code);
  });
});

describe("importación del catálogo de la cadena", () => {
  it("bad_csv llega con su código", async () => {
    vi.stubGlobal("fetch", reply(400, { code: "bad_csv", params: { detail: "x" } }));
    const { result } = renderHook(() => useImportCatalogue(), { wrapper });
    result.current.mutate({ file: csv(), dryRun: true, chain: "X" });
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error).toBeInstanceOf(CatalogueError);
    expect((result.current.error as CatalogueError).code).toBe("bad_csv");
  });
});

describe("ejercicio propio", () => {
  it("too_many_custom_exercises se reconoce por su código", async () => {
    vi.stubGlobal("fetch", reply(400, { code: "too_many_custom_exercises", detail: "Ya tienes 1000" }));
    const err = await createCustomExercise({ name: "x", primary_muscles: [], secondary_muscles: [], equipment: [], notes: "" }).catch((e) => e);
    expect(err).toBeInstanceOf(ExerciseApiError);
    expect((err as ExerciseApiError).code).toBe("too_many_custom_exercises");
  });
});

describe("textos es/en", () => {
  const get = (m: unknown, path: string) => path.split(".").reduce((o, k) => (o as Record<string, unknown>)?.[k], m) as string | undefined;
  it.each([
    ["gymImport.errors.too_many_exercises", "300"],
    ["gymImport.errors.too_many_custom_exercises", "1000"],
    ["exercises.form.tooManyCustom", "1000"],
    ["chainCatalogue.errors.bad_csv", "CSV"],
    ["reminders.device.endpointTaken", ""],
  ])("%s existe en es y en", (path, needle) => {
    for (const m of [es, en]) {
      const text = get(m, path);
      expect(text, path).toBeTruthy();
      expect(text).toContain(needle);
    }
    expect(get(es, path)).not.toBe(get(en, path));
  });
});
