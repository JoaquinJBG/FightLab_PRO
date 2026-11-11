import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { mockApi, renderApp } from "../support/app";
import { BENCH, ex } from "../exercises/fixtures";
import RoutinesPage from "@/app/(shell)/training/routines/page";
import ProgramsPage from "@/app/(shell)/training/routines/programs/page";
import { RoutineEditor } from "@/components/routines/RoutineEditor";
import { PlanRoutines } from "@/components/routines/PlanRoutines";
import type { Folder, Routine, RoutineSummary } from "@/lib/routines";

// Rutinas (F17 R): lista con carpetas, editor (series por tipo, descanso, superseries,
// reordenar con botones), programas y «Mi rutina» del plan.

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => nav,
  useSearchParams: () => ({ get: () => null }),
}));
// El selector de E tiene sus propias pruebas: aquí devuelve dos ejercicios al abrirse.
const ROW = ex({ key: "cat:barbell-row", name: "Remo con barra", equipment: ["barbell"] });
const CURL = ex({ key: "cat:biceps-curl", name: "Curl bíceps", equipment: ["dumbbell"] });
vi.mock("@/components/exercises/ExercisePicker", () => ({
  ExercisePicker: ({ onSelect, onClose }: { onSelect: (e: unknown) => void; onClose: () => void }) => (
    <button
      type="button"
      onClick={() => {
        onSelect(ROW);
        onSelect(CURL);
        onClose();
      }}
    >
      picker-add
    </button>
  ),
}));

const summary = (over: Partial<RoutineSummary>): RoutineSummary => ({
  id: 1, title: "Torso A", notes: "", folder: null, order: 0, source: "user", source_ref: "", exercise_count: 2,
  set_count: 6, exercise_names: ["Press banca", "Remo con barra"], exercise_keys: ["cat:barbell-bench-press", "cat:barbell-row"],
  updated_at: "2026-11-09T10:00:00Z", ...over,
});
const FOLDER: Folder = { id: 5, name: "Fuerza", order: 0, kind: "user", program_slug: "", routine_count: 2 };

const ROUTINE: Routine = {
  id: 7, title: "Torso A", notes: "", folder: null, order: 0, source: "user", source_ref: "",
  created_at: "", updated_at: "2026-11-09T10:00:00Z",
  exercises: [
    {
      id: 1, order: 0, exercise_key: "cat:barbell-bench-press", name: "Press banca", superset: null, notes: "", rest_s: 150,
      sets: [
        { set_type: "warmup", reps: 10, reps_max: null, weight_kg: 40, rpe: null, rir: null },
        { set_type: "normal", reps: 8, reps_max: 10, weight_kg: 70, rpe: null, rir: 2 },
      ],
    },
    { id: 2, order: 1, exercise_key: "cat:barbell-row", name: "Remo con barra", superset: null, notes: "", rest_s: 120, sets: [] },
  ],
};

beforeEach(() => {
  nav.push.mockClear();
  nav.replace.mockClear();
  localStorage.clear();
});

function lastBody(fetchMock: ReturnType<typeof mockApi>, url: string) {
  const call = [...fetchMock.mock.calls].reverse().find(([u]) => String(u).startsWith(url));
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
}

