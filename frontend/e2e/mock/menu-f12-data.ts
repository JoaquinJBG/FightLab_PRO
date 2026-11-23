// Un menú importado inventado (fase 12), tal como lo devuelve `GET /coach/menu`, para los E2E con la
// API mockeada (batch-session.spec.ts y menu-import.spec.ts). Sin datos de nadie.

const DEFROST = "batch-cooking/defrost-in-the-fridge-the-night-before";
const FRIDGE = "batch-cooking/eat-from-the-fridge-within-2-days-and-freeze-the-rest-the-same-day";
const ORDER = "batch-cooking/order-the-batch-session-from-longest-to-shortest-in-parallel-by-appliance";
const COOL = "batch-cooking/cool-cooked-food-and-refrigerate-it-within-2-hours-rice-within-1-hour";
const LABEL = "batch-cooking/label-each-container-with-the-dish-and-the-date-first-in-first-out";

const item = (name: string, amount: number) => ({ name, amount, unit: "g", known: true, product: false, url: null });

const lunch = (where: "fridge" | "freezer") => ({
  meal: "lunch", label: "Comida", tupper: true, free: false, free_budget_kcal: null, dish_id: "L1", prep: [], eve: [],
  storage: { where, days: where === "fridge" ? 1 : 3, rice: false, rules: [FRIDGE], session_date: "2026-11-01" },
  dishes: [{ id: "L1", dish: "Lentejas con pollo", source: null, servings: 5, seasoning: [], steps: ["Recalentar"],
    steps_batch: [], storage: null, items: [item("lentejas, cocidas", 220)] }],
});

export const MENU = {
  id: 9,
  menu_id: "2026-11-02",
  title: "Menú de prueba",
  source: "json",
  notes: ["Cantidades inventadas."],
  start_date: "2026-11-02",
  end_date: "2026-11-04",
  imported_at: "2026-10-31T10:00:00Z",
  kitchen_filled: true,
  batch_rules: [ORDER, COOL, LABEL, DEFROST, FRIDGE].map((key) => ({ key, grade: "strong", title: key })),
  batch_sessions: [{
    date: "2026-11-01",
    dishes: [{ id: "L1", name: "Lentejas con pollo", batch_servings: 5 }],
    eve: ["Comprar lo de la lista"],
    timeline: [
      { min: 0, until: 10, where: "hands", step: "Picar la verdura", dish: "L1" },
      { min: 10, until: 50, where: "pressure_cooker", step: "Guisar las lentejas", dish: "L1" },
      { min: 0, until: 30, where: "oven", step: "Asar la verdura" },
    ],
    total_min: 50,
    appliances: ["pressure_cooker", "oven", "hands"],
    missing: [],
    rebuilt: false,
    checked: true,
    rules: [ORDER, COOL, LABEL],
  }],
  days: [
    { date: "2026-11-02", meals: [lunch("fridge")], totals: { kcal: 2400, protein_g: 150 }, check: null,
      eve: [{ kind: "meal", meal: "lunch", text: "Remojar las lentejas" }] },
    { date: "2026-11-04", meals: [lunch("freezer")], totals: null, check: null,
      eve: [{ kind: "defrost", meal: "lunch", dish: "Lentejas con pollo", rule_key: DEFROST }] },
  ],
  rejected: [],
  taste_flags: [],
  targets: {},
  rules: {},
  shopping: { chains: [], unknown: [], batches: [], pantry_skipped: [] },
  shopping_list: {
    source: "menu", weeks: [1, 2], note: "", total: 2, checked: 0, unknown: [], pantry_skipped: [], batches: [],
    sections: [
      { section: "Carnicería", items: [{ key: "pechuga de pollo, cruda", name: "pechuga de pollo, cruda", amount: 650, amount_two: null, unit: "g",
        section: "Carnicería", pack: "filetes de pechuga", chain: null, when: [1], dishes: [], product: null, checked: false }] },
      { section: "Legumbres", items: [{ key: "lentejas, cocidas", name: "lentejas, cocidas", amount: 1100, amount_two: 2200, unit: "g",
        section: "Legumbres", pack: "bote de lentejas cocidas 400 g", chain: null, when: [1, 2], dishes: ["L1"], product: null, checked: false }] },
    ],
  },
  provider: "import",
  conventions: { kcal_margin: 0.05, no_repeat_days: 7 },
  engine_sha: "",
  created_at: "2026-10-31T10:00:00Z",
};

const TASTES = {
  loved_foods: null, disliked_foods: null, allergies: null, intolerances: null, cuisines: null, flavours: null,
  equipment: null, chains: null, pantry: null, untried: null, cooking_minutes: null, cooking_skill: null, budget: null,
  missing: [], favoured: [], disliked: [], excluded: [],
};

export function menuState(menu: unknown = MENU) {
  return {
    today: "2026-10-31", blocked: null, missing: null, menu, tastes: TASTES, max_days: 7,
    meals: ["breakfast", "lunch", "dinner", "snack"],
    menus: menu ? [{ id: 9, title: "Menú de prueba", start_date: "2026-11-02", end_date: "2026-11-04", source: "json", menu_id: "2026-11-02" }] : [],
  };
}
