import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import MenuPage from "@/app/(shell)/nutrition/menu/page";
import AddFoodPage from "@/app/(shell)/nutrition/add/page";
import { CATALOGS, TARGETS, mockApi, renderApp } from "../support/app";
import { splitWords, type Menu, type MenuState } from "@/lib/menu";

// Fase 8: pantalla "Menú y compra". El servidor propone y el motor comprueba; aquí se pinta con
// el estado de cada objetivo, su chip de evidencia, los días rechazados y la lista de la compra.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const RULE = { key: "nutrition/energy", grade: "moderate", title: "Energy" };
const item = (name: string, amount: number) => ({ name, amount, unit: "g" as const, known: true, product: false, url: null });

const MENU: Menu = {
  id: 3,
  start_date: "2026-10-29",
  provider: "fake",
  days: [{
    date: "2026-10-29",
    meals: [
      { meal: "breakfast", tupper: false, free: false, dishes: [{ dish: "Oats with Greek yoghurt and raspberries", source: null, servings: 1, seasoning: ["cinnamon"], steps: [], items: [item("rolled oats", 72)] }] },
      { meal: "lunch", tupper: true, free: false, dishes: [{ dish: "Lentil stew with chicken and vegetables", source: "https://example.invalid/receta", servings: 1, seasoning: [], steps: [], items: [item("lentils, cooked", 300)] }] },
    ],
    check: {
      date: "2026-10-29", ok: true,
      totals: { kcal: 2700, protein_g: 150, carbs_g: 300, fat_g: 80, fibre_g: 40, unknown: [], missing: {} },
      check: { kcal: "ok", protein_g: "ok", fat_g: "ok", fibre_g: "ok" },
    },
  }],
  rejected: [{ date: "2026-10-30", check: { kcal: "under", protein_g: "ok", fat_g: "ok", fibre_g: "ok" }, unknown: [], repeats: false, blocking: [{ kind: "allergy", entry: "peanut" }], empty: false }],
  taste_flags: [{ date: "2026-10-29", dish: "Lentil stew with chicken and vegetables", kind: "disliked", where: "item", entry: "onion", text: "onion", blocking: false }],
  targets: { kcal: 2650, protein_g: 115, fat_min_g: 59, fibre_g: 25, in_deficit: false },
  rules: { kcal: [RULE], protein_g: [RULE], fat_g: [RULE], fibre_g: [RULE] },
  shopping: {
    chains: [{ chain: "any", items: [{ name: "rolled oats", grams: 72 }, { name: "lentils, cooked", grams: 300 }] }],
    unknown: [], batches: [], pantry_skipped: ["olive oil"],
  },
  conventions: { kcal_margin: 0.05, no_repeat_days: 7 },
  engine_sha: "69e5537",
  created_at: "2026-10-29T10:00:00Z",
};

const TASTES = {
  loved_foods: null, disliked_foods: ["onion"], allergies: ["peanut"], intolerances: null, cuisines: null, flavours: null,
  equipment: null, chains: null, pantry: ["olive oil"], untried: null, cooking_minutes: null, cooking_skill: null, budget: null,
  missing: ["loved_foods"], favoured: [], disliked: [], excluded: [],
};

