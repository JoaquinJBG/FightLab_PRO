import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expectClean, renderEn } from "../training/i18nB-helpers";
import HistoryImportPage from "@/app/(shell)/profile/import/page";
import { HistoryImportError, checkFiles, historyResult, type HistoryResult } from "@/lib/history-import";

// Fase 10: importar el historial de ParteDiario y del coach. El servidor reconoce los archivos,
// valida y compara con lo que ya hay; aquí se revisa primero (dry_run), se elige qué hacer con
// los días en conflicto y se importa. Los datos son inventados.

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  reset: vi.fn(),
  error: null as unknown,
  isPending: false,
  results: [] as unknown[],
}));

vi.mock("@/lib/history-import", async (orig) => {
  const real = await orig<typeof import("@/lib/history-import")>();
  return {
    ...real,
    useImportHistory: () => ({
      mutate: (vars: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
        state.mutate(vars);
        const next = state.results.shift();
        if (next) opts?.onSuccess?.(next);
      },
      reset: state.reset,
      error: state.error,
      isPending: state.isPending,
      variables: undefined,
    }),
  };
});

beforeEach(() => { state.mutate.mockClear(); state.error = null; state.results = []; state.isPending = false; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const ZERO_ITEMS = { checkins: 0, weights: 0, waists: 0, resting_hr: 0, meals: 0, cardio: 0, day_logs: 0, heart: 0 };
const ZERO_REVIEWS = { total: 0, new: 0, conflict: 0, unchanged: 0, kept_app: 0, written: 0 };

const result = (over: Partial<HistoryResult> = {}): HistoryResult => historyResult.parse({
  dry_run: true,
  on_conflict: "keep",
  files: [
    { name: "copia.json", kind: "parte_diario_json", days: 30, reviews: 0, error: null },
    { name: "2026-10-25.md", kind: "coach_review", days: 0, reviews: 1, error: null },
    { name: "foto.jpg", kind: null, days: 0, reviews: 0, error: { code: "unknown_format", params: {} } },
  ],
  days: { total: 30, new: 27, filled: 1, conflict: 2, unchanged: 0, written: 28 },
  conflicts: [
    { date: "2026-10-20", fields: ["weight_kg", "meal_cena"] },
    { date: "2026-10-21", fields: ["cardio"] },
  ],
  range: { first: "2026-09-25", last: "2026-10-24" },
  items: { ...ZERO_ITEMS, checkins: 28, weights: 20, meals: 60, cardio: 12, day_logs: 25 },
  reviews: { ...ZERO_REVIEWS, total: 1, new: 1, written: 1 },
  sets: [],
  discarded: [
    { code: "out_of_range", field: "weight_kg", count: 1, examples: ["2026-10-01"] },
    { code: "future_date", field: "date", count: 2, examples: ["2026-11-15", "2026-11-16"] },
  ],
  weight_blocked: { active: false, count: 0, fields: [] },
  notices: [{ code: "tickets_not_in_backup", count: 3 }, { code: "cardio_no_load", count: 12 }],
  ...over,
});

const files = () => [
  new File(['{"kind":"parte-diario-copia","format":1}'], "copia.json", { type: "application/json" }),
  new File(["tdee_kcal: 2600\n"], "2026-10-25.md", { type: "text/markdown" }),
];

describe("Importar historial (en)", () => {
  it("explica qué se puede subir y no deja importar sin revisar", () => {
    const { container } = renderEn(<HistoryImportPage />);
    expect(screen.getByRole("heading", { name: "Import history" })).toBeTruthy();
    expect(screen.getByText(/ParteDiario backup \(\.json\)/)).toBeTruthy();
    expect(screen.getByText(/checkins\.csv \(weigh-ins and sleep\)/)).toBeTruthy();
    expect(screen.getByText(/Menus, the shopping list and receipt photos are not imported here/)).toBeTruthy();
    expect(screen.getByText("Files (up to 60, 5 MB each)")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check files" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("history-import")).toBeNull();
    expectClean(container, ["ParteDiario"]);
  });

  it("revisa: días nuevos, en conflicto, lo que se guarda, lo descartado y los archivos que no se leen", () => {
    state.results = [result()];
    const { container } = renderEn(<HistoryImportPage />);
    fireEvent.change(screen.getByTestId("history-files"), { target: { files: files() } });
    expect(screen.getByTestId("history-chosen").textContent).toBe("2 files chosen");
    fireEvent.click(screen.getByRole("button", { name: "Check files" }));
    expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, onConflict: "keep" }));
    expect(state.mutate.mock.calls[0][0].files).toHaveLength(2);

    const summary = screen.getByTestId("history-summary");
    expect(summary.dataset.dryRun).toBe("true");
    expect(within(summary).getByText("This is what would be imported")).toBeTruthy();
    expect(screen.getByTestId("history-written").textContent).toBe("28 days would be saved");
    expect(screen.getByTestId("history-days-new").textContent).toBe("27 new days");
    expect(screen.getByTestId("history-days-filled").textContent).toBe("1 existing day gets completed");
    expect(screen.getByTestId("history-days-conflict").textContent).toBe("2 days in conflict");
    expect(screen.getAllByTestId("history-item").map((i) => i.textContent)).toEqual([
      "28 check-ins (sleep, kcal, energy, notes)", "20 weights", "60 meals marked", "12 cardio sessions", "25 days with type, workout or mobility",
    ]);
    expect(screen.getByTestId("history-reviews-new").textContent).toBe("1 new coach review");
    const discarded = screen.getAllByTestId("history-discarded").map((d) => d.textContent);
    expect(discarded).toEqual([
      "weight: 1 value out of range (e.g. 2026-10-01)",
      "date: 2 dates in the future (e.g. 2026-11-15, 2026-11-16)",
    ]);
    expect(screen.getAllByTestId("history-notice").map((n) => n.dataset.code)).toEqual(["tickets_not_in_backup", "cardio_no_load"]);
    expect(screen.getByTestId("history-file-error").textContent).toBe("foto.jpg: Not a recognised format (upload .json, .csv or .md).");

    // Los días en conflicto, con sus datos, y la opción segura marcada.
    const conflicts = screen.getByTestId("history-conflicts");
    expect(within(conflicts).getAllByTestId("history-conflict").map((c) => c.textContent)).toEqual([
      expect.stringContaining("weight, dinner"), expect.stringContaining("cardio"),
    ]);
    expect((screen.getByTestId("history-mode-keep") as HTMLInputElement).checked).toBe(true);
    expectClean(container, ["ParteDiario"]);
  });

  it("importa con la opción elegida y enseña el resumen final", () => {
    state.results = [result(), result({ dry_run: false, on_conflict: "replace", days: { total: 30, new: 27, filled: 1, conflict: 2, unchanged: 0, written: 30 } })];
    const { container } = renderEn(<HistoryImportPage />);
    fireEvent.change(screen.getByTestId("history-files"), { target: { files: files() } });
    fireEvent.click(screen.getByRole("button", { name: "Check files" }));
    fireEvent.click(screen.getByTestId("history-mode-replace"));
    fireEvent.click(screen.getByTestId("history-import"));
    expect(state.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false, onConflict: "replace" }));
    const summary = screen.getByTestId("history-summary");
    expect(summary.dataset.dryRun).toBe("false");
    expect(within(summary).getByText("Imported")).toBeTruthy();
    expect(screen.getByTestId("history-written").textContent).toBe("30 days saved");
    expect(screen.queryByTestId("history-import")).toBeNull();
    expectClean(container, ["ParteDiario"]);
  });

  it("con no_weight_targets explica que el peso, la cintura y las kcal no se guardan", () => {
    state.results = [result({ weight_blocked: { active: true, count: 4, fields: ["weight_kg", "intake_kcal"] }, conflicts: [], days: { total: 3, new: 3, filled: 0, conflict: 0, unchanged: 0, written: 3 } })];
    const { container } = renderEn(<HistoryImportPage />);
    fireEvent.change(screen.getByTestId("history-files"), { target: { files: files() } });
    fireEvent.click(screen.getByRole("button", { name: "Check files" }));
    expect(screen.getByTestId("history-blocked").textContent).toMatch(/does not save weight, waist or kcal .*4 values are not imported/);
    expect(screen.queryByTestId("history-conflicts")).toBeNull();
    expectClean(container, ["ParteDiario"]);
  });

  it("todo estaba ya: nada nuevo; y las series del coach con los textos de la fase 9", () => {
    state.results = [result({
      days: { total: 5, new: 0, filled: 0, conflict: 0, unchanged: 5, written: 0 },
      conflicts: [], discarded: [], notices: [], items: ZERO_ITEMS,
      reviews: { ...ZERO_REVIEWS, total: 1, kept_app: 1 },
      files: [{ name: "sessions.csv", kind: "sets", days: 0, reviews: 0, error: null }, { name: "mal.csv", kind: "sets", days: 0, reviews: 0, error: null }],
      sets: [
        { name: "sessions.csv", error: null, result: { importer: "coach_sessions", dry_run: true, sessions: { new: 0, updated: 0, total: 2 }, sets: { imported: 0, duplicates: 3, in_file: 3 }, range: null, warnings: [] } },
        { name: "mal.csv", result: null, error: { code: "decimal_comma", params: { line: 3 } } },
      ],
    })];
    const { container } = renderEn(<HistoryImportPage />);
    fireEvent.change(screen.getByTestId("history-files"), { target: { files: files() } });
    fireEvent.click(screen.getByRole("button", { name: "Check files" }));
    expect(screen.getByTestId("history-nothing")).toBeTruthy();
    expect(screen.getByTestId("history-reviews-kept_app").textContent).toMatch(/^1 week already has a review made in FightLab/);
    expect(screen.getByTestId("history-sets").textContent).toBe("sessions.csv: 0 new sets · 3 were already there");
    expect(screen.getByTestId("history-file-error").textContent).toMatch(/^mal\.csv: Line 3 has more fields than the header/);
    expectClean(container, ["12,5"]);
  });

  it.each([
    [new HistoryImportError("too_many_files", { max: 60 }), "You can upload up to 60 files at once."],
    [new HistoryImportError("throttled"), "Too many attempts in a row. Wait a minute."],
    [new Error("boom"), "The import failed. Try again."],
  ])("error traducido: %s", (error, text) => {
    state.error = error;
    const { container } = renderEn(<HistoryImportPage />);
    expect(screen.getByRole("alert").textContent).toBe(text);
    expectClean(container, ["ParteDiario"]);
  });
});