describe("lista de rutinas", () => {
  it("pinta las carpetas y las rutinas sin carpeta, con «Empezar» hacia el registro", async () => {
    mockApi({
      "/api/proxy/gym/routines": { body: [summary({ id: 1, folder: 5 }), summary({ id: 2, title: "Pierna", folder: null, order: 0 })] },
      "/api/proxy/gym/routine-folders": { body: [FOLDER] },
    });
    renderApp(<RoutinesPage />);
    const folders = await screen.findAllByTestId("routine-folder");
    expect(folders.map((f) => f.getAttribute("data-folder-id"))).toEqual(["5", "none"]);
    expect(within(folders[0]).getByText("Torso A")).toBeTruthy();
    expect(within(folders[1]).getByText("Pierna")).toBeTruthy();
    const starts = screen.getAllByTestId("routine-start");
    expect(starts[0].getAttribute("href")).toBe("/training/gym/session?routine=1");
    expect(screen.getAllByTestId("routine-edit")[1].getAttribute("href")).toBe("/training/routines/2");
    expect(screen.getAllByText("2 ejercicios · 6 series", { exact: false })).toHaveLength(2);
  });

  it("sin rutinas invita a crear una o cargar un programa", async () => {
    mockApi({ "/api/proxy/gym/routines": { body: [] }, "/api/proxy/gym/routine-folders": { body: [] } });
    renderApp(<RoutinesPage />);
    expect(await screen.findByTestId("routines-empty")).toBeTruthy();
    expect(screen.getByTestId("programs-link").getAttribute("href")).toBe("/training/routines/programs");
  });

  it("reordena con los botones (alternativa accesible al arrastre)", async () => {
    const fetchMock = mockApi({
      "/api/proxy/gym/routines": { body: [summary({ id: 1, order: 0 }), summary({ id: 2, title: "Pierna", order: 1 })] },
      "/api/proxy/gym/routine-folders": { body: [] },
      "/api/proxy/gym/routines/reorder": { body: { ok: true } },
    });
    renderApp(<RoutinesPage />);
    await screen.findAllByTestId("routine-card");
    fireEvent.click(screen.getByLabelText("Más opciones de Pierna"));
    fireEvent.click(screen.getByLabelText("Subir Pierna"));
    await waitFor(() => expect(lastBody(fetchMock, "/api/proxy/gym/routines/reorder")).toEqual({ folder: null, ids: [2, 1] }));
  });

  it("borrar pide confirmación", async () => {
    const fetchMock = mockApi({
      "/api/proxy/gym/routines": { body: [summary({ id: 1 })] },
      "/api/proxy/gym/routine-folders": { body: [] },
      "/api/proxy/gym/routines/1": { status: 204 },
    });
    renderApp(<RoutinesPage />);
    fireEvent.click(await screen.findByLabelText("Más opciones de Torso A"));
    fireEvent.click(screen.getByRole("button", { name: "Borrar" }));
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByTestId("routine-delete-confirm"));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([u, init]) => String(u) === "/api/proxy/gym/routines/1" && (init as RequestInit)?.method === "DELETE")).toBe(true),
    );
  });
});

