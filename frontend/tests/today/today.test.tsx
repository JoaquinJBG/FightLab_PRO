import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import TodayPage from "@/app/(shell)/today/page";
import type { TodayState } from "@/lib/today";
import { SAFETY, mockApi, renderApp } from "../support/app";

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));

afterEach(() => vi.unstubAllGlobals());

const URL = "/api/proxy/coach/today";

const READINESS = {
  status: "no_data", drops_today: [], days_with_drop: 0, hrv_drop: false,
  rule_key: "recovery-habits/simple-readiness-monitoring", grade: "moderate",
  hrv_rule_key: "recovery-habits/hrv-is-optional", hrv_grade: "emerging",
};

const WEEK = {
  start: "2026-10-26", minutes: 60, equivalent: 80, goal: 150, mma_minutes: 0, mma_convention: null,
  rule_key: "cardio-health/weekly-baseline-dose", grade: "strong",
  vigorous_rule_key: "cardio-health/0-10-effort-scale-and-talk-test-anchors", vigorous_grade: "moderate",
};
const TYPES = [
  { key: "walk", vigorous: false }, { key: "run", vigorous: true }, { key: "hiit", vigorous: true }, { key: "other", vigorous: false },
];

function day(over: Partial<TodayState> = {}): TodayState {
  return {
    date: "2026-10-29",
    today: "2026-10-29",
    weekday: "thu",
    plan: {
      id: 3, week_start: "2026-10-26", type: "gym",
      entries: [{ kind: "gym", time: "18:00", session: "A", exercises: ["Sentadilla", "Press banca"] }],
    },
    day_type: "gym",
    day_type_set: false,
    trained: null,
    mobility: null,
    weight_kg: null,
    weight_blocked: false,
    menu: {
      id: 7, start_date: "2026-10-26",
      meals: [
        { meal: "breakfast", free: false, tupper: false, dishes: ["Avena con yogur"], prep: [], eve: [], mark: null },
        { meal: "lunch", free: false, tupper: true, dishes: ["Arroz con pollo"], prep: [], eve: ["Sacar el pollo"], mark: null },
      ],
    },
    next_meal: { all_done: false, meal: "breakfast", free: false, dishes: ["Avena con yogur"] },
    cardio: {
      sessions: [
        { id: 11, type: "walk", title: "walk", minutes: 40, vigorous: false, equivalent: 40, deletable: true },
        { id: 12, type: "run", title: "Correr", minutes: 20, vigorous: true, equivalent: 40, deletable: false },
      ],
      week: WEEK,
      types: TYPES,
    },
    ...over,
  };
}

/** GET devuelve `state`; cada escritura guarda el cuerpo y devuelve `after(body)`. */
function api(state: TodayState, after: (body: Record<string, unknown>, path: string) => TodayState = () => state) {
  const writes: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const write = (path: string) => (init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    writes.push({ path, method: init?.method ?? "GET", body });
    return { body: init?.method && init.method !== "GET" ? after(body, path) : state };
  };
  const fetchMock = mockApi({
    [URL]: write(URL),
    [`${URL}/meal`]: write(`${URL}/meal`),
    [`${URL}/cardio`]: write(`${URL}/cardio`),
    [`${URL}/cardio/11`]: write(`${URL}/cardio/11`),
  });
  return { writes: () => writes.filter((w) => w.method !== "GET"), fetchMock };
}

/** El peso y el cardio se apuntan en un panel inferior: se abre desde la fila «Apuntar rápido». */
async function openSheet(kind: "weight" | "cardio") {
  fireEvent.click(await screen.findByTestId(`quick-${kind}`));
  return screen.findByRole("dialog");
}

