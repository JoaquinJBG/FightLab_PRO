import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import TodayPage from "@/app/(shell)/today/page";
import CoachPage from "@/app/(shell)/coach/page";
import LoadPage from "@/app/(shell)/training/load/page";
import SportsPage from "@/app/(shell)/training/sports/page";
import type { TodayState } from "@/lib/today";
import type { Safety } from "@/lib/schemas";
import { todaySafety } from "@/lib/safety-state";
import { CATALOGS, mockApi, renderApp } from "../support/app";

// R4-10 y R4-13: tres veces una pantalla dijo «Listo para entrenar» u ofreció «Intenso» tras un golpe
// en la cabeza. Ahora todas leen el mismo estado (`/coach/safety` → `state`, `lib/safety-state`).
// Con un golpe activo y con una lesión sin valorar se recorren Hoy, Coach (cabecera, briefing y chat
// por reglas), Carga y Deportes: ninguna dice «Listo para entrenar» ni ofrece «Intenso» o vigoroso.
// (El plan y Mi rutina pintan lo que da el servidor: `backend/coaching/tests/test_safety_state.py`.)

const hooks = vi.hoisted(() => ({ safety: undefined as unknown }));
// FC en reposo por debajo de la media y HRV por encima: la recuperación sola diría «Listo».
const READY_LOGS = [
  { resting_heart_rate: 48, hrv_ms: 80, weight_kg: "80", timestamp: "2026-10-29T07:00:00Z" },
  ...Array.from({ length: 4 }, (_, i) => ({ resting_heart_rate: 55, hrv_ms: 60, weight_kg: "80", timestamp: `2026-10-2${i}T07:00:00Z` })),
];

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));
vi.mock("@/lib/hooks", async (orig) => ({
  ...(await orig<typeof import("@/lib/hooks")>()),
  useBiometrics: () => ({ data: READY_LOGS, isSuccess: true }),
  useSafety: () => ({ data: hooks.safety, isLoading: false, isError: false }),
  useWeighIn: () => ({ data: { blocked: false, deficit_blocked: false, reasons: [], goal_weight_kg: null, goal_date: null, weigh_in_at: null, weight_class: null, days_left: null, current_kg: 80, to_go_kg: null } }),
  useCreateBiometrics: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/lib/activities", async (orig) => ({
  ...(await orig<typeof import("@/lib/activities")>()),
  fetchServerMetrics: vi.fn(async () => null),
  fetchServerActivities: vi.fn(async () => null),
}));
vi.mock("@/lib/session-check", async (orig) => ({ ...(await orig<typeof import("@/lib/session-check")>()), useSessionCheck: () => ({ data: undefined }) }));
vi.mock("@/components/evidence/CitedText", () => ({ CitedText: ({ text }: { text: string }) => <span>{text}</span> }));

const es = CATALOGS.es;
const READY = [es.training.load.recoveryState.listo, es.coach.recovery.listo.label, es.dashboard.recovery.listo.label];

function safetyWith(kind: "head_blow" | "injury"): Safety {
  const flag = kind === "head_blow" ? "head_blow_return" : "injury_unassessed";
  const item = kind === "head_blow"
    ? { kind, code: "head_blow_no_contact", rule_key: "combat-sports/a-head-blow-with-symptoms-sets-no-contact-and-refers", grade: "consensus",
        params: {}, text: "golpe en la cabeza con síntomas: sin contacto", since: "2026-10-28", until: "clearance" as const }
    : { kind, code: "injury_unassessed", rule_key: "recovery-habits/some-pain-during-exercise-is-acceptable-in-chronic-assessed-pain", grade: "moderate",
        params: { area: "rodilla derecha" }, text: "lesión de rodilla derecha sin valorar", since: "2026-10-27", until: "assessed" as const };
  return {
    screened: true,
    flags: (kind === "head_blow" ? { no_contact: true } : {}) as Record<string, boolean>,
    reasons: [],
    paused_exercises: {},
    refer_gp: true,
    deferral_line: null,
    disclaimer: "Orientación general.",
    emergency_number: "112",
    parq_pending: false,
    weight: { kg: 80, date: "2026-10-29" },
    state: {
      level: "caution" as const,
      no_contact: kind === "head_blow",
      no_training: false,
      vigorous: { allowed: false, blocked_by: [flag] },
      active: [item],
    },
  };
}

