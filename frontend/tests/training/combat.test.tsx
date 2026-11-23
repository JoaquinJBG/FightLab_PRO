import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectClean, renderEn } from "./sportsmma-helpers";
import MmaPage from "@/app/(shell)/training/mma/page";
import { kcalRange, metFor } from "@/lib/combat-mets";

// E.5 en el registro de MMA: golpe en la cabeza → no_contact (lo decide el servidor), CRT6
// enlazado, alta del clínico y gasto estimado con el Compendio 2024.

const state = vi.hoisted(() => ({
  safety: undefined as unknown,
  impacts: [] as unknown[],
  report: vi.fn(),
  clear: vi.fn(),
  logs: [] as unknown[],
}));

vi.mock("@/lib/activities", () => ({
  enqueueActivity: vi.fn(), deleteServerActivities: vi.fn(),
  rejectedActivities: () => [], dismissRejected: vi.fn(), firstReason: () => null,
  // historial del servidor (beta): sin respuesta, se queda el local
  fetchServerActivities: vi.fn(async () => null), pendingQueueItems: () => [], mergeByClientId: (...xs: unknown[][]) => xs.flat(),
}));
// El aviso de sesión vigorosa (F9) tiene su propio test (vigorousWarning.test.tsx)
vi.mock("@/lib/session-check", async (orig) => ({ ...(await orig<typeof import("@/lib/session-check")>()), useSessionCheck: () => ({ data: undefined }) }));
vi.mock("@/lib/hooks", () => ({ useSafety: () => ({ data: state.safety }), useBiometrics: () => ({ data: state.logs }) }));
vi.mock("@/lib/combat", async (orig) => ({
  ...(await orig<typeof import("@/lib/combat")>()),
  useHeadImpacts: () => ({ data: state.impacts }),
  useReportHeadImpact: () => ({ mutate: state.report, isPending: false, isError: false }),
  useClearContact: () => ({ mutate: state.clear, isPending: false }),
}));

const CRT6 = "https://doi.org/10.1136/bjsports-2023-107021";
const safety = (flags: Record<string, boolean> = {}) => ({
  flags, reasons: [], disclaimer: "This is general guidance from an automated coach, not medical advice.",
  emergency_number: "112", crt6_url: CRT6,
});

beforeEach(() => {
  localStorage.clear();
  Element.prototype.scrollIntoView = vi.fn();
  state.safety = safety();
  state.impacts = [];
  state.logs = [];
  state.report.mockReset();
  state.clear.mockReset();
});
afterEach(() => cleanup());

describe("golpe en la cabeza en MMA (en)", () => {
  it("avisar con síntomas manda el aviso estructurado al servidor", () => {
    const { container } = renderEn(<MmaPage />);
    const card = screen.getByTestId("head-blow-card");
    expect(within(card).getByTestId("combat-disclaimer").textContent).toContain("not medical advice");
    fireEvent.click(screen.getByTestId("head-report"));
    expect((screen.getByTestId("head-send") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId("head-symptoms-yes"));
    fireEvent.click(screen.getByTestId("head-red-flags-no"));
    expect(screen.getByTestId("crt6-link").getAttribute("href")).toBe(CRT6);
    fireEvent.click(screen.getByTestId("head-send"));
    expect(state.report).toHaveBeenCalledWith({ symptoms: true, red_flags: false, origin: "mma_session" }, expect.anything());
    expectClean(container);
  });

  it("con señales de alarma, urgencias primero", () => {
    renderEn(<MmaPage />);
    fireEvent.click(screen.getByTestId("head-report"));
    fireEvent.click(screen.getByTestId("head-red-flags-yes"));
    const box = screen.getByTestId("head-emergency");
    expect(box.textContent).toContain("Get emergency care now");
    expect(within(box).getByText("Call 112").getAttribute("href")).toBe("tel:112");
  });

  it("con no_contact: bloqueo, pasos de vuelta, sin sugerir sparring y alta del clínico", () => {
    state.safety = safety({ no_contact: true });
    state.impacts = [
      { id: 7, occurred_on: "2026-11-01", symptoms: true, red_flags: false, origin: "mma_session", cleared_on: null, cleared_by: null },
      { id: 3, occurred_on: "2026-10-01", symptoms: false, red_flags: false, origin: "other", cleared_on: null, cleared_by: null },
    ];
    const { container } = renderEn(<MmaPage />);
    const card = screen.getByTestId("no-contact-card");
    expect(card.textContent).toContain("Contact blocked");
    expect(card.textContent).toContain("Full-contact practice");
    expect(card.textContent).toContain("FightLab computes no dates");
    expect(within(card).getByTestId("crt6-link").getAttribute("href")).toBe(CRT6);
    // No reproduce el CRT6: solo lo enlaza
    expect(card.textContent).not.toMatch(/Concussion Recognition Tool 6 \(CRT6\)[^,]*:.*Step/);

    fireEvent.click(screen.getByRole("button", { name: "Sparring" }));
    expect(screen.getByTestId("contact-block-note")).toBeTruthy();
    expect(screen.getByTestId("contact-block-note").textContent).toContain("do not do this work until a clinician clears you");
    fireEvent.click(screen.getByRole("button", { name: "Bag work" }));
    expect(screen.queryByTestId("contact-block-note")).toBeNull();

    const clear = screen.getByTestId("clear-contact") as HTMLButtonElement;
    expect(clear.disabled).toBe(true); // hace falta confirmar el alta
    fireEvent.click(screen.getByTestId("clear-confirm"));
    fireEvent.click(clear);
    expect(state.clear).toHaveBeenCalledWith(expect.objectContaining({ ids: [7], clearedBy: null }));
    expectClean(container);
  });
});

describe("gasto estimado con el Compendio 2024", () => {
  it("usa la entrada del anexo y lo enseña como rango, con su regla", () => {
    state.logs = [{ weight_kg: "70.0" }];
    const { container } = renderEn(<MmaPage />);
    fireEvent.click(screen.getByRole("button", { name: "Sparring" }));
    const box = screen.getByTestId("combat-kcal");
    // 7,8 MET × 3,5 × 70 / 200 × 30 min ≈ 287 kcal → ±20 % redondeado a 10
    expect(screen.getByTestId("combat-kcal-range").textContent).toBe("≈ 230–340 kcal");
    expect(box.textContent).toContain("boxing, sparring: 7.8 MET");
    expect(box.querySelectorAll('[data-variant="evidence"]').length).toBe(2);
    expect(box.querySelectorAll('[data-variant="convention"]').length).toBe(1); // el ±20 %
    fireEvent.click(screen.getByRole("button", { name: "Conditioning" }));
    expect(screen.getByTestId("combat-kcal").textContent).toContain("No Compendium entry");
    expectClean(container);
  });

  it("MMA y BJJ usan la entrada general marcada como aproximación", () => {
    expect(metFor("MMA", "Sparring")).toMatchObject({ met: 10.3, approx: true });
    expect(metFor("BJJ", "Drilling")).toMatchObject({ met: 10.3, approx: true });
    expect(metFor("Lucha", "Sparring")).toMatchObject({ met: 6.0, approx: true, estimated: true });
    expect(metFor("Taekwondo", "Sparring")).toMatchObject({ met: 14.3 });
    expect(metFor("Boxeo", "Saco")).toMatchObject({ met: 5.8 });
    expect(metFor("Boxeo", "Pads")).toBeNull();
    expect(kcalRange(10, 80, 60)).toEqual({ low: 670, high: 1010 });
  });
});
