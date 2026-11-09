// Un menú importado inventado (fase 12) con lo que devuelve `GET /coach/menu`: sesión de batch,
// nevera y congelador, víspera y lista de la compra por sección. Lo usan las pruebas de vitest.
import { BATCH_RULES, type Menu, type MenuState } from "@/lib/menu";

const item = (name: string, amount: number) => ({ name, amount, unit: "g" as const, known: true, product: false, url: null });
const RULES = Object.values(BATCH_RULES).map((key) => ({ key, grade: "strong", title: key }));

const lentils = (date: string, where: "fridge" | "freezer") => ({
  meal: "lunch", label: "Comida", tupper: true, free: false, free_budget_kcal: null, dish_id: "L1", prep: [], eve: [],
  storage: { where, days: where === "fridge" ? 1 : 3, rice: false, rules: [BATCH_RULES.fridge], session_date: "2026-11-01" },
  dishes: [{ id: "L1", dish: "Lentejas con pollo", source: null, servings: 5, seasoning: [], steps: ["Recalentar"],
    steps_batch: [{ step: "Guisar", min: 40, where: "pressure_cooker" }], storage: null, items: [item("lentejas, cocidas", 220)] }],
});

export const IMPORTED_MENU: Menu = {
  id: 9,
  menu_id: "2026-11-02",
  title: "Menú de prueba",
  source: "json",
  notes: ["Cantidades inventadas."],
  start_date: "2026-11-02",
  end_date: "2026-11-04",
  imported_at: "2026-10-31T10:00:00Z",
  kitchen_filled: true,
  batch_rules: RULES,
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
    rules: [BATCH_RULES.order, BATCH_RULES.cool, BATCH_RULES.label],
  }],
  days: [
    { date: "2026-11-02", meals: [lentils("2026-11-02", "fridge")], totals: { kcal: 2400, protein_g: 150 }, check: null,
      eve: [{ kind: "meal", meal: "lunch", text: "Remojar las lentejas" }] },
    { date: "2026-11-04", meals: [lentils("2026-11-04", "freezer"), {
      meal: "dinner", label: "Cena", tupper: false, free: true, free_budget_kcal: 650, dish_id: null, prep: [], eve: [], storage: null, dishes: [],
    }], totals: null, check: null, eve: [{ kind: "defrost", meal: "lunch", dish: "Lentejas con pollo", rule_key: BATCH_RULES.defrost }] },
  ],
  rejected: [],
  taste_flags: [],
  targets: {},
  rules: {},
  shopping: { chains: [], unknown: [], batches: [], pantry_skipped: [] },
  shopping_list: {
    source: "menu",
    weeks: [1, 2],
    note: "Para una persona.",
    total: 3,
    checked: 1,
    unknown: [],
    pantry_skipped: [],
    batches: [],
    sections: [
      { section: "Carnicería", items: [{ key: "pechuga de pollo, cruda", name: "pechuga de pollo, cruda", amount: 650, amount_two: null, unit: "g",
        section: "Carnicería", pack: "filetes de pechuga", chain: null, when: [1], dishes: [], product: null, checked: true }] },
      { section: "Legumbres", items: [{ key: "lentejas, cocidas", name: "lentejas, cocidas", amount: 1100, amount_two: 2200, unit: "g",
        section: "Legumbres", pack: "bote de lentejas cocidas 400 g", chain: null, when: [1, 2], dishes: ["L1"], product: null, checked: false }] },
      { section: "Pescadería", items: [{ key: "merluza, cruda", name: "merluza, cruda", amount: 1000, amount_two: null, unit: "g",
        section: "Pescadería", pack: "lomos de merluza", chain: null, when: [2], dishes: [], product: null, checked: false }] },
    ],
  },
  provider: "import",
  conventions: { kcal_margin: 0.05, no_repeat_days: 7 },
  engine_sha: "",
  created_at: "2026-10-31T10:00:00Z",
};

export const TASTES = {
  loved_foods: null, disliked_foods: null, allergies: null, intolerances: null, cuisines: null, flavours: null,
  equipment: null, chains: null, pantry: null, untried: null, cooking_minutes: null, cooking_skill: null, budget: null,
  missing: [], favoured: [], disliked: [], excluded: [],
};

export const importedState = (extra: Partial<MenuState> = {}): MenuState => ({
  today: "2026-10-31", blocked: null, missing: null, menu: IMPORTED_MENU, tastes: TASTES, max_days: 7,
  meals: ["breakfast", "lunch", "dinner", "snack"],
  menus: [
    { id: 9, title: "Menú de prueba", start_date: "2026-11-02", end_date: "2026-11-04", source: "json", menu_id: "2026-11-02" },
    { id: 3, title: "", start_date: "2026-10-26", end_date: null, source: "generated", menu_id: null },
  ],
  ...extra,
});
