import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import TodayPage from "@/app/(shell)/today/page";
import type { TodayState } from "@/lib/today";
import { mockApi, renderApp } from "../support/app";

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));

afterEach(() => vi.unstubAllGlobals());

const URL = "/api/proxy/coach/today";

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
        { meal: "breakfast", free: false, tupper: false, dishes: ["Avena con yogur"], eve: null, mark: null },
        { meal: "lunch", free: false, tupper: true, dishes: ["Arroz con pollo"], eve: "Sacar el pollo", mark: null },
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

describe("Hoy", () => {
  it("pinta la próxima comida, el plan del día, las comidas y el cardio de la semana con su chip", async () => {
    api(day());
    renderApp(<TodayPage />);
    const next = await screen.findByTestId("next-meal");
    expect(next.textContent).toContain("Desayuno: Avena con yogur");
    const plan = screen.getByTestId("day-plan");
    expect(plan.textContent).toContain("Gimnasio, sesión A");
    expect(plan.textContent).toContain("a las 18:00");
    expect(plan.textContent).toContain("Sentadilla · Press banca");
    expect(within(plan).getByRole("link", { name: /Empezar la sesión A/ }).getAttribute("href")).toBe("/training/gym?plan=A");
    expect(screen.getByTestId("meal-lunch").textContent).toContain("Para la víspera: Sacar el pollo");
    expect(screen.getByTestId("cardio-week").textContent).toBe("Esta semana: 80 de 150 min");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("80");
    const chips = within(screen.getByTestId("cardio")).getAllByTestId("evidence-chip");
    expect(chips[0].getAttribute("data-grade")).toBe("strong");
    // La de Deportes no se borra aquí; la apuntada en Hoy sí.
    const sessions = screen.getAllByTestId("cardio-session");
    expect(sessions[0].textContent).toContain("Paseo");
    expect(sessions[1].textContent).toContain("Desde Deportes");
    expect(screen.getByRole("link", { name: /resumen/i }).getAttribute("href")).toBe("/dashboard");
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
    await waitFor(() => expect(screen.getByText("Según el plan de la semana.")).toBeTruthy());
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
    expect(await screen.findByText("En su lugar: pizza")).toBeTruthy();
    expect(screen.getByTestId("next-meal").textContent).toContain("Comida: Arroz con pollo");
  });

  it("hecha y no hecha se guardan con un toque, y la marca se puede quitar", async () => {
    const done = day({ menu: { ...day().menu!, meals: [{ ...day().menu!.meals[0], mark: { state: "done", change: null } }, day().menu!.meals[1]] } });
    const { writes } = api(day(), (body) => (body.state === null ? day() : done));
    renderApp(<TodayPage />);
    fireEvent.click(await screen.findByTestId("meal-breakfast-done"));
    await waitFor(() => expect(screen.getByTestId("meal-breakfast-done").getAttribute("aria-pressed")).toBe("true"));
    fireEvent.click(screen.getByRole("button", { name: "Quitar la marca" }));
    await waitFor(() => expect(writes().map((w) => w.body.state)).toEqual(["done", null]));
  });

  it("apunta una sesión de cardio con su intensidad y comprueba los minutos", async () => {
    const { writes } = api(day());
    renderApp(<TodayPage />);
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
    fireEvent.click(await screen.findByRole("button", { name: "Borrar Paseo, 40 min" }));
    await waitFor(() => expect(writes()[0]).toMatchObject({ path: `${URL}/cardio/11`, method: "DELETE" }));
  });

  it("guarda el peso con coma decimal y rechaza lo que no es un peso", async () => {
    const { writes } = api(day(), () => day({ weight_kg: 72.4 }));
    renderApp(<TodayPage />);
    const input = await screen.findByTestId("weight-input");
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.submit(input.closest("form")!);
    expect(await screen.findByText("Escribe un número, p. ej. 72,4")).toBeTruthy();
    fireEvent.change(input, { target: { value: "72,4" } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(writes()[0]?.body).toEqual({ weight_kg: 72.4 }));
    expect((await screen.findByTestId("weight-saved")).textContent).toBe("Guardado: 72,4 kg");
  });

  it("con no_weight_targets no pide el peso y lo explica", async () => {
    api(day({ weight_blocked: true }));
    renderApp(<TodayPage />);
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
    expect(screen.getByText("Hoy no hay cardio apuntado.")).toBeTruthy();
  });

  it("los minutos de MMA llevan su etiqueta de convención", async () => {
    api(day({ cardio: { sessions: [], week: { ...WEEK, mma_minutes: 60, mma_convention: "fightlab" }, types: TYPES } }));
    renderApp(<TodayPage />);
    const text = await screen.findByText(/Incluye 60 min de MMA/);
    expect(within(text).getByTestId("evidence-chip").getAttribute("data-variant")).toBe("convention");
  });

  it("en inglés, sin restos en español", async () => {
    api(day({ next_meal: { all_done: true } }));
    renderApp(<TodayPage />, "en");
    expect((await screen.findByTestId("next-meal")).textContent).toContain("Today's menu: all ticked ✓");
    expect(screen.getByTestId("cardio-week").textContent).toBe("This week: 80 of 150 min");
    expect(screen.getByTestId("toggle-trained").textContent).toBe("Workout doneNot yet");
    expect(screen.getByTestId("meal-breakfast").textContent).toContain("Breakfast");
  });

  it("si el servidor no responde, deja reintentar", async () => {
    mockApi({ [URL]: { status: 503 } });
    renderApp(<TodayPage />);
    expect(await screen.findByText("No se ha podido cargar el parte de hoy. Prueba otra vez.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
  });
});
