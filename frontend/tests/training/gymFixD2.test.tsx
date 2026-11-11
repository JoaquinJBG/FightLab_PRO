import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderApp } from "../support/app";
import GymSessionPage from "@/app/(shell)/training/gym/session/page";
import RecordsPage from "@/app/(shell)/training/gym/records/page";
import { GYM_LIVE_KEY } from "@/lib/gym";
import { bestRecord, nextWorkSetIndex } from "@/lib/gym-log";
import { effortModeOf } from "@/lib/gym-api";

// Fix D2 (ronda 4 de la prueba en móvil): R4-4 coma decimal, R4-7 modo de esfuerzo de la rutina,
// R4-8 «Usar X kg» a la serie que toca, R4-11 un criterio de récord, R4-14 sin borrador fantasma,
// R4-5 récords sin «— kg». Todo con datos inventados.

const m = vi.hoisted(() => ({
  routine: null as string | null,
  push: vi.fn(),
  stats: undefined as Record<string, unknown> | undefined,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: m.push }),
  useSearchParams: () => ({ get: (k: string) => (k === "routine" ? m.routine : null) }),
}));
vi.mock("@/lib/activities", async (orig) => ({
  ...(await orig<typeof import("@/lib/activities")>()),
  fetchServerActivities: vi.fn(async () => null),
  pendingQueueItems: () => [],
  saveActivityNow: async () => ({ status: "created", id: 7 }),
}));
vi.mock("@/lib/plan", () => ({ useWeeklyPlan: () => ({ data: undefined }) }));
vi.mock("@/lib/session-check", async (orig) => ({ ...(await orig<typeof import("@/lib/session-check")>()), useSessionCheck: () => ({ data: undefined }) }));
vi.mock("@/lib/strength", async (orig) => ({ ...(await orig<typeof import("@/lib/strength")>()), useLastStats: () => ({ data: m.stats }) }));

