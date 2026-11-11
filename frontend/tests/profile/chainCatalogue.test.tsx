import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { expectClean, renderEn } from "../training/i18nB-helpers";
import CatalogueImportPage from "@/app/(shell)/profile/import/catalogue/page";
import {
  CatalogueError, catalogue, checkFile, estimatedCost, importResult, substitutesResult,
  type Catalogue, type ImportResult,
} from "@/lib/chain-catalogue";

// Fase 13: catálogo de cadena privado. El servidor lee el CSV del usuario, lo valora y lo guarda en
// su cuenta; aquí se revisa primero (dry_run), se importa, se lista, se borra y se buscan
// sustitutos. Todos los productos son INVENTADOS.

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  results: [] as unknown[],
  catalogue: null as unknown,
  deleteMutate: vi.fn(),
  subsMutate: vi.fn(),
  subsData: undefined as unknown,
}));

vi.mock("@/lib/chain-catalogue", async (orig) => {
  const real = await orig<typeof import("@/lib/chain-catalogue")>();
  return {
    ...real,
    useImportCatalogue: () => ({
      mutate: (vars: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
        state.mutate(vars);
        const next = state.results.shift();
        if (next) opts?.onSuccess?.(next);
      },
      reset: vi.fn(),
      error: null,
      isPending: false,
      variables: undefined,
    }),
    useChainCatalogue: () => ({ data: state.catalogue, isLoading: false, isError: false }),
    useDeleteCatalogue: () => ({ mutate: state.deleteMutate, isPending: false }),
    useSubstitutes: () => ({ mutate: state.subsMutate, data: state.subsData, isPending: false, isError: false }),
  };
});

beforeEach(() => {
  state.mutate.mockClear();
  state.deleteMutate.mockClear();
  state.results = [];
  state.catalogue = emptyCatalogue();
  state.subsData = undefined;
});
afterEach(() => cleanup());

const RULE = "food-products/rate-packaged-products-with-nutri-score-and-uk-traffic-lights";
const ENERGY = "food-products/flag-labels-whose-energy-does-not-match-the-macros";
const THRESHOLDS = [
  { key: "food.sugars.high", value: 22.5, unit: "g/100 g", source: "fsa_2016" },
  { key: "food.saturates.high", value: 5, unit: "g/100 g", source: "fsa_2016" },
  { key: "food.salt.high", value: 1.5, unit: "g/100 g", source: "fsa_2016" },
  { key: "drink.sugars.high", value: 11.25, unit: "g/100 ml", source: "fsa_2016" },
  { key: "drink.saturates.high", value: 2.5, unit: "g/100 ml", source: "fsa_2016" },
  { key: "drink.salt.high", value: 0.75, unit: "g/100 ml", source: "fsa_2016" },
  { key: "nutriscore.good", value: "A-B", unit: "", source: "nutriscore_2023" },
  { key: "energy.tolerance", value: 0.15, unit: "", source: "convention" },
];

function emptyCatalogue(over: Partial<Catalogue> = {}): Catalogue {
  return catalogue.parse({
    total: 0, chains: [], ratings: {}, review: 0, matched: 0, products: [], thresholds: THRESHOLDS,
    rule_key: RULE, energy_rule_key: ENERGY, rule_grades: { [RULE]: "moderate" }, ...over,
  });
}

const product = (over: Record<string, unknown> = {}) => ({
  id: 1, chain: "Mercadona", chain_ref: "90001", ean: null, name: "Pechuga inventada de ave", brand: "Marca Prueba",
  category: "Aves", pack: "Bandeja 500 g", price_per_kg: 8, equivalent_of: "pechuga de pollo, cruda", per: "100 g",
  kcal: 110, protein_g: 23, carbs_g: 0, fat_g: 1.5, fibre_g: 0, saturates_g: 0.4, sugars_g: 0, salt_g: 0.2,
  nutriscore: "A", nova: 1, rating: "bueno", check: "ok", reasons: [], file_rating: "bueno", rule_key: RULE, ...over,
});