describe("useImportHistory", () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>{children}</QueryClientProvider>
  );

  it("sube todos los archivos como multipart, con dry_run y la opción de conflicto", async () => {
    const { useImportHistory: realHook } = await vi.importActual<typeof import("@/lib/history-import")>("@/lib/history-import");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(result()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result: hook } = renderHook(() => realHook(), { wrapper });
    hook.current.mutate({ files: files(), dryRun: true, onConflict: "keep" });
    await waitFor(() => expect(hook.current.data).toBeTruthy());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/proxy/coach/import/history");
    const form = init.body as FormData;
    expect((form.getAll("files") as File[]).map((f) => f.name)).toEqual(["copia.json", "2026-10-25.md"]);
    expect(form.get("dry_run")).toBe("1");
    expect(form.get("on_conflict")).toBe("keep");
  });

  it("un 400 con código pasa a HistoryImportError; los topes se comprueban antes de subir", async () => {
    const { useImportHistory: realHook } = await vi.importActual<typeof import("@/lib/history-import")>("@/lib/history-import");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ code: "too_many_days", params: { max: 5000 } }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { result: hook } = renderHook(() => realHook(), { wrapper });
    hook.current.mutate({ files: files(), dryRun: true, onConflict: "keep" });
    await waitFor(() => expect(hook.current.error).toBeTruthy());
    expect((hook.current.error as HistoryImportError).code).toBe("too_many_days");
    expect((hook.current.error as HistoryImportError).params).toEqual({ max: 5000 });

    expect(checkFiles([])?.code).toBe("missing_file");
    expect(checkFiles(Array.from({ length: 61 }, (_, i) => new File(["x"], `${i}.csv`)))?.code).toBe("too_many_files");
    expect(checkFiles([new File([new Uint8Array(25 * 1024 * 1024 + 1)], "big.json")])?.code).toBe("too_large");
    expect(checkFiles(files())).toBeNull();
  });
});