const SET = { reps_max: null, rpe: null, rir: null };
const START = {
  routine_id: 5,
  title: "Torso inventado",
  exercises: [
    { exercise_key: "cat:barbell-bench-press", name: "Press banca", notes: "", rest_s: 120, superset: null,
      sets: [{ ...SET, set_type: "warmup", reps: 10, weight_kg: 40 },
             { ...SET, set_type: "normal", reps: 6, weight_kg: 70, rir: 2 },
             { ...SET, set_type: "normal", reps: 6, weight_kg: 70, rir: 2 }] },
  ],
  safety: { blocked: false, paused: [], reasons: [] },
};
const RECORDS = {
  records: {
    "cat:barbell-bench-press": {
      name: "Press banca", sessions: 3, max_weight_kg: 80, max_weight_date: "2026-11-01", max_reps: 10,
      best_e1rm_kg: 96, best_e1rm_date: "2026-11-01", best_set_volume_kg: 480, best_session_volume_kg: 1400,
      reps_by_weight: [{ weight_kg: 80, reps: 6, date: "2026-11-01" }],
    },
  },
  convention: "coach",
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const fetchMock = vi.fn(async (url: string) => {
  if (url.includes("/gym/routines/5/start")) return json(START);
  if (url.includes("/gym/records")) return json(RECORDS);
  return json({}, 404);
});

beforeEach(() => {
  localStorage.clear();
  m.routine = "5";
  m.stats = undefined;
  m.push.mockClear();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const openRoutine = async () => {
  const r = renderApp(<GymSessionPage />);
  await screen.findByText("Press banca");
  return r;
};

describe("funciones puras", () => {
  it("R4-8: la siguiente serie por hacer que no es de calentamiento", () => {
    expect(nextWorkSetIndex([{ done: true, type: "warmup" }, { done: false }, { done: false }])).toBe(1);
    expect(nextWorkSetIndex([{ done: false, type: "warmup" }, { done: true }, { done: false }])).toBe(2);
    expect(nextWorkSetIndex([{ done: false, type: "warmup" }, { done: true }])).toBe(0); // solo queda calentamiento
    expect(nextWorkSetIndex([{ done: true }])).toBe(-1);
  });

  it("R4-11: de los récords que bate una serie cuenta el mejor", () => {
    expect(bestRecord(["reps", "volume", "e1rm", "weight"])).toEqual(["weight"]);
    expect(bestRecord(["reps", "volume"])).toEqual(["volume"]);
    expect(bestRecord([])).toEqual([]);
  });

  it("R4-7: el modo de esfuerzo sale de lo planificado", () => {
    const s = (rir: number | null, rpe: number | null) => ({ exercises: [{ sets: [{ rir, rpe }] }] }) as unknown as Parameters<typeof effortModeOf>[0];
    expect(effortModeOf(s(2, null))).toBe("rir");
    expect(effortModeOf(s(null, 8))).toBe("rpe");
    expect(effortModeOf(s(null, null))).toBeNull();
  });
});

describe("cabecera de la sesión (R4-4)", () => {
  it("coma decimal y e1RM con un decimal como mucho", async () => {
    m.stats = { "Press banca": { last: { date: "2026-11-01", sets: 4, reps: 8, weight_kg: 72.5 }, pr_kg: 72.5, best_e1rm_kg: 91.83333 } };
    await openRoutine();
    expect(screen.getByText(/Última vez: 4×8 · 72,5 kg/).textContent).toContain("PR 72,5 kg");
    expect(screen.getByTestId("gym-e1rm").textContent).toContain("e1RM ≈ 91,8 kg");
  });
});

describe("rutina → sesión (R4-7)", () => {
  it("abre en el modo de esfuerzo de la rutina y enseña el RIR planificado", async () => {
    await openRoutine();
    await waitFor(() => expect(screen.getByRole("button", { name: "RIR" }).getAttribute("aria-pressed")).toBe("true"));
    expect((screen.getAllByLabelText("RIR, serie 2")[0] as HTMLInputElement).value).toBe("2");
  });
});

describe("calculadora de discos (R4-8)", () => {
  it("«Usar X kg» va a la siguiente serie por hacer que no es de calentamiento", async () => {
    await openRoutine();
    fireEvent.click(screen.getByLabelText("Opciones de Press banca"));
    fireEvent.click(screen.getByText("Discos"));
    fireEvent.change(screen.getByLabelText("Peso total (kg)"), { target: { value: "72.5" } });
    fireEvent.click(screen.getByText(/Usar 72,5 kg en la serie/));
    expect((screen.getByLabelText("Peso, serie 1") as HTMLInputElement).value).toBe("40");
    expect((screen.getByLabelText("Peso, serie 2") as HTMLInputElement).value).toBe("72,5");
  });
});

describe("récords (R4-11)", () => {
  it("la insignia de la serie y «N récords batidos» cuentan lo mismo: una serie, un récord", async () => {
    await openRoutine();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/gym/records"), expect.anything()));
    fireEvent.click(screen.getByTestId("start-now"));
    fireEvent.change(screen.getByLabelText("Peso, serie 2"), { target: { value: "82,5" } });
    await waitFor(() => {
      fireEvent.click(screen.getByLabelText("Serie 2 hecha"));
      expect(screen.getByTestId("set-records")).toBeTruthy();
    });
    // 82,5 × 6 bate peso, e1RM y volumen, pero se pinta y se cuenta uno: el de peso
    expect(screen.getByTestId("set-records").querySelectorAll(".badge")).toHaveLength(1);
    expect(screen.getByTestId("set-records").textContent).toBe("Récord de peso");
    fireEvent.click(screen.getByText("Terminar entreno"));
    fireEvent.click(screen.getByText("Terminar igualmente"));
    expect(screen.getByText("1 récord batido")).toBeTruthy();
  });
});

describe("entreno en marcha (R4-14)", () => {
  it("abrir una rutina no deja borrador; sí al meter datos o pulsar «Empezar»", async () => {
    await openRoutine();
    await new Promise((r) => setTimeout(r, 50));
    expect(localStorage.getItem(GYM_LIVE_KEY)).toBeNull();
    fireEvent.click(screen.getByTestId("start-now"));
    await waitFor(() => expect(localStorage.getItem(GYM_LIVE_KEY)).not.toBeNull());
    expect(screen.queryByTestId("start-now")).toBeNull();
  });

  it("meter datos también empieza el entreno", async () => {
    await openRoutine();
    expect(localStorage.getItem(GYM_LIVE_KEY)).toBeNull();
    fireEvent.change(screen.getByLabelText("Peso, serie 2"), { target: { value: "75" } });
    await waitFor(() => expect(localStorage.getItem(GYM_LIVE_KEY)).not.toBeNull());
  });

  const live = (routineId: number) => ({
    startedAt: Date.now() - 600_000, focus: null, savedAt: Date.now(), plan: null, restUntil: null,
    routine: { id: routineId, title: "Otra rutina" },
    exercises: [{ name: "Dominadas", sets: [{ kg: "", reps: "8", done: false }] }],
  });

  it("con otro entreno en marcha, avisa: «Seguir» lo recupera", async () => {
    localStorage.setItem(GYM_LIVE_KEY, JSON.stringify(live(9)));
    renderApp(<GymSessionPage />);
    expect(await screen.findByTestId("live-conflict")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/gym/routines/5/start"), expect.anything());
    fireEvent.click(screen.getByText("Seguir"));
    expect(await screen.findByText("Dominadas")).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(GYM_LIVE_KEY)!).routine.id).toBe(9);
  });

  it("con otro entreno en marcha, «Descartar» lo borra y abre el nuevo", async () => {
    localStorage.setItem(GYM_LIVE_KEY, JSON.stringify(live(9)));
    renderApp(<GymSessionPage />);
    fireEvent.click(await screen.findByText("Descartar"));
    expect(await screen.findByText("Press banca")).toBeTruthy();
    expect(localStorage.getItem(GYM_LIVE_KEY)).toBeNull(); // el nuevo aún es un borrador sin empezar
  });

  it("la misma rutina ya en marcha se reanuda sin preguntar", async () => {
    localStorage.setItem(GYM_LIVE_KEY, JSON.stringify(live(5)));
    renderApp(<GymSessionPage />);
    expect(await screen.findByText("Dominadas")).toBeTruthy();
    expect(screen.queryByTestId("live-conflict")).toBeNull();
  });
});

describe("récords sin datos (R4-5)", () => {
  it("un ejercicio sin peso ni reps válidos no sale con «— kg»", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({
      records: {
        "cat:pull-up": { name: "Dominadas", sessions: 2, max_weight_kg: null, max_weight_date: null, max_reps: 0, best_e1rm_kg: null,
          best_e1rm_date: null, best_set_volume_kg: null, best_session_volume_kg: null, reps_by_weight: [] },
        ...RECORDS.records,
      },
      convention: "coach",
    })));
    renderApp(<RecordsPage />);
    const list = await screen.findByTestId("records-list");
    await waitFor(() => expect(list.textContent).toContain("Dominadas"));
    expect(list.textContent).not.toContain("—");
    expect(list.textContent).toContain("2 sesiones");
    expect(list.textContent).toContain("Peso 80 kg · e1RM 96 kg");
  });
});