const TODAY: TodayState = {
  date: "2026-10-29", today: "2026-10-29", weekday: "thu", plan: null, day_type: null, day_type_set: false,
  trained: null, mobility: null, weight_kg: null, weight_blocked: false, menu: null, next_meal: null,
  cardio: {
    sessions: [],
    week: {
      start: "2026-10-26", minutes: 0, equivalent: 0, goal: 150, mma_minutes: 0, mma_convention: null,
      rule_key: "cardio-health/weekly-baseline-dose", grade: "strong",
      vigorous_rule_key: "cardio-health/0-10-effort-scale-and-talk-test-anchors", vigorous_grade: "moderate",
    },
    types: [{ key: "run", vigorous: true }, { key: "walk", vigorous: false }],
  },
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function noReady() {
  for (const text of READY) expect(screen.queryByText(text)).toBeNull();
}

describe.each(["head_blow", "injury"] as const)("con %s activo, ninguna pantalla dice «listo» ni ofrece lo vigoroso", (kind) => {
  beforeEach(() => {
    hooks.safety = safetyWith(kind);
  });

  it("Hoy: «Vigorosa» desactivada con el motivo", async () => {
    mockApi({ "/api/proxy/coach/today": { body: TODAY } });
    renderApp(<TodayPage />);
    const vigorous = await screen.findByTestId("cardio-intensity-vigorous");
    expect((vigorous as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("cardio-intensity-moderate").getAttribute("aria-checked")).toBe("true");
    const why = es.weeklyPlan.blockedBy[kind === "head_blow" ? "head_blow_return" : "injury_unassessed"];
    expect(screen.getByTestId("cardio-vigorous-off").textContent).toContain(why);
    noReady();
  });

  it("Coach: cabecera, briefing y chat por reglas sin «listo»", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    renderApp(<CoachPage />);
    expect(screen.queryByTestId("coach-recovery-badge")).toBeNull();
    expect(screen.getByTestId("coach-safety-badge")).toBeTruthy();
    expect(screen.queryByText(es.coach.briefing.ready)).toBeNull();
    noReady();
    fireEvent.click(screen.getByRole("button", { name: es.coach.chat.quick.hard }));
    // Golpe: el golpe va primero. Lesión sin valorar: «nada duro», nunca «dale duro».
    const expected = kind === "head_blow" ? es.coach.reply.headBlowActive.slice(0, 30) : es.coach.reply.noVigorous.split("(")[0].trim();
    const reply = await screen.findByText((t) => t.includes(expected));
    expect(reply.textContent).not.toContain(es.coach.reply.hardReady.split("{acwr}")[1].trim().slice(0, 15));
  });

  it("Carga y estado: el estado de hoy es el de seguridad, con su motivo", () => {
    renderApp(<LoadPage />);
    const card = screen.getByTestId("safety-state");
    expect(card.getAttribute("data-level")).toBe("caution");
    expect(screen.getByTestId("safety-state-label").textContent).toBe(es.safetyState.caution);
    expect(screen.getByTestId("safety-state-reason").getAttribute("data-kind")).toBe(kind);
    noReady();
  });

  it("Deportes: «Intenso» desactivado con el motivo", () => {
    renderApp(<SportsPage />);
    fireEvent.click(screen.getByText(es.training.activities.sports.run));
    const intense = screen.getByTestId("sport-intensity-intense") as HTMLButtonElement;
    expect(intense.disabled).toBe(true);
    fireEvent.click(intense);
    expect(screen.getByTestId("sport-intense-off").textContent).toContain(es.safetyState.intenseOff.split("{why}")[0]);
    // Sigue en «Moderado» (la selección por defecto)
    expect(screen.getByTestId("sport-intensity-moderate").getAttribute("style")).toContain("linear-gradient");
    expect(intense.getAttribute("style")).not.toContain("linear-gradient");
  });
});

describe("todaySafety", () => {
  it("sin nada activo deja decir «listo»; sin `state` (servidor antiguo) lee los flags del lado prudente", () => {
    const base = safetyWith("head_blow");
    expect(todaySafety({ ...base, state: { ...base.state!, level: "ok", no_contact: false, vigorous: { allowed: true, blocked_by: [] }, active: [] } })?.vigorousAllowed).toBe(true);
    const old = todaySafety({ ...base, state: undefined });
    expect(old?.level).toBe("caution");
    expect(old?.vigorousBlockedBy).toEqual(["head_blow_return"]);
    expect(todaySafety(null)).toBeNull();
  });
});