describe("editor", () => {
  const api = () =>
    mockApi({
      "/api/proxy/gym/routine-folders": { body: [FOLDER] },
      "/api/proxy/gym/exercises": { body: [BENCH, ROW, CURL] },
      "/api/proxy/gym/routines/7": (init) => ({ body: init?.body ? { ...ROUTINE, ...JSON.parse(String(init.body)), id: 7 } : ROUTINE }),
      "/api/proxy/gym/routines": { status: 201, body: { ...ROUTINE, id: 9 } },
    });
  const initial = () => ({
    title: ROUTINE.title, notes: "", folder: null,
    exercises: ROUTINE.exercises.map(({ id, order, ...e }) => (void id, void order, e)),
  });

  it("añade ejercicios con el selector y 3 series, y guarda la rutina entera", async () => {
    const fetchMock = api();
    renderApp(<RoutineEditor id={null} />);
    fireEvent.change(screen.getByTestId("routine-title"), { target: { value: "Tirón" } });
    fireEvent.click(screen.getByTestId("exercise-add"));
    fireEvent.click(screen.getByText("picker-add"));
    const blocks = screen.getAllByTestId("routine-exercise");
    expect(blocks.map((b) => b.getAttribute("data-exercise-key"))).toEqual(["cat:barbell-row", "cat:biceps-curl"]);
    expect(within(blocks[0]).getAllByTestId("set-row")).toHaveLength(3);
    fireEvent.click(screen.getByTestId("routine-save"));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/training/routines/9"));
    const body = lastBody(fetchMock, "/api/proxy/gym/routines");
    expect(body.title).toBe("Tirón");
    expect(body.exercises.map((e: { exercise_key: string }) => e.exercise_key)).toEqual(["cat:barbell-row", "cat:biceps-curl"]);
    // Descanso por defecto: 2 min con barra, 90 s con mancuernas.
    expect(body.exercises.map((e: { rest_s: number }) => e.rest_s)).toEqual([120, 90]);
    expect(body.exercises[0]).not.toHaveProperty("_uid");
  });

  it("R4-7: el descanso que enseña el editor es el que se guarda, y «Sin temporizador» se guarda como 0", async () => {
    const fetchMock = api();
    renderApp(<RoutineEditor id={null} />);
    fireEvent.change(screen.getByTestId("routine-title"), { target: { value: "Tirón" } });
    fireEvent.click(screen.getByTestId("exercise-add"));
    fireEvent.click(screen.getByText("picker-add"));
    const [row, curl] = screen.getAllByTestId("routine-exercise");
    // Se ve lo que se guarda: 2:00 con barra y 1:30 con mancuernas, no «Sin temporizador».
    expect((within(row).getByTestId("exercise-rest") as HTMLSelectElement).value).toBe("120");
    expect(within(row).getByDisplayValue("2:00")).toBeTruthy();
    expect(within(curl).getByDisplayValue("1:30")).toBeTruthy();
    // Sin temporizador: se guarda 0 (la sesión no arranca el descanso), no null (= el de por defecto).
    fireEvent.change(within(curl).getByTestId("exercise-rest"), { target: { value: "0" } });
    expect(within(curl).getByDisplayValue("Sin temporizador")).toBeTruthy();
    fireEvent.click(screen.getByTestId("routine-save"));
    await waitFor(() => expect(nav.replace).toHaveBeenCalled());
    expect(lastBody(fetchMock, "/api/proxy/gym/routines").exercises.map((e: { rest_s: number }) => e.rest_s)).toEqual([120, 0]);
  });

  it("R4-7: sin descanso elegido sale «Por defecto» y se guarda null", async () => {
    const fetchMock = api();
    renderApp(<RoutineEditor id={7} initial={{ ...initial(), exercises: [{ ...initial().exercises[0], rest_s: null }] }} />);
    expect(within(screen.getByTestId("routine-exercise")).getByDisplayValue("Por defecto")).toBeTruthy();
    fireEvent.change(screen.getByTestId("routine-title"), { target: { value: "Torso B" } });
    fireEvent.click(screen.getByTestId("routine-save"));
    await waitFor(() => expect(lastBody(fetchMock, "/api/proxy/gym/routines/7")).toBeTruthy());
    expect(lastBody(fetchMock, "/api/proxy/gym/routines/7").exercises[0].rest_s).toBeNull();
  });

  it("R4-12: las etiquetas de cada serie llevan el nombre del ejercicio", () => {
    api();
    renderApp(<RoutineEditor id={7} initial={initial()} />);
    const [bench] = screen.getAllByTestId("routine-exercise");
    expect(within(bench).getByLabelText("Kilos de la serie 1 de Press banca")).toBeTruthy();
    expect(within(bench).getByLabelText("Repeticiones de la serie 2 de Press banca")).toBeTruthy();
    expect(within(bench).getByLabelText("Repeticiones máximas de la serie 2 de Press banca")).toBeTruthy();
    expect(within(bench).getByLabelText("RIR de la serie 2 de Press banca")).toBeTruthy();
    expect(within(bench).getByLabelText("Quitar la serie 1 de Press banca")).toBeTruthy();
  });

  it("sin título no guarda y lo dice", () => {
    const fetchMock = api();
    renderApp(<RoutineEditor id={null} />);
    fireEvent.click(screen.getByTestId("routine-save"));
    expect(screen.getByRole("alert").textContent).toBe("Ponle un nombre a la rutina.");
    expect(fetchMock.mock.calls.some(([, init]) => (init as RequestInit)?.method === "POST")).toBe(false);
  });

  it("series por tipo, descanso, superserie y reordenar; PUT con todo", async () => {
    const fetchMock = api();
    renderApp(<RoutineEditor id={7} initial={initial()} />);
    const [bench] = screen.getAllByTestId("routine-exercise");
    // La de calentamiento lleva su letra; las normales, número.
    const rows = within(bench).getAllByTestId("set-row");
    expect(rows.map((r) => r.getAttribute("data-set-type"))).toEqual(["warmup", "normal"]);
    // Copiar la serie anterior y pasarla a drop set.
    fireEvent.click(within(bench).getByTestId("set-add"));
    const third = within(bench).getAllByTestId("set-row")[2];
    fireEvent.change(within(third).getByTestId("set-type"), { target: { value: "drop" } });
    fireEvent.change(within(bench).getByTestId("exercise-rest"), { target: { value: "180" } });
    // Superserie con el siguiente.
    fireEvent.click(within(bench).getByTestId("superset-link"));
    expect(screen.getAllByTestId("superset-label").map((l) => l.textContent)).toEqual(["Superserie A", "Superserie A"]);
    // Bajar el press banca con el botón.
    fireEvent.click(screen.getByLabelText("Bajar Press banca"));
    expect(screen.getAllByTestId("routine-exercise").map((b) => b.getAttribute("data-exercise-key"))).toEqual([
      "cat:barbell-row", "cat:barbell-bench-press",
    ]);
    fireEvent.click(screen.getByTestId("routine-save"));
    await waitFor(() => expect(lastBody(fetchMock, "/api/proxy/gym/routines/7")).toBeTruthy());
    const body = lastBody(fetchMock, "/api/proxy/gym/routines/7");
    const [row, benchOut] = body.exercises;
    expect(row.superset).toBe(0);
    expect(benchOut.superset).toBe(0);
    expect(benchOut.rest_s).toBe(180);
    expect(benchOut.sets[2]).toEqual({ set_type: "drop", reps: 8, reps_max: 10, weight_kg: 70, rpe: null, rir: 2 });
  });

  it("el peso admite coma y rechaza dos separadores con aviso", () => {
    api();
    renderApp(<RoutineEditor id={7} initial={initial()} />);
    const [bench] = screen.getAllByTestId("routine-exercise");
    const kg = within(bench).getAllByTestId("set-kg")[1] as HTMLInputElement;
    fireEvent.change(kg, { target: { value: "72,5" } });
    fireEvent.blur(kg);
    expect(kg.value).toBe("72.5");
    fireEvent.change(kg, { target: { value: "7,2,5" } });
    fireEvent.blur(kg);
    expect(kg.getAttribute("aria-invalid")).toBe("true");
    expect(kg.title).toBe("Escribe un número (con coma o punto, una sola vez).");
    fireEvent.change(kg, { target: { value: "1500" } });
    fireEvent.blur(kg);
    expect(kg.title).toBe("Tiene que estar entre 0 y 1000.");
  });

  it("RIR → RPE convierte con la escala de RPE (RPE 10 = 0 RIR)", () => {
    api();
    renderApp(<RoutineEditor id={7} initial={initial()} />);
    const [bench] = screen.getAllByTestId("routine-exercise");
    fireEvent.click(within(bench).getByTestId("effort-toggle"));
    expect((within(bench).getAllByTestId("set-rpe")[1] as HTMLInputElement).value).toBe("8");
  });

  it("guardada y sin cambios, «Empezar entreno» va al registro con la rutina", () => {
    api();
    renderApp(<RoutineEditor id={7} initial={initial()} />);
    expect(screen.getByTestId("routine-start").getAttribute("href")).toBe("/training/gym/session?routine=7");
    fireEvent.change(screen.getByTestId("routine-title"), { target: { value: "Otro" } });
    expect(screen.queryByTestId("routine-start")).toBeNull();
    expect(screen.getByTestId("routine-save-start")).toBeTruthy();
  });
});