const result = (over: Partial<ImportResult> = {}): ImportResult => importResult.parse({
  dry_run: true, format: "scored", chain: "Mercadona", rows: 9, new: 5, updated: 1, unchanged: 1, discarded_total: 2,
  discarded: [
    { code: "no_key", field: "", count: 1, lines: [4] },
    { code: "out_of_range", field: "fat_g", count: 1, lines: [7] },
  ],
  ratings: { bueno: 3, regular: 1, evitar: 2, "sin datos": 0, "no aplica": 1 },
  review: 1,
  differences: { count: 1, examples: [{ line: 3, name: "Galleta inventada", file: "bueno", engine: "evitar" }] },
  notices: [{ code: "ean_invalid", count: 1 }],
  rule_key: RULE,
  rule_grades: { [RULE]: "moderate" },
  ...over,
});

const csv = () => new File(["mercadona_id,nombre\n90001,Inventado\n"], "catalogo.csv", { type: "text/csv" });

describe("Catálogo de la cadena (en)", () => {
  it("explica qué se sube y que es privado, y no deja importar sin revisar", () => {
    const { container } = renderEn(<CatalogueImportPage />);
    expect(screen.getByRole("heading", { name: "Store catalogue" })).toBeTruthy();
    expect(screen.getByTestId("catalogue-privacy").textContent).toMatch(/kept in your account only/);
    expect(screen.getByTestId("catalogue-privacy").textContent).toMatch(/only reads the file you upload/);
    expect((screen.getByTestId("catalogue-check") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("catalogue-import")).toBeNull();
    expect(screen.getByTestId("catalogue-empty")).toBeTruthy();
    expectClean(container, ["equivale_a", "Mercadona"]);
  });

  it("revisa: nuevos, actualizados, descartados con su motivo y línea, valoraciones y diferencias", () => {
    state.results = [result()];
    const { container } = renderEn(<CatalogueImportPage />);
    fireEvent.change(screen.getByTestId("catalogue-file"), { target: { files: [csv()] } });
    fireEvent.click(screen.getByTestId("catalogue-check"));
    expect(state.mutate).toHaveBeenCalledWith(expect.objectContaining({ dryRun: true, chain: "Mercadona" }));

    const summary = screen.getByTestId("catalogue-summary");
    expect(summary.dataset.dryRun).toBe("true");
    expect(within(summary).getByText("This is what would be imported")).toBeTruthy();
    expect(screen.getByTestId("catalogue-new").textContent).toBe("5 new products");
    expect(screen.getByTestId("catalogue-updated").textContent).toBe("1 product gets updated");
    expect(screen.getByTestId("catalogue-discarded-total").textContent).toBe("2 rows discarded");
    expect(screen.getAllByTestId("catalogue-discarded").map((d) => d.textContent)).toEqual([
      "1 row with no store id or EAN (lines 4)",
      "1 row with an impossible value in fat_g (lines 7)",
    ]);
    expect(screen.getAllByTestId("catalogue-rating-count").map((c) => c.textContent)).toEqual([
      "3 good", "1 fair", "2 avoid", "1 not applicable",
    ]);
    expect(screen.getByTestId("catalogue-review").textContent).toMatch(/^1 product whose kcal do not match/);
    expect(screen.getByTestId("catalogue-difference").textContent).toBe("Galleta inventada: the file says Good, FightLab says Avoid");
    // Chip de evidencia de la regla, con su grado.
    const chip = within(summary).getByTestId("evidence-chip");
    expect(chip.dataset.variant).toBe("evidence");
    expect(chip.dataset.grade).toBe("moderate");
    expectClean(container, ["equivale_a", "Mercadona", "Galleta inventada", "fat_g"]);
  });

  it("importa tras revisar y enseña el resumen final", () => {
    state.results = [result(), result({ dry_run: false })];
    renderEn(<CatalogueImportPage />);
    fireEvent.change(screen.getByTestId("catalogue-file"), { target: { files: [csv()] } });
    fireEvent.click(screen.getByTestId("catalogue-check"));
    fireEvent.click(screen.getByTestId("catalogue-import"));
    expect(state.mutate).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false }));
    expect(screen.getByTestId("catalogue-summary").dataset.dryRun).toBe("false");
    expect(screen.getByTestId("catalogue-new").textContent).toBe("5 products added");
    expect(screen.queryByTestId("catalogue-import")).toBeNull();
  });

  it("lista el catálogo con su valoración, coste por kilo y umbrales con su fuente, y lo borra con confirmación", () => {
    state.catalogue = emptyCatalogue({
      total: 2, chains: ["Mercadona"], ratings: { bueno: 1, evitar: 1 }, review: 1, matched: 2,
      products: [product(), product({ id: 2, chain_ref: "90002", name: "Galleta inventada", rating: "evitar", check: "revisar", equivalent_of: null })],
    });
    const { container } = renderEn(<CatalogueImportPage />);
    expect(screen.getByTestId("catalogue-total").textContent).toBe("2 products from Mercadona");
    const items = screen.getAllByTestId("catalogue-item");
    expect(items[0].textContent).toContain("€8.00/kg");
    expect(items[0].textContent).toContain("Stands in for: pechuga de pollo, cruda");
    expect(within(items[1]).getByTestId("rating-badge").dataset.rating).toBe("evitar");
    expect(within(items[1]).getByTestId("rating-review").textContent).toBe("Review");
    expect(screen.getByTestId("threshold-food").textContent).toBe(
      "Foods, per 100 g: high above 22.5 g sugars, 5 g saturated fat or 1.5 g salt. Source: UK FSA guidance (2016)",
    );
    expect(screen.getAllByTestId("threshold").map((x) => x.dataset.source)).toEqual(["nutriscore_2023", "convention"]);

    fireEvent.click(screen.getByTestId("catalogue-delete"));
    expect(screen.getByTestId("catalogue-delete-confirm").textContent).toMatch(/Delete the 2 products\?/);
    fireEvent.click(screen.getByTestId("catalogue-delete-yes"));
    expect(state.deleteMutate).toHaveBeenCalled();
    expectClean(container, ["Mercadona", "Pechuga inventada de ave", "Galleta inventada", "pechuga de pollo, cruda", "Marca Prueba", "Bandeja 500 g"]);
  });

  it("sustitutos: los penalizados (evitar) se marcan", () => {
    state.subsData = substitutesResult.parse({
      food: { name: "chicken breast, raw", grams: 150, kcal: 180, rating: null },
      substitutes: [
        { name: "turkey breast, raw", kind: "food", chain: null, pack: null, grams: 165, kcal: 180, protein_g: 39, carbs_g: 0, fat_g: 2, rating: null, check: null, penalised: false },
        { name: "Embutido inventado", kind: "chain", chain: "Mercadona", pack: "Sobre 200 g", grams: 150, kcal: 180, protein_g: 33, carbs_g: 0, fat_g: 5, rating: "evitar", check: "ok", penalised: true },
      ],
      rule_key: RULE,
    });
    renderEn(<CatalogueImportPage />);
    const subs = screen.getAllByTestId("substitute");
    expect(subs.map((s) => s.dataset.penalised)).toEqual(["false", "true"]);
    expect(subs[0].textContent).toBe("165 g of turkey breast, raw · 180 kcal · 39 g protein");
    fireEvent.change(screen.getByTestId("substitutes-food"), { target: { value: "chicken breast, raw" } });
    fireEvent.change(screen.getByTestId("substitutes-grams"), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: "Find" }));
    expect(state.subsMutate).toHaveBeenCalledWith({ food: "chicken breast, raw", grams: 150 });
  });
});

describe("lib/chain-catalogue", () => {
  it("comprueba el archivo antes de subirlo", () => {
    expect(checkFile(null)?.code).toBe("missing_file");
    expect(checkFile(new File(["x"], "tabla.xlsx"))?.code).toBe("not_csv");
    const big = new File(["x"], "tabla.csv");
    Object.defineProperty(big, "size", { value: 6 * 1024 * 1024 });
    expect(checkFile(big)).toEqual(new CatalogueError("too_large", { mb: 5 }));
    expect(checkFile(csv())).toBeNull();
  });

  it("coste estimado desde el precio por kilo", () => {
    expect(estimatedCost(750, 8)).toBe(6);
    expect(estimatedCost(333, 2.99)).toBe(1);
    expect(estimatedCost(100, null)).toBeNull();
  });
});
