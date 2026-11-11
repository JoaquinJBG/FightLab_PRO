import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expectClean, renderEn } from "./i18nB-helpers";
import GymSessionPage from "@/app/(shell)/training/gym/session/page";
import { GYM_LIVE_KEY } from "@/lib/gym";

// F17 (rama H): empezar desde una rutina con el `start` del contrato (simulado), tipos de serie,
// RPE/RIR, superseries, notas, descanso por ejercicio, discos, récords y guardado con motivo (F2).

const m = vi.hoisted(() => ({
  routine: null as string | null,
  push: vi.fn(),
  save: vi.fn(),
  saveResult: { status: "created", id: 7 } as unknown,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: m.push }),
  useSearchParams: () => ({ get: (k: string) => (k === "routine" ? m.routine : null) }),
}));
vi.mock("@/lib/activities", async (orig) => ({
  ...(await orig<typeof import("@/lib/activities")>()),
  fetchServerActivities: vi.fn(async () => null),
  pendingQueueItems: () => [],
  saveActivityNow: async (item: unknown) => { m.save(item); return m.saveResult; },
}));
vi.mock("@/lib/plan", () => ({ useWeeklyPlan: () => ({ data: undefined }) }));
vi.mock("@/lib/session-check", async (orig) => ({ ...(await orig<typeof import("@/lib/session-check")>()), useSessionCheck: () => ({ data: undefined }) }));
vi.mock("@/lib/strength", async (orig) => ({ ...(await orig<typeof import("@/lib/strength")>()), useLastStats: () => ({ data: undefined }) }));

// Contrato de `GET gym/routines/<id>/start` (rama R) y récords previos (`GET gym/records`)
const START = {
  routine_id: 5,
  title: "Torso A",
  exercises: [
    { exercise_key: "cat:barbell-bench-press", name: "Bench press", notes: "Pause 1 s", rest_s: 120, superset: null,
      sets: [{ set_type: "warmup", reps: 10, reps_max: null, weight_kg: 40, rpe: null, rir: null },
             { set_type: "normal", reps: 6, reps_max: 8, weight_kg: 80, rpe: 8, rir: null }] },
    { exercise_key: "cat:barbell-row", name: "Barbell row", notes: "", rest_s: 90, superset: 1,
      sets: [{ set_type: "normal", reps: 8, reps_max: null, weight_kg: 60, rpe: null, rir: null }] },
    { exercise_key: "custom:3", name: "Face pull", notes: "", rest_s: 60, superset: 1,
      sets: [{ set_type: "normal", reps: 15, reps_max: null, weight_kg: 20, rpe: null, rir: null }] },
  ],
  safety: { blocked: false, paused: [], reasons: [] },
};
const RECORDS = {
  records: {
    "cat:barbell-bench-press": {
      name: "Bench press", sessions: 3, max_weight_kg: 80, max_weight_date: "2026-11-01", max_reps: 10,
      best_e1rm_kg: 96, best_e1rm_date: "2026-11-01", best_set_volume_kg: 480, best_session_volume_kg: 1400,
      reps_by_weight: [{ weight_kg: 80, reps: 6, date: "2026-11-01" }],
    },
  },
  convention: "coach",
};

const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
  if (url.includes("/gym/routines/5/start")) return json(START);
  if (url.includes("/gym/routines/5") && init?.method === "PATCH") return json({ id: 5 });
  if (url.includes("/gym/records")) return json(RECORDS);
  return json({}, 404);
});