describe("programas", () => {
  it("lista con su etiqueta de convención y sus reglas, y carga uno", async () => {
    const fetchMock = mockApi({
      "/api/proxy/gym/programs": {
        body: [
          {
            slug: "full-body-3", title: "Cuerpo completo, 3 días", description: "Tres sesiones", days_per_week: 3,
            level: "beginner", source: "FightLab convention", source_note: "Estructura habitual", convention: true,
            rules: [{ key: "strength-hypertrophy/full-body-versus-split", grade: "moderate", title: "Full-body versus split" }],
            routines: [{ key: "a", title: "Cuerpo completo A", exercise_count: 5 }],
          },
        ],
      },
      "/api/proxy/gym/programs/full-body-3/load": { status: 201, body: { folder: FOLDER, routines: [] } },
    });
    renderApp(<ProgramsPage />);
    const card = await screen.findByTestId("program-card");
    expect(within(card).getByText("3 días/sem")).toBeTruthy();
    const chips = within(card).getAllByTestId("evidence-chip");
    expect(chips[0].getAttribute("data-variant")).toBe("convention");
    expect(chips).toHaveLength(2);
    fireEvent.click(within(card).getByTestId("program-load"));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith("/training/routines"));
    expect(fetchMock.mock.calls.some(([u]) => String(u) === "/api/proxy/gym/programs/full-body-3/load")).toBe(true);
  });
});

describe("Mi rutina: rutinas del plan", () => {
  const status = (over: object) => ({
    plan_id: 3, week_start: "2026-10-26", folder: { ...FOLDER, kind: "plan" }, routines: [], in_sync: false, edited: [], ...over,
  });

  it("sin cambios del usuario, un plan nuevo se convierte en rutinas sin preguntar", async () => {
    const fetchMock = mockApi({
      "/api/proxy/gym/plan-routines": { body: status({}) },
      "/api/proxy/gym/routine-folders": { body: [] },
      "/api/proxy/gym/plan-routines/sync": { body: status({ in_sync: true }) },
    });
    await act(async () => {
      renderApp(<PlanRoutines planId={3} />);
    });
    await waitFor(() => expect(lastBody(fetchMock, "/api/proxy/gym/plan-routines/sync")).toEqual({}));
  });

  it("con una rutina editada pregunta: mantener o sustituir", async () => {
    const fetchMock = mockApi({
      "/api/proxy/gym/plan-routines": {
        body: status({ routines: [summary({ id: 4, title: "Sesión A", source: "plan", edited: true })], edited: [4] }),
      },
      "/api/proxy/gym/routine-folders": { body: [] },
      "/api/proxy/gym/plan-routines/sync": { body: status({ in_sync: true }) },
    });
    renderApp(<PlanRoutines planId={3} />);
    const box = await screen.findByTestId("plan-routines-edited");
    expect(box.textContent).toContain("Sesión A");
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/sync"))).toBe(false);
    fireEvent.click(screen.getByTestId("plan-routines-keep"));
    await waitFor(() => expect(lastBody(fetchMock, "/api/proxy/gym/plan-routines/sync")).toEqual({ on_edited: "keep" }));
  });
});
