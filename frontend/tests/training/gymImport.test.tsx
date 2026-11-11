import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expectClean, renderEn } from "./i18nB-helpers";
import GymImportPage from "@/app/(shell)/training/gym/import/page";
import { ImportError, importResult, type ImportResult } from "@/lib/gym-import";

// Fase 9: importar CSV de Hevy o genérico. El servidor lee el archivo con el coach, deduplica y
// guarda; aquí se sube y se pinta el resumen (importadas, duplicadas, avisos) o el error traducido.

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  error: null as unknown,
  isPending: false,
  result: null as unknown,
}));

vi.mock("@/lib/gym-import", async (orig) => {
  const real = await orig<typeof import("@/lib/gym-import")>();
  return {
    ...real,
    useImportSets: () => ({
      mutate: (vars: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
        state.mutate(vars);
        if (state.result) opts?.onSuccess?.(state.result);
      },
      reset: state.reset,
      error: state.error,
      isPending: state.isPending,
      variables: undefined,
    }),
  };
});
vi.mock("@/lib/hooks", () => ({ useEngine: () => ({ data: undefined }) }));

beforeEach(() => { state.mutate.mockClear(); state.error = null; state.result = null; state.isPending = false; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const result = (over: Partial<ImportResult> = {}): ImportResult => importResult.parse({
  importer: "hevy_csv", dry_run: true,
  sessions: { new: 2, updated: 1, total: 3 },
  sets: { imported: 14, duplicates: 6, in_file: 21 },
  range: { first: "2026-09-03", last: "2026-09-08" },
  warnings: [{ code: "template_rows", count: 1 }],
  ...over,
});

const csv = () => new File(["date,exercise,reps\n2026-09-10,Squat,5\n"], "export.csv", { type: "text/csv" });

describe("Importar entrenos (en)", () => {
  it("formatos, ayuda de cada uno y Lyfta pendiente", () => {
    const { container } = renderEn(<GymImportPage />);
    expect(screen.getByText("Import workouts")).toBeTruthy();
    for (const f of ["Detect", "Hevy", "Generic CSV"]) expect(screen.getByRole("button", { name: f })).toBeTruthy();
    expect(screen.getByText(/Hevy: Settings › Export Data/)).toBeTruthy();
    expect(screen.getByText(/Generic CSV: columns date/)).toBeTruthy();
    expect(screen.getByText(/Lyfta: there is no importer yet/)).toBeTruthy();
    expect(screen.getByText("CSV file (max 5 MB)")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check file" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/do not add to your load/)).toBeTruthy();
    expectClean(container);
  });

  it("revisar el archivo enseña lo que se importaría, con duplicadas y filas de plantilla", () => {
    state.result = result();
    const { container } = renderEn(<GymImportPage />);
    fireEvent.click(screen.getByRole("button", { name: "Generic CSV" }));
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [csv()] } });
    expect(screen.getByText("Chosen: export.csv")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check file" }));
    expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ importer: "generic_csv", dryRun: true }));
    expect(screen.getByText("This is what would be imported")).toBeTruthy();
    expect(screen.getByText("Read as Hevy")).toBeTruthy();
    expect(screen.getByTestId("import-sets").textContent).toBe("14 new sets");
    expect(screen.getByText("2 new sessions · 1 session extended")).toBeTruthy();
    expect(screen.getByTestId("import-duplicates").textContent).toBe("6 were already there and are not duplicated");
    expect(screen.getByTestId("import-warning").textContent).toBe("1 empty template row (sets never filled in): not imported.");
    expectClean(container);
  });

  it("Hevy: las rutinas que salen de los títulos de los entrenos (F17)", () => {
    state.result = result({ dry_run: false, routines: { new: 2, existing: 1, unavailable: 0 } });
    const { container } = renderEn(<GymImportPage />);
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [csv()] } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(screen.getByTestId("import-routines").textContent).toBe("2 new routines, one per workout title · 1 already there · See routines");
    expect(screen.getByRole("link", { name: "See routines" }).getAttribute("href")).toBe("/training/routines");
    expectClean(container);
  });

  it("reimportar el mismo archivo: nada nuevo", () => {
    state.result = result({ dry_run: false, sessions: { new: 0, updated: 0, total: 3 }, sets: { imported: 0, duplicates: 20, in_file: 21 }, range: null, warnings: [] });
    const { container } = renderEn(<GymImportPage />);
    fireEvent.change(screen.getByTestId("import-file"), { target: { files: [csv()] } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ importer: "auto", dryRun: false }));
    expect(screen.getByText("Imported")).toBeTruthy();
    expect(screen.getByTestId("import-nothing-new")).toBeTruthy();
    expect(screen.getByTestId("import-duplicates").textContent).toMatch(/^20 were already there/);
    expectClean(container);
  });

  it.each([
    [new ImportError("decimal_comma", { line: 4 }), "Line 4 has more fields than the header. A decimal comma (12,5)? Use a full stop (12.5)."],
    [new ImportError("missing_columns", { columns: "exercise_title, set_index" }), "Missing columns: exercise_title, set_index."],
    [new ImportError("bad_date", { line: 3, value: "10/09/2026" }), "A date could not be read (10/09/2026). Use YYYY-MM-DD."],
    [new ImportError("too_large", { mb: 5 }), "The file is larger than 5 MB."],
    [new Error("boom"), "The upload failed. Try again."],
  ])("error traducido: %s", (error, text) => {
    state.error = error;
    const { container } = renderEn(<GymImportPage />);
    expect(screen.getByRole("alert").textContent).toBe(text);
    expectClean(container, ["12,5"]);
  });
});

describe("useImportSets", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
  );

  it("sube el archivo como multipart y convierte el 400 en un ImportError con su código", async () => {
    const { useImportSets: realHook } = await vi.importActual<typeof import("@/lib/gym-import")>("@/lib/gym-import");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: "missing_columns", params: { columns: "date" }, detail: "x" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result: hook } = renderHook(() => realHook(), { wrapper });
    hook.current.mutate({ file: csv(), importer: "hevy_csv", dryRun: true });
    await waitFor(() => expect(hook.current.error).toBeTruthy());
    expect(hook.current.error).toBeInstanceOf(ImportError);
    expect((hook.current.error as ImportError).code).toBe("missing_columns");
    expect((hook.current.error as ImportError).params).toEqual({ columns: "date" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/proxy/coach/import");
    const form = init.body as FormData;
    expect(form.get("importer")).toBe("hevy_csv");
    expect(form.get("dry_run")).toBe("1");
    expect((form.get("file") as File).name).toBe("export.csv");
  });

  it("un archivo de más de 5 MB no se sube", async () => {
    const { useImportSets: realHook } = await vi.importActual<typeof import("@/lib/gym-import")>("@/lib/gym-import");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.csv");
    const { result: hook } = renderHook(() => realHook(), { wrapper });
    hook.current.mutate({ file: big, importer: "auto", dryRun: false });
    await waitFor(() => expect((hook.current.error as ImportError | null)?.code).toBe("too_large"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
