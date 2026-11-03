import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderEn } from "./i18nB-helpers";
import { makePlan, makeState } from "./plan-fixture";
import GymSessionPage from "@/app/(shell)/training/gym/session/page";

// Mi rutina → "Start session A": la sesión se rellena con los ejercicios del plan y sus cargas
// (las del motor; sin carga, vacío) y se guarda con `plan_session` para seguir la rotación.

const mocks = vi.hoisted(() => ({ enqueue: vi.fn(), push: vi.fn(), plan: undefined as unknown }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => ({ get: (k: string) => (k === "plan" ? "A" : null) }),
}));
vi.mock("@/lib/activities", () => ({
  enqueueActivity: mocks.enqueue,
  fetchServerActivities: vi.fn(async () => null), pendingQueueItems: () => [], mergeByClientId: (...xs: unknown[][]) => xs.flat(),
}));
vi.mock("@/lib/plan", async (orig) => ({
  ...(await orig<typeof import("@/lib/plan")>()),
  useWeeklyPlan: () => ({ data: mocks.plan }),
}));

beforeEach(() => { localStorage.clear(); mocks.enqueue.mockClear(); });

describe("sesión del plan", () => {
  it("rellena los ejercicios y guarda la sesión del plan", () => {
    mocks.plan = makeState({ active: makePlan({ status: "active" }) });
    renderEn(<GymSessionPage />);
    expect(screen.getByText("Session A")).toBeTruthy();
    expect(screen.getByText("Romanian deadlift")).toBeTruthy();
    expect(screen.getByText("Bench press")).toBeTruthy();
    const kg = screen.getAllByPlaceholderText("—").map((i) => (i as HTMLInputElement).value);
    expect(kg.filter((v) => v === "62.5")).toHaveLength(3); // 3 series a 62,5 kg del motor
    const reps = screen.getAllByPlaceholderText("—").filter((_, i) => i % 2 === 1);
    fireEvent.change(reps[3], { target: { value: "10" } });
    // solo se guardan las series ✓ (beta); el resto lleva la carga del plan sin marcar → aviso
    fireEvent.click(screen.getAllByLabelText("Set 1 done")[1]);
    fireEvent.click(screen.getByText("Finish workout"));
    fireEvent.click(screen.getByText("Finish anyway"));
    fireEvent.click(screen.getByText("Save"));
    const item = mocks.enqueue.mock.calls[0][0];
    expect(item.detail.plan_session).toBe("A");
    expect(item.sets).toEqual([{ exercise: "Press banca", exercise_index: 0, set_index: 0, weight_kg: 62.5, reps: 10 }]);
  });
});
