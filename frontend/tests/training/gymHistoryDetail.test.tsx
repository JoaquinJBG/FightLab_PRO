import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { expectClean, renderEn } from "./i18nB-helpers";
import DetailPage from "@/app/(shell)/training/gym/history/[id]/page";
import RecordsPage from "@/app/(shell)/training/gym/records/page";
import ExercisePage from "@/app/(shell)/training/gym/exercise/page";

// F17 (rama H): detalle de un entreno (ver, editar y borrar), lista de récords y progreso.

const m = vi.hoisted(() => ({ push: vi.fn(), params: new Map<string, string>() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: m.push }),
  useParams: () => ({ id: "42" }),
  useSearchParams: () => ({ get: (k: string) => m.params.get(k) ?? null }),
}));

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const SET = { exercise_key: "cat:barbell-bench-press", exercise_index: 0, rpe: null, rir: null, distance_km: null, duration_s: null, superset: null, notes: "Slow", rest_s: 120 };
const DETAIL = {
  id: 42, client_id: "c1", kind: "GYM", title: "Push", started_at: "2026-11-05T17:00:00Z", duration_sec: 3600, rpe: 8, kcal: null,
  note: "", detail: {}, load_au: 480, source: "MANUAL", created_at: "", summary: { exercises: 1, sets: 2, volume_kg: 880 },
  sets: [
    { ...SET, exercise: "Bench press", set_index: 0, set_type: "warmup", weight_kg: 40, reps: 10 },
    { ...SET, exercise: "Bench press", set_index: 1, set_type: "normal", weight_kg: 80, reps: 6, rpe: 8 },
  ],
};
let calls: [string, RequestInit | undefined][] = [];
let patchStatus = 200;

beforeEach(() => {
  calls = [];
  patchStatus = 200;
  m.push.mockClear();
  m.params = new Map();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push([url, init]);
    if (url.endsWith("/activities/42") && init?.method === "PATCH") {
      return patchStatus === 200 ? json({ ...DETAIL, title: "Push heavy" }) : json({ sets: [{ weight_kg: ["Ensure this value is less than or equal to 1000."] }] }, 400);
    }
    if (url.endsWith("/activities/42") && init?.method === "DELETE") return new Response(null, { status: 204 });
    if (url.endsWith("/activities/42")) return json(DETAIL);
    if (url.includes("/gym/records")) return json({ records: { "cat:barbell-bench-press": {
      name: "Bench press", sessions: 2, max_weight_kg: 85, max_weight_date: "2026-11-05", max_reps: 10, best_e1rm_kg: 93.5,
      best_e1rm_date: "2026-11-05", best_set_volume_kg: 700, best_session_volume_kg: 955, reps_by_weight: [{ weight_kg: 85, reps: 3, date: "2026-11-05" }],
    } }, convention: "coach" });
    if (url.includes("/gym/progress")) return json({ exercise: "cat:barbell-bench-press", name: "Bench press", convention: "coach", sessions: [
      { date: "2026-10-29", activity_id: 1, e1rm_kg: 93.33, max_weight_kg: 80, volume_kg: 800, reps: 10, best_set: { weight_kg: 80, reps: 5 } },
      { date: "2026-11-05", activity_id: 2, e1rm_kg: 93.5, max_weight_kg: 85, volume_kg: 955, reps: 13, best_set: { weight_kg: 85, reps: 3 } },
    ] });
    return json({}, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Detalle de un entreno", () => {
  it("enseña las series guardadas y se edita con PATCH", async () => {
    const { container } = renderEn(<DetailPage />);
    await screen.findByText("Push");
    expect(screen.getByTestId("detail-sets").textContent).toBe("2");
    expect(screen.getByText("Slow")).toBeTruthy();
    expectClean(container, ["Push"]);
    fireEvent.click(screen.getByText("Edit"));
    fireEvent.change(screen.getByLabelText("Workout title"), { target: { value: "Push heavy" } });
    fireEvent.change(screen.getAllByLabelText("Weight, set 2")[0], { target: { value: "82,5" } });
    fireEvent.click(screen.getByLabelText("Remove set 1"));
    fireEvent.click(screen.getByText("Save"));
    await screen.findByText("Push heavy");
    const body = JSON.parse(String(calls.find(([, i]) => i?.method === "PATCH")![1]!.body));
    expect(body.title).toBe("Push heavy");
    expect(body.sets).toEqual([{ exercise: "Bench press", exercise_key: "cat:barbell-bench-press", exercise_index: 0, set_index: 0,
      weight_kg: 82.5, reps: 6, rpe: 8, notes: "Slow", rest_s: 120 }]);
  });

  it("si el servidor no acepta el cambio, dice por qué", async () => {
    patchStatus = 400;
    renderEn(<DetailPage />);
    fireEvent.click(await screen.findByText("Edit"));
    fireEvent.click(screen.getByText("Save"));
    expect((await screen.findByRole("alert")).textContent).toContain("less than or equal to 1000");
  });

  it("borrar pide confirmación", async () => {
    renderEn(<DetailPage />);
    fireEvent.click(await screen.findByText("Delete workout"));
    fireEvent.click(screen.getAllByText("Delete workout").at(-1)!);
    await waitFor(() => expect(m.push).toHaveBeenCalledWith("/training/gym"));
    expect(calls.some(([u, i]) => u.endsWith("/activities/42") && i?.method === "DELETE")).toBe(true);
  });
});

describe("Récords y progreso", () => {
  it("lista de récords con enlace al progreso", async () => {
    const { container } = renderEn(<RecordsPage />);
    const link = await screen.findByRole("link", { name: /Bench press/ });
    expect(link.getAttribute("href")).toContain("/training/gym/exercise?id=cat%3Abarbell-bench-press");
    expect(link.textContent).toContain("Weight 85 kg · e1RM 93.5 kg");
    expectClean(container, ["Bench press"]);
  });

  it("gráfica por métrica y récords del ejercicio", async () => {
    m.params.set("id", "cat:barbell-bench-press");
    const { container } = renderEn(<ExercisePage />);
    await screen.findByTestId("progress-chart");
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("e1RM: 93–94 kg");
    fireEvent.click(screen.getByRole("button", { name: "Volume" }));
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe("Volume: 800–955 kg");
    expect((await screen.findByTestId("exercise-records")).textContent).toContain("85 kg");
    expectClean(container, ["Bench press"]);
  });
});