const state = (extra: Partial<MenuState> = {}): MenuState => ({
  today: "2026-10-29", blocked: null, missing: null, menu: MENU, tastes: TASTES, max_days: 7,
  meals: ["breakfast", "lunch", "dinner", "snack"], ...extra,
});

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe.each(["es", "en"] as const)("Menú y compra (%s)", (locale) => {
  const cat = CATALOGS[locale].menu;

  it("pinta los días comprobados con el estado y el chip de cada objetivo", async () => {
    mockApi({ "/api/proxy/coach/menu": { body: state() }, "/api/proxy/coach/products": { body: { products: [] } } });
    renderApp(<MenuPage />, locale);
    const day = await screen.findByTestId("menu-day");
    expect(day.dataset.ok).toBe("true");
    const checks = within(day).getAllByTestId("menu-check");
    expect(checks.map((c) => c.dataset.status)).toEqual(["ok", "ok", "ok", "ok"]);
    for (const c of checks) expect(within(c).getByTestId("evidence-chip").dataset.variant).toBe("evidence");
    // Objetivos con su regla y las convenciones etiquetadas como tales.
    const targets = screen.getAllByTestId("menu-target");
    expect(targets).toHaveLength(6);
    expect(targets.filter((x) => within(x).getByTestId("evidence-chip").dataset.variant === "convention")).toHaveLength(2);
    expect(screen.getByTestId("menu-simulated").textContent).toBe(cat.simulated);
    expect(within(day).getByText(cat.day.source).getAttribute("href")).toBe("https://example.invalid/receta");
    // Día rechazado sin sus platos, con el motivo; avisos de gustos; la compra sin lo que hay en casa.
    const rejected = screen.getByTestId("menu-rejected-day");
    expect(rejected.textContent).toContain(cat.flags.kinds.allergy);
    expect(screen.getByTestId("menu-taste-flags").textContent).toContain("onion");
    const shopping = screen.getByTestId("shopping-list");
    expect(within(shopping).getAllByTestId("shopping-item")).toHaveLength(2);
    expect(shopping.textContent).toContain(cat.shopping.any);
    expect(shopping.textContent).toContain("olive oil");
  });

  it("F24: la proteína sale con el mismo redondeo que Nutrición y avisa si los objetivos de hoy cambiaron", async () => {
    const menu = { ...MENU, targets: { ...MENU.targets, protein_g: 160.5 } }; // Nutrición: Math.round → 161
    mockApi({
      "/api/proxy/coach/menu": { body: state({ menu }) },
      "/api/proxy/coach/products": { body: { products: [] } },
      "/api/proxy/coach/targets": { body: { ...TARGETS, macros: { ...TARGETS.macros, protein_g: 160.2 } } },
    });
    renderApp(<MenuPage />, locale);
    const protein = (await screen.findAllByTestId("menu-target")).find((x) => x.dataset.key === "protein_g")!;
    expect(protein.textContent).toContain("161");
    expect((await screen.findByTestId("menu-targets-changed")).textContent).toContain("160");
  });

  it("sin cambios en los objetivos no hay aviso", async () => {
    mockApi({
      "/api/proxy/coach/menu": { body: state() },
      "/api/proxy/coach/products": { body: { products: [] } },
      "/api/proxy/coach/targets": { body: { ...TARGETS, macros: { ...TARGETS.macros, protein_g: 114.6 } } },
    });
    renderApp(<MenuPage />, locale);
    await screen.findByTestId("menu-day");
    await waitFor(() => expect(screen.queryByTestId("menu-targets-changed")).toBeNull());
  });

  it("genera el menú con los días y las comidas elegidas", async () => {
    const fetch = mockApi({
      "/api/proxy/coach/menu": (init) => (init?.method === "POST" ? { status: 201, body: MENU } : { body: state({ menu: null }) }),
      "/api/proxy/coach/products": { body: { products: [] } },
    });
    renderApp(<MenuPage />, locale);
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: cat.form.generate }));
    await waitFor(() => expect(fetch.mock.calls.some(([, i]) => i?.method === "POST")).toBe(true));
    const [, init] = fetch.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(String(init!.body))).toEqual({
      start_date: "2026-10-29", days: 5, meals: ["breakfast", "lunch", "dinner", "snack"], tupper_meals: [],
    });
  });

  it("sin objetivos de kcal no hay formulario", async () => {
    const reason = { code: "under_18", rule_key: "safety/u18", grade: null, params: {}, text: "under 18", professional: null, severity: "stop" as const };
    mockApi({ "/api/proxy/coach/menu": { body: state({ menu: null, blocked: { code: "no_calorie_targets", reasons: [reason] } }) } });
    renderApp(<MenuPage />, locale);
    expect(await screen.findByTestId("menu-blocked")).toBeTruthy();
    expect(screen.queryByTestId("menu-form")).toBeNull();
  });

  it("explica que la búsqueda de productos no está configurada", async () => {
    mockApi({
      "/api/proxy/coach/menu": { body: state() },
      "/api/proxy/coach/products": { body: { products: [] } },
      "/api/proxy/coach/products/search": { status: 503, body: { code: "off_not_configured", detail: "x" } },
    });
    renderApp(<MenuPage />, locale);
    const card = await screen.findByTestId("products-card");
    fireEvent.change(within(card).getByRole("textbox"), { target: { value: "revuelto" } });
    fireEvent.click(within(card).getByRole("button", { name: cat.products.search }));
    expect((await screen.findByTestId("off-not-configured")).textContent).toBe(cat.products.notConfigured);
  });
});

