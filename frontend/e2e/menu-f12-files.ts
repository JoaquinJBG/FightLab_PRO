// Menús inventados para los E2E de la fase 12 (contra Django): JSON `schema: 1` y YAML del coach,
// con fechas relativas a hoy en Europe/Madrid (la zona de los usuarios del E2E).

export function madridDay(offset = 0): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid" }).format(new Date());
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Un menú de 5 días que empieza mañana, con su sesión de batch hoy (olla exprés y horno). */
export function schema1(id: string, extra: Record<string, unknown> = {}) {
  const days = [1, 2, 3, 4, 5].map((n) => madridDay(n));
  return {
    schema: 1,
    id,
    start: days[0],
    end: days[4],
    title: "Menú E2E",
    notes: ["Menú inventado para las pruebas."],
    days: days.map((date, i) => ({
      date,
      meals: [
        { meal: "Desayuno", free: false, dish_id: "D1", dish: "Avena con yogur", tupper: false },
        { meal: "Comida", free: false, dish_id: "L1", dish: "Lentejas con pollo", tupper: true,
          eve: i === 0 ? ["Remojar las lentejas"] : [] },
        { meal: "Cena", free: false, dish_id: "C1", dish: "Tortilla en la air fryer", tupper: false },
      ],
      totals: { kcal: 2400, protein_g: 150, carbs_g: 250, fat_g: 80, fibre_g: 30 },
    })),
    dishes: {
      D1: { name: "Avena con yogur", batch_servings: null, steps: ["Mezclar"], seasoning: ["canela"],
        ingredients: [{ food: "copos de avena", grams: 60 }, { food: "yogur griego desnatado", grams: 250 }] },
      L1: { name: "Lentejas con pollo", batch_servings: 5, steps: ["Guisar"], steps_day: ["Recalentar tapado hasta que humee"],
        steps_batch: [{ step: "Guisar las lentejas", min: 40, where: "olla exprés" }],
        storage: { fridge_days: 2, freezer: true },
        ingredients: [{ food: "lentejas, cocidas", grams: 220 }, { food: "pechuga de pollo, cruda", grams: 130 }] },
      C1: { name: "Tortilla en la air fryer", batch_servings: null, steps: ["Batir y cuajar"],
        ingredients: [{ food: "huevo entero, crudo", grams: 150 }, { food: "calabacín", grams: 150 }] },
    },
    batch_sessions: [{
      date: madridDay(0),
      dishes: ["L1"],
      eve: ["Comprar lo de la lista"],
      timeline: [
        { min: 0, until: 10, where: "manos libres", step: "Picar la verdura", dish: "L1" },
        { min: 10, until: 50, where: "olla exprés", step: "Guisar las lentejas", dish: "L1" },
        { min: 0, until: 30, where: "horno", step: "Asar la verdura" },
      ],
    }],
    shopping: {
      items: [
        { name: "lentejas, cocidas", grams: 1100, grams_two: 2200, section: "Legumbres", pack: "bote de lentejas cocidas 400 g", when: "both", dishes: ["L1"] },
        { name: "pechuga de pollo, cruda", grams: 650, section: "Carnicería", pack: "filetes de pechuga", when: 1 },
        { name: "huevo entero, crudo", grams: 750, section: "Huevos", pack: "docena de huevos L", when: [1, 2] },
      ],
      note: "Cantidades para una persona.",
    },
    ...extra,
  };
}

export function coachYaml(): string {
  const [a, b] = [madridDay(10), madridDay(11)];
  return `saved_on: ${madridDay(0)}
days:
- date: ${a}
  meals:
  - meal: breakfast
    dishes:
    - dish: Avena con yogur
      items: ["copos de avena=60", "yogur griego desnatado=250"]
  - meal: lunch
    tupper: true
    dishes:
    - dish: Lentejas con pollo
      servings: 2
      items: ["lentejas, cocidas=220", "pechuga de pollo, cruda=130"]
- date: ${b}
  meals:
  - meal: breakfast
    dishes:
    - dish: Tostada con tomate
      items: ["pan integral=80", "tomate=100"]
  - meal: lunch
    tupper: true
    dishes:
    - dish: Lentejas con pollo
      servings: 2
      items: ["lentejas, cocidas=220", "pechuga de pollo, cruda=130"]
`;
}