beforeEach(() => {
  localStorage.clear();
  m.routine = "5";
  m.push.mockClear();
  m.save.mockClear();
  m.saveResult = { status: "created", id: 7 };
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function openRoutine() {
  const r = renderEn(<GymSessionPage />);
  await screen.findByText("Torso A");
  await screen.findByText("Bench press");
  return r;
}

describe("Empezar desde una rutina", () => {
  it("carga el borrador del start: tipos, cargas, notas, descanso y superserie", async () => {
    const { container } = await openRoutine();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/gym/routines/5/start"), expect.anything());
    // la serie de calentamiento lleva su letra y la normal, su número
    const types = screen.getAllByTestId("set-type").map((b) => b.textContent);
    expect(types.slice(0, 2)).toEqual(["W", "1"]);
    expect((screen.getAllByLabelText("Weight, set 2")[0] as HTMLInputElement).value).toBe("80");
    expect((screen.getAllByLabelText("RPE, set 2")[0] as HTMLInputElement).value).toBe("8");
    expect((screen.getByLabelText("Note for Bench press") as HTMLTextAreaElement).value).toBe("Pause 1 s");
    expect((screen.getByLabelText("Rest for Bench press") as HTMLSelectElement).value).toBe("120");
    expect(screen.getAllByText("Superset A")).toHaveLength(2);
    expectClean(container, ["Torso A"]);
  });

  it("al terminar ofrece actualizar la rutina con lo hecho", async () => {
    await openRoutine();
    fireEvent.click(screen.getAllByLabelText("Set 2 done")[0]);
    fireEvent.click(screen.getByText("Finish workout"));
    fireEvent.click(screen.getByText("Finish anyway"));
    fireEvent.click(screen.getByLabelText(/Update the routine “Torso A”/));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(m.push).toHaveBeenCalledWith("/training/gym?saved=1"));
    const patch = fetchMock.mock.calls.find(([u, i]) => String(u).endsWith("/gym/routines/5") && i?.method === "PATCH");
    expect(JSON.parse(String(patch![1]!.body))).toEqual({
      exercises: [{ exercise_key: "cat:barbell-bench-press", name: "Bench press", notes: "Pause 1 s", rest_s: 120, superset: null,
        sets: [{ set_type: "normal", reps: 6, reps_max: null, weight_kg: 80, rpe: 8, rir: null }] }],
    });
    expect(m.save.mock.calls[0][0].detail.routine_id).toBe(5);
  });
});

describe("Registrar", () => {
  it("cambia el tipo de serie y guarda la clave, el tipo, el RPE y la superserie", async () => {
    await openRoutine();
    fireEvent.click(screen.getAllByTestId("set-type")[1]); // normal → calentamiento
    expect(screen.getAllByTestId("set-type")[1].textContent).toBe("W");
    fireEvent.click(screen.getAllByTestId("set-type")[1]); // → drop
    expect(screen.getAllByTestId("set-type")[1].textContent).toBe("D");
    fireEvent.click(screen.getAllByLabelText("Set 2 done")[0]);
    fireEvent.click(screen.getAllByLabelText("Set 1 done")[1]); // remo (superserie A)
    fireEvent.click(screen.getByText("Finish workout"));
    fireEvent.click(screen.getByText("Finish anyway"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(m.save).toHaveBeenCalled());
    expect(m.save.mock.calls[0][0].sets).toEqual([
      { exercise: "Bench press", exercise_key: "cat:barbell-bench-press", exercise_index: 0, set_index: 0, weight_kg: 80, reps: 6,
        set_type: "drop", rpe: 8, notes: "Pause 1 s", rest_s: 120 },
      { exercise: "Barbell row", exercise_key: "cat:barbell-row", exercise_index: 1, set_index: 0, weight_kg: 60, reps: 8,
        superset: 1, rest_s: 90 },
    ]);
  });

  it("superserie: tras el primero pasa al segundo sin descanso; tras el segundo, descanso", async () => {
    await openRoutine();
    fireEvent.click(screen.getAllByLabelText("Set 1 done")[1]);
    expect(screen.queryByTestId("rest-bar")).toBeNull();
    expect(screen.getByText("Next in the superset: Face pull →")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Set 1 done")[2]);
    expect(screen.getByTestId("rest-bar")).toBeTruthy();
  });

  it("RIR en lugar de RPE, y el descanso por ejercicio", async () => {
    await openRoutine();
    fireEvent.click(screen.getByRole("button", { name: "RIR" }));
    fireEvent.change(screen.getAllByLabelText("RIR, set 2")[0], { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Rest for Bench press"), { target: { value: "180" } });
    fireEvent.click(screen.getAllByLabelText("Set 2 done")[0]);
    expect(screen.getByTestId("rest-bar").textContent).toMatch(/1[78]\ds/);
  });

  it("F2: el peso admite una sola coma, avisa de lo imposible y no deja marcarlo", async () => {
    await openRoutine();
    const kg = screen.getAllByLabelText("Weight, set 2")[0] as HTMLInputElement;
    fireEvent.change(kg, { target: { value: "9295,." } });
    expect(kg.value).toBe("9295,");
    expect(screen.getByRole("alert").textContent).toContain("More than 1000 kg is not possible");
    expect((screen.getAllByLabelText("Set 2 done")[0] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(kg, { target: { value: "520" } });
    expect(screen.getByTestId("set-issue").textContent).toContain("More than 500 kg");
  });

  it("el resumen enseña lo que se guarda y el 400 del servidor sale con su motivo", async () => {
    m.saveResult = { status: "invalid", errors: { sets: [{ weight_kg: ["Ensure this value is less than or equal to 1000."] }] } };
    await openRoutine();
    fireEvent.click(screen.getAllByLabelText("Set 1 done")[0]);
    fireEvent.click(screen.getAllByLabelText("Set 2 done")[0]);
    fireEvent.click(screen.getByText("Finish workout"));
    fireEvent.click(screen.getByText("Finish anyway"));
    expect(screen.getByTestId("summary-sets").textContent).toBe("2");
    expect(screen.getByTestId("summary-volume").textContent).toBe("880");
    expect(screen.getByTestId("summary-list").textContent).toContain("W 40 kg × 10");
    fireEvent.click(screen.getByText("Save"));
    expect((await screen.findByTestId("save-error")).textContent).toContain("less than or equal to 1000");
    expect(m.push).not.toHaveBeenCalled();
    expect(localStorage.getItem(GYM_LIVE_KEY)).not.toBeNull();
  });

  it("aviso al batir un récord", async () => {
    await openRoutine();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/gym/records"), expect.anything()));
    fireEvent.change(screen.getAllByLabelText("Weight, set 2")[0], { target: { value: "82,5" } });
    await waitFor(() => {
      fireEvent.click(screen.getAllByLabelText("Set 2 done")[0]);
      expect(screen.getByTestId("record-toast").textContent).toContain("New record on Bench press");
    });
    expect(screen.getByTestId("set-records").textContent).toContain("Weight record");
  });

  it("calculadora de discos con barra configurable", async () => {
    const { container } = await openRoutine();
    fireEvent.click(screen.getByLabelText("Options for Bench press"));
    fireEvent.click(screen.getByText("Plates"));
    const dialog = screen.getByRole("dialog", { name: "Plate calculator" });
    expect(screen.getByTestId("plates-result").textContent).toContain("On each side");
    fireEvent.change(screen.getByLabelText("Total weight (kg)"), { target: { value: "100" } });
    expect(screen.getByTestId("plates-result").textContent).toContain("25 + 15");
    fireEvent.change(screen.getByLabelText("Bar (kg)"), { target: { value: "15" } });
    expect(screen.getByTestId("plates-result").textContent).toContain("25 + 15 + 2.5");
    expect(dialog).toBeTruthy();
    expectClean(container, ["Torso A"]);
  });
});
