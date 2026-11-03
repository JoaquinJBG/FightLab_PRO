import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { expectClean, renderEn } from "./sportsmma-helpers";
import { VigorousWarning } from "@/components/safety/VigorousWarning";
import MmaPage from "@/app/(shell)/training/mma/page";
import SportsPage from "@/app/(shell)/training/sports/page";
import { sessionCheck, sessionCheckQuery, type SessionCheck, type SessionCheckParams } from "@/lib/session-check";

// Fase 9 (spec §8.2): registrar a mano una sesión vigorosa con review_before_vigorous,
// cap_moderate o no_training muestra un aviso con el motivo. Lo decide el servidor y no bloquea.

const state = vi.hoisted(() => ({ data: undefined as unknown, params: [] as unknown[] }));

vi.mock("@/lib/session-check", async (orig) => ({
  ...(await orig<typeof import("@/lib/session-check")>()),
  useSessionCheck: (p: unknown) => { state.params.push(p); return { data: p ? state.data : undefined }; },
}));
vi.mock("@/lib/activities", () => ({
  enqueueActivity: vi.fn(), deleteServerActivities: vi.fn(),
  // historial del servidor (beta): sin respuesta, se queda el local
  fetchServerActivities: vi.fn(async () => null), pendingQueueItems: () => [], mergeByClientId: (...xs: unknown[][]) => xs.flat(),
}));
vi.mock("@/lib/hooks", () => ({ useSafety: () => ({ data: undefined }), useBiometrics: () => ({ data: [] }) }));
vi.mock("@/lib/combat", async (orig) => ({
  ...(await orig<typeof import("@/lib/combat")>()),
  useHeadImpacts: () => ({ data: [] }),
  useReportHeadImpact: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useClearContact: () => ({ mutate: vi.fn(), isPending: false }),
}));

beforeEach(() => { localStorage.clear(); state.data = undefined; state.params = []; Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

const warning = (over: Partial<SessionCheck> = {}): SessionCheck => sessionCheck.parse({
  modalities: [{
    key: "sparring_hard", intensity: "vigorous", rule_key: "combat-sports/hard-striking-sparring-is-vigorous-in-small-samples",
    grade: "emerging", convention: null, blocked_by: ["review_before_vigorous"],
  }],
  rpe_basis: { threshold: 7, rule_key: "cardio-health/0-10-effort-scale-and-talk-test-anchors", grade: "moderate", convention: "fightlab" },
  warn: true,
  flags: ["review_before_vigorous"],
  reasons: [{
    code: "parq_review_vigorous", rule_key: "recovery-habits/par-q-specific-thresholds", grade: "moderate", params: {},
    text: "a PAR-Q+ YES: a qualified exercise professional reviews vigorous work before it starts", professional: null, severity: "refer",
  }],
  blocks_saving: false,
  ...over,
});

describe("VigorousWarning (en)", () => {
  it("modalidad, corte de RPE, motivo con su regla y que se puede guardar", () => {
    state.data = warning();
    const { container } = renderEn(<VigorousWarning params={{ kind: "MMA", work_type: "Sparring", art: "Boxeo", rpe: 8 }} />);
    const box = screen.getByTestId("vigorous-warning");
    expect(box.textContent).toContain("Vigorous session: best reviewed first");
    expect(box.textContent).toContain("Hard sparring: vigorous intensity");
    expect(box.textContent).toContain("RPE 7 or above counts as hard");
    expect(box.textContent).toContain("Your profile says: until a professional reviews vigorous work.");
    expect(screen.getByTestId("vigorous-reason").dataset.code).toBe("parq_review_vigorous");
    expect(box.textContent).toContain("You can still save it");
    const chips = screen.getAllByTestId("evidence-chip");
    expect(chips.map((c) => c.dataset.variant)).toEqual(["evidence", "evidence", "convention", "evidence"]);
    expectClean(container);
  });

  it("sin aviso del servidor no pinta nada", () => {
    state.data = warning({ warn: false, flags: [], reasons: [] });
    const { container } = renderEn(<VigorousWarning params={{ kind: "SPORT", sport_key: "rope", sport_format: "continuous" }} />);
    expect(container.textContent).toBe("");
    renderEn(<VigorousWarning params={null} />);
    expect(screen.queryByTestId("vigorous-warning")).toBeNull();
  });
});

describe("parámetros que se mandan", () => {
  it("cada registro manda lo que decide la modalidad", () => {
    const cases: [SessionCheckParams, string][] = [
      [{ kind: "MMA", work_type: "Sparring", art: "Muay Thai", rpe: 8 }, "kind=MMA&work_type=Sparring&art=Muay+Thai&rpe=8"],
      [{ kind: "MMA", work_type: "Técnica", art: "BJJ", rpe: null }, "kind=MMA&work_type=T%C3%A9cnica&art=BJJ"],
      [{ kind: "SPORT", sport_key: "run", sport_format: "sprints" }, "kind=SPORT&sport_key=run&sport_format=sprints"],
      [{ kind: "GYM", includes: ["one_rm_test", "plyometrics"] }, "kind=GYM&includes=one_rm_test&includes=plyometrics"],
    ];
    for (const [p, qs] of cases) expect(sessionCheckQuery(p)).toBe(qs);
  });

  it("MMA: el tipo de trabajo, el arte y el RPE del registro; el aviso no bloquea guardar", () => {
    state.data = warning();
    renderEn(<MmaPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sparring" }));
    expect(state.params.at(-1)).toEqual({ kind: "MMA", work_type: "Sparring", art: "Boxeo", rpe: 6 });
    expect(screen.getByTestId("vigorous-warning")).toBeTruthy();
    const save = screen.getByRole("button", { name: "Save session" }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it("deportes: el formato del resumen (HIIT, sprints) va al servidor", () => {
    vi.useFakeTimers();
    renderEn(<SportsPage />);
    fireEvent.click(screen.getByText("Running"));
    fireEvent.click(screen.getByText("Start"));
    for (let i = 0; i < 3; i++) act(() => { vi.advanceTimersByTime(800); });
    act(() => { vi.advanceTimersByTime(3000); });
    fireEvent.pointerDown(screen.getByText("Hold to stop").closest("button")!);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("How did it go?")).toBeTruthy();
    expect(screen.getByText("Format")).toBeTruthy();
    expect(state.params.at(-1)).toEqual({ kind: "SPORT", sport_key: "run", sport_format: "continuous" });
    fireEvent.click(screen.getByRole("button", { name: "Intervals (HIIT)" }));
    expect(state.params.at(-1)).toEqual({ kind: "SPORT", sport_key: "run", sport_format: "hiit" });
  });
});