describe("Hoy", () => {
  it("pinta el entreno de hoy, la próxima comida y el cardio de la semana (en su panel) con su chip", async () => {
    api(day());
    renderApp(<TodayPage />);
    const next = await screen.findByTestId("next-meal");
    expect(next.textContent).toContain("Desayuno: Avena con yogur");
    // F11: «Jueves, 29 de octubre», con la «de» en minúscula
    expect(screen.getByTestId("today-date").textContent).toBe("Jueves, 29 de octubre");
    // F19: el tipo de día anuncia cuál está elegido (grupo de opciones con aria-checked)
    const types = ["gym", "cardio", "rest"].map((d) => screen.getByTestId(`day-type-${d}`));
    expect(types.every((b) => b.getAttribute("role") === "radio" && b.hasAttribute("aria-checked"))).toBe(true);
    expect(types.filter((b) => b.getAttribute("aria-checked") === "true").length).toBeLessThanOrEqual(1);
    const plan = screen.getByTestId("day-plan");
    expect(plan.textContent).toContain("Gimnasio, sesión A");
    expect(plan.textContent).toContain("a las 18:00");
    expect(plan.textContent).toContain("Sentadilla · Press banca");
    expect(within(plan).getByRole("link", { name: /Empezar la sesión A/ }).getAttribute("href")).toBe("/training/gym?plan=A");
    // Se quita la lista entera de comidas del menú (está en Nutrición) y el botón Resumen
    expect(screen.queryByTestId("meals")).toBeNull();
    expect(screen.queryByRole("link", { name: /resumen/i })).toBeNull();
    // «Ver el día» abre todas las comidas del menú con sus marcas, también «No hecha» y quitar la marca.
    fireEvent.click(within(next).getByRole("button", { name: "Ver el día" }));
    const daySheet = await screen.findByRole("dialog");
    expect(within(daySheet).getByTestId("day-meals")).toBeTruthy();
    expect(within(daySheet).getAllByRole("button", { name: "No hecha" }).length).toBeGreaterThan(0);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("quick-checkin").getAttribute("href")).toBe("/checkin");
    expect(screen.getByTestId("quick-cardio").textContent).toContain("80/150 min");
    await openSheet("cardio");
    expect(screen.getByTestId("cardio-week").textContent).toBe("Esta semana: 80 de 150 min");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("80");
    const chips = within(screen.getByTestId("cardio")).getAllByTestId("evidence-chip");
    expect(chips[0].getAttribute("data-grade")).toBe("strong");
    // La de Deportes no se borra aquí; la apuntada en Hoy sí.
    const sessions = screen.getAllByTestId("cardio-session");
    expect(sessions[0].textContent).toContain("Paseo");
    expect(sessions[1].textContent).toContain("Desde Deportes");
    expect(screen.getByTestId("today-avatar").getAttribute("href")).toBe("/profile");
  });

  it("el avatar lleva a Perfil con la inicial del correo", async () => {
    mockApi({ [URL]: { body: day() }, "/api/proxy/me": { body: { id: 1, email: "ana@fightlab.test", role: "ATHLETE", is_email_verified: true } } });
    renderApp(<TodayPage />);
    const avatar = await screen.findByTestId("today-avatar");
    await waitFor(() => expect(avatar.textContent).toBe("A"));
    expect(avatar.getAttribute("href")).toBe("/profile");
  });

  it("para esta noche: tareas de la víspera, la sesión de batch de mañana y descongelar con su regla (F12)", async () => {
    api(day({ tonight: { date: "2026-10-30", rule_key: "batch-cooking/defrost-in-the-fridge-the-night-before", tasks: [
      { kind: "batch", text: "Comprar lo de la lista" },
      { kind: "meal", meal: "lunch", text: "Remojar las lentejas" },
      { kind: "defrost", meal: "lunch", dish: "Lentejas con pollo", rule_key: "batch-cooking/defrost-in-the-fridge-the-night-before" },
    ] } }));
    renderApp(<TodayPage />);
    const tonight = await screen.findByTestId("today-tonight");
    const tasks = within(tonight).getAllByTestId("tonight-task");
    expect(tasks.map((t) => t.dataset.kind)).toEqual(["batch", "meal", "defrost"]);
    expect(tasks[2].textContent).toContain("Pasa Lentejas con pollo del congelador a la nevera");
    expect(within(tasks[2]).getByTestId("evidence-chip").dataset.variant).toBe("evidence");
  });

  it("F29: la marca de un plato que ya no está en el menú no pasa al plato nuevo", async () => {
    const base = day();
    const meals = base.menu!.meals.map((m, i) => (i === 0
      ? { ...m, dishes: ["Tostada con tomate"], mark: null, previous_mark: { state: "skipped" as const, change: null, dish: "Avena con yogur" } }
      : m));
    api(day({ menu: { ...base.menu!, meals } }));
    renderApp(<TodayPage />);
    const previous = await screen.findByTestId("meal-breakfast-previous");
    expect(previous.textContent).toContain("No hecha (Avena con yogur)");
  });

  it("sin tareas para esta noche no sale la tarjeta", async () => {
    api(day({ tonight: { date: "2026-10-30", rule_key: "x", tasks: [] } }));
    renderApp(<TodayPage />);
    await screen.findByTestId("next-meal");
    expect(screen.queryByTestId("today-tonight")).toBeNull();
  });

  it("los botones de entreno, movilidad y tipo de día guardan en el parte", async () => {
    const { writes } = api(day(), (body) => day({ trained: body.trained === true ? true : null }));
    renderApp(<TodayPage />);
    fireEvent.click(await screen.findByTestId("toggle-trained"));
    await waitFor(() => expect(screen.getByTestId("toggle-trained").getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(screen.getByTestId("toggle-mobility"));
    fireEvent.click(screen.getByTestId("day-type-rest"));
    await waitFor(() => expect(writes()).toHaveLength(3));
    expect(writes().map((w) => w.body)).toEqual([{ trained: true }, { mobility: true }, { day_type: "rest" }]);
  });

  it("un día cambiado a mano deja volver a lo del plan", async () => {
    const { writes } = api(day({ day_type: "rest", day_type_set: true }), () => day());
    renderApp(<TodayPage />);
    expect((await screen.findByTestId("day-type-rest")).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Volver a lo del plan" }));
    await waitFor(() => expect(writes()[0]?.body).toEqual({ day_type: null }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Volver a lo del plan" })).toBeNull());
  });

  it("marca una comida como cambiada con lo que se comió", async () => {
    const changed = day({
      menu: { ...day().menu!, meals: [{ ...day().menu!.meals[0], mark: { state: "changed", change: "pizza" } }, day().menu!.meals[1]] },
      next_meal: { all_done: false, meal: "lunch", free: false, dishes: ["Arroz con pollo"] },
    });
    const { writes } = api(day(), () => changed);
    renderApp(<TodayPage />);
    fireEvent.click(await screen.findByTestId("meal-breakfast-changed"));
    fireEvent.change(screen.getByTestId("meal-breakfast-change"), { target: { value: "pizza" } });
    fireEvent.submit(screen.getByTestId("meal-breakfast-change").closest("form")!);
    await waitFor(() => expect(writes()[0]).toMatchObject({ path: `${URL}/meal`, method: "PUT", body: { meal: "breakfast", state: "changed", change: "pizza" } }));
    await waitFor(() => expect(screen.getByTestId("next-meal").textContent).toContain("Comida: Arroz con pollo"));
  });

  it("«Hecha» guarda la próxima comida con un toque", async () => {
    const done = day({ menu: { ...day().menu!, meals: [{ ...day().menu!.meals[0], mark: { state: "done", change: null } }, day().menu!.meals[1]] } });
    const { writes } = api(day(), () => done);
    renderApp(<TodayPage />);
    fireEvent.click(await screen.findByTestId("meal-breakfast-done"));
    await waitFor(() => expect(screen.getByTestId("meal-breakfast-done").getAttribute("aria-pressed")).toBe("true"));
    await waitFor(() => expect(writes().map((w) => w.body)).toEqual([{ meal: "breakfast", state: "done" }]));
  });

  it("apunta una sesión de cardio con su intensidad y comprueba los minutos", async () => {
    const { writes } = api(day());
    renderApp(<TodayPage />);
    await openSheet("cardio");
    fireEvent.click(await screen.findByTestId("cardio-type-run"));
    // El trote es vigoroso por defecto, como en ParteDiario.
    expect(screen.getByTestId("cardio-intensity-vigorous").getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByTestId("cardio-intensity-moderate"));
    fireEvent.change(screen.getByTestId("cardio-minutes"), { target: { value: "700" } });
    fireEvent.click(screen.getByTestId("cardio-save"));
    expect(await screen.findByText("Entre 1 y 600 minutos.")).toBeTruthy();
    expect(writes()).toHaveLength(0);
    fireEvent.change(screen.getByTestId("cardio-minutes"), { target: { value: "25" } });
    fireEvent.click(screen.getByTestId("cardio-save"));
    await waitFor(() => expect(writes()[0]).toMatchObject({ path: `${URL}/cardio`, method: "POST", body: { type: "run", minutes: 25, intensity: "moderate" } }));
  });

  it("borra una sesión apuntada desde Hoy", async () => {
    const { writes } = api(day());
    renderApp(<TodayPage />);
    await openSheet("cardio");
    fireEvent.click(await screen.findByRole("button", { name: "Borrar Paseo, 40 min" }));
    await waitFor(() => expect(writes()[0]).toMatchObject({ path: `${URL}/cardio/11`, method: "DELETE" }));
  });

  it("guarda el peso con coma decimal y rechaza lo que no es un peso", async () => {
    const { writes } = api(day(), () => day({ weight_kg: 72.4 }));
    renderApp(<TodayPage />);
    await openSheet("weight");
    const input = await screen.findByTestId("weight-input");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("Escribe un número, p. ej. 72,4")).toBeTruthy();
    fireEvent.change(input, { target: { value: "72,4" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(writes()[0]?.body).toEqual({ weight_kg: 72.4 }));
    expect((await screen.findByTestId("weight-saved")).textContent).toBe("Guardado: 72,4 kg");
  });

  it("F28: con dos pesajes hoy dice que cuenta la media del día", async () => {
    api(day({ weight_kg: 80.1, day_weight: { kg: 80.3, count: 2 } }));
    renderApp(<TodayPage />);
    await openSheet("weight");
    expect((await screen.findByTestId("weight-day-mean")).textContent).toBe("Hoy hay 2 pesajes: cuenta la media del día, 80,3 kg.");
  });

  it("F6: «Cambiar» lleva a apuntar en Nutrición lo que se comió", async () => {
    api(day());
    renderApp(<TodayPage />);
    expect(screen.queryByTestId("meal-breakfast-log")).toBeNull();
    fireEvent.click(await screen.findByTestId("meal-breakfast-changed"));
    expect(screen.getByTestId("meal-breakfast-log").getAttribute("href")).toBe("/nutrition");
  });

  it("F26: con un golpe en la cabeza y una lesión, el plan del día lo dice al momento con su evidencia", async () => {
    api(day({
      plan: {
        id: 3, week_start: "2026-10-26", type: "gym", no_contact: true,
        entries: [
          { kind: "gym", time: "18:00", session: "A", exercises: ["Sentadilla", "Press banca"], paused: ["Sentadilla"] },
          { kind: "mma", time: "20:00", contact_blocked: true },
        ],
      },
    }));
    renderApp(<TodayPage />);
    const plan = await screen.findByTestId("day-plan");
    const head = within(plan).getByTestId("plan-head-blow");
    expect(head.textContent).toContain("el día del golpe no entrenes");
    expect(within(head).getAllByTestId("evidence-chip")).toHaveLength(2); // el bloqueo y la vuelta por fases
    const paused = within(plan).getByTestId("plan-paused");
    expect(paused.textContent).toContain("En pausa por tu lesión");
    expect(paused.textContent).toContain("Sentadilla");
    expect(within(paused).getByTestId("evidence-chip")).toBeTruthy();
    expect(within(plan).getByTestId("plan-contact-blocked").textContent).toContain("Sin contacto");
  });

  it("con no_weight_targets no pide el peso y lo explica", async () => {
    api(day({ weight_blocked: true }));
    renderApp(<TodayPage />);
    await openSheet("weight");
    const box = await screen.findByTestId("weight");
    expect(box.textContent).toContain("El peso no se apunta por ahora");
    expect(screen.queryByTestId("weight-input")).toBeNull();
  });

  it("sin plan ni menú enseña a qué pantalla ir", async () => {
    api(day({ plan: null, day_type: null, menu: null, next_meal: null, cardio: { sessions: [], week: { ...WEEK, minutes: 0, equivalent: 0 }, types: TYPES } }));
    renderApp(<TodayPage />);
    expect((await screen.findByTestId("next-meal")).textContent).toContain("Hoy no hay menú.");
    expect(screen.getByRole("link", { name: "Preparar menú" }).getAttribute("href")).toBe("/nutrition/menu");
    expect(screen.getByRole("link", { name: "Crear el plan" }).getAttribute("href")).toBe("/training/plan");
    expect(screen.getByText("Sin plan: marca qué toca.")).toBeTruthy();
    expect(screen.queryByTestId("meals")).toBeNull();
    await openSheet("cardio");
    expect(screen.getByText("Hoy no hay cardio apuntado.")).toBeTruthy();
  });

  it("los minutos de MMA llevan su etiqueta de convención", async () => {
    api(day({ cardio: { sessions: [], week: { ...WEEK, mma_minutes: 60, mma_convention: "fightlab" }, types: TYPES } }));
    renderApp(<TodayPage />);
    await openSheet("cardio");
    const text = await screen.findByText(/Incluye 60 min de MMA/);
    expect(within(text).getByTestId("evidence-chip").getAttribute("data-variant")).toBe("convention");
  });

  it("en inglés, sin restos en español", async () => {
    api(day({ next_meal: { all_done: true } }));
    renderApp(<TodayPage />, "en");
    expect((await screen.findByTestId("next-meal")).textContent).toContain("Today's menu: all ticked ✓");
    expect(screen.getByTestId("toggle-trained").textContent).toBe("Workout done");
    expect(screen.getByTestId("quick-checkin").textContent).toContain("Pending");
    expect(screen.getByText("Today's workout")).toBeTruthy();
    fireEvent.click(screen.getByTestId("quick-cardio"));
    expect((await screen.findByTestId("cardio-week")).textContent).toBe("This week: 80 of 150 min");
  });

  it("el panel de peso es un diálogo accesible: foco dentro, Escape lo cierra y el foco vuelve al botón", async () => {
    api(day());
    renderApp(<TodayPage />);
    const opener = await screen.findByTestId("quick-weight");
    opener.focus();
    fireEvent.click(opener);
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    const title = document.getElementById(dialog.getAttribute("aria-labelledby")!);
    expect(title?.textContent).toBe("Peso");
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("el atajo /today#weight abre el panel de peso", async () => {
    window.location.hash = "#weight";
    try {
      api(day());
      renderApp(<TodayPage />);
      expect(await screen.findByRole("dialog")).toBeTruthy();
      expect(screen.getByTestId("weight-input")).toBeTruthy();
    } finally {
      window.location.hash = "";
    }
  });

  it("el atajo /today#next-meal baja a la próxima comida y le da el foco", async () => {
    window.location.hash = "#next-meal";
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    try {
      api(day());
      renderApp(<TodayPage />);
      const next = await screen.findByTestId("next-meal");
      await waitFor(() => expect(document.activeElement).toBe(next));
      expect(scroll).toHaveBeenCalled();
    } finally {
      window.location.hash = "";
    }
  });

  it("el acceso de check-in dice si falta o si ya está hecho, y lleva a /checkin", async () => {
    mockApi({ [URL]: { body: day() }, "/api/proxy/coach/checkin": { body: { date: "2026-10-29", checkin: null, weight_blocked: false, weekly_questions: [], readiness: READINESS } } });
    const first = renderApp(<TodayPage />);
    const todo = await screen.findByTestId("quick-checkin");
    expect(todo.getAttribute("href")).toBe("/checkin");
    await waitFor(() => expect(todo.textContent).toContain("Pendiente"));
    first.unmount();

    mockApi({
      [URL]: { body: day() },
      "/api/proxy/coach/checkin": {
        body: {
          date: "2026-10-29", weight_blocked: false, weekly_questions: [], readiness: READINESS,
          checkin: { date: "2026-10-29", weight_kg: null, waist_cm: null, intake_kcal: null, resting_heart_rate: null, hrv_ms: null, sleep_hours: 7, sleep_quality: 4, energy: 4, soreness: 4, stress: 4, mood: 4, soreness_zones: [], illness: null, notes: "", period_status: null, hormonal_contraception: null, bp_systolic: null, bp_diastolic: null },
        },
      },
    });
    renderApp(<TodayPage />);
    await waitFor(() => expect(screen.getByTestId("quick-checkin").textContent).toContain("Hecho hoy"));
  });

  it("el chip de estado va en verde sin avisos y no pinta el aviso completo", async () => {
    mockApi({ [URL]: { body: day() }, "/api/proxy/coach/safety": { body: SAFETY } });
    renderApp(<TodayPage />);
    expect((await screen.findByTestId("today-status")).textContent).toBe("Todo en orden");
    expect(screen.queryByTestId("safety-banner")).toBeNull();
  });

  it("con no_training el chip dice «Sin entrenar hasta revisión médica»", async () => {
    mockApi({
      [URL]: { body: day() },
      "/api/proxy/coach/safety": { body: { ...SAFETY, flags: { no_training: true } } },
    });
    renderApp(<TodayPage />);
    await waitFor(() => expect(screen.getByTestId("today-status").textContent).toContain("Sin entrenar hasta revisión médica"));
  });

  it("si el servidor no responde, deja reintentar", async () => {
    mockApi({ [URL]: { status: 503 } });
    renderApp(<TodayPage />);
    expect(await screen.findByText("No se ha podido cargar el parte de hoy. Prueba otra vez.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });
});