describe("PDF del menú", () => {
  function stubFetch(pdf: Response) {
    const fn = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input).split("?")[0];
      if (url === "/api/proxy/coach/menu") return new Response(JSON.stringify(state()), { status: 200 });
      if (url === "/api/proxy/coach/products") return new Response(JSON.stringify({ products: [] }), { status: 200 });
      if (url === "/api/menu-pdf/3") return pdf;
      return new Response("{}", { status: 404 });
    });
    vi.stubGlobal("fetch", fn);
    return fn;
  }

  it("descarga el PDF del menú guardado con su nombre", async () => {
    // Cuerpo en texto: el Blob de jsdom 29 no tiene .stream(), que pide el Response de Node
    const pdf = new Response("%PDF-1.4", {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="fightlab-menu-2026-10-29.pdf"' },
    });
    const fetch = stubFetch(pdf);
    const created = vi.fn(() => "blob:menu");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const clicks: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download);
    });
    renderApp(<MenuPage />, "en");
    fireEvent.click(await screen.findByTestId("menu-pdf"));
    await waitFor(() => expect(clicks).toEqual(["fightlab-menu-2026-10-29.pdf"]));
    expect(fetch).toHaveBeenCalledWith("/api/menu-pdf/3", { credentials: "include" });
    expect(created).toHaveBeenCalledOnce();
    click.mockRestore();
  });

  it("explica por qué no hay PDF cuando el servidor lo bloquea", async () => {
    stubFetch(new Response(JSON.stringify({ code: "no_calorie_targets" }), { status: 409, headers: { "Content-Type": "application/json" } }));
    renderApp(<MenuPage />, "es");
    fireEvent.click(await screen.findByTestId("menu-pdf"));
    expect((await screen.findByRole("alert")).textContent).toBe(CATALOGS.es.menu.pdf.no_calorie_targets);
  });
});

describe("Añadir comida busca en la tabla del motor", () => {
  it("enseña el nombre en el idioma del usuario y las kcal por 100 g o 100 ml", async () => {
    const food = (name: string, per: "100 g" | "100 ml", kcal: number | null) => ({
      name, name_es: name, name_en: name, per, kcal, protein_g: 1, carbs_g: 1, fat_g: 1, fibre_g: 1, missing: [],
      source: "fdc_sr_legacy", kind: "food", barcode: null, chain: null, url: null, unverified: false,
    });
    mockApi({ "/api/proxy/coach/foods": { body: { foods: [food("chicken breast, raw", "100 g", 120), food("oat drink", "100 ml", null)] } } });
    renderApp(<AddFoodPage />, "en");
    fireEvent.change(await screen.findByPlaceholderText(CATALOGS.en.nutrition.add.search.placeholder), { target: { value: "chi" } });
    const hits = await screen.findAllByTestId("food-hit");
    expect(hits[0].textContent).toContain("120 kcal/100g");
    expect(hits[1].textContent).toContain(CATALOGS.en.nutrition.add.search.noData);
  });
});

describe("splitWords", () => {
  it("separa por comas sin vacíos ni repetidos", () => {
    expect(splitWords(" pollo, arroz ,, pollo,  avena  integral ")).toEqual(["pollo", "arroz", "avena integral"]);
    expect(splitWords("")).toEqual([]);
  });
});
