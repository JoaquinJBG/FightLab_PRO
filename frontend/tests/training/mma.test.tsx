import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { expectClean, renderEn } from "./sportsmma-helpers";
import MmaPage from "@/app/(shell)/training/mma/page";

vi.mock("@/lib/activities", () => ({
  enqueueActivity: vi.fn(), deleteServerActivities: vi.fn(),
  rejectedActivities: () => [], dismissRejected: vi.fn(), firstReason: () => null,
  // historial del servidor (beta): sin respuesta, se queda el local
  fetchServerActivities: vi.fn(async () => null), pendingQueueItems: () => [], mergeByClientId: (...xs: unknown[][]) => xs.flat(),
}));
// El aviso de sesión vigorosa (F9) tiene su propio test (vigorousWarning.test.tsx)
vi.mock("@/lib/session-check", async (orig) => ({ ...(await orig<typeof import("@/lib/session-check")>()), useSessionCheck: () => ({ data: undefined }) }));
// Sin golpes en la cabeza ni peso: la parte de combate (E.5) tiene su propio test (combat.test.tsx)
vi.mock("@/lib/hooks", () => ({ useSafety: () => ({ data: undefined }), useBiometrics: () => ({ data: [] }) }));
vi.mock("@/lib/combat", async (orig) => ({
  ...(await orig<typeof import("@/lib/combat")>()),
  useHeadImpacts: () => ({ data: [] }),
  useReportHeadImpact: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
  useClearContact: () => ({ mutate: vi.fn(), isPending: false }),
}));

beforeEach(() => { localStorage.clear(); Element.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("training/mma en inglés", () => {
  it("formulario por defecto, todas las artes y tipos de trabajo", () => {
    const { container } = renderEn(<MmaPage />);
    expect(screen.getByRole("option", { name: "Boxing" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Wrestling" })).toBeTruthy();
    for (const w of ["Sparring", "Drilling", "Pads", "Bag work", "Technique", "Conditioning"]) {
      fireEvent.click(screen.getByRole("button", { name: w }));
      expectClean(container);
    }
    for (const art of ["BJJ", "Lucha", "Muay Thai", "Kickboxing", "MMA"]) {
      fireEvent.change(container.querySelector("select")!, { target: { value: art } });
      expectClean(container);
    }
    fireEvent.click(screen.getByLabelText("What is RPE"));
    expect(screen.getByText(/Rating of Perceived Exertion/)).toBeTruthy();
    expectClean(container);
  });

  it("guardar sesión, estadísticas del mes e historial", () => {
    vi.useFakeTimers();
    const { container } = renderEn(<MmaPage />);
    fireEvent.change(screen.getByPlaceholderText("Partner (optional)"), { target: { value: "Leo" } });
    fireEvent.change(screen.getByPlaceholderText(/Notes: techniques worked/), { target: { value: "good rounds" } });
    fireEvent.click(screen.getByText("Save session"));
    expect(screen.getByText("Saved ✓")).toBeTruthy();
    expect(screen.getByText("This month")).toBeTruthy();
    expect(screen.getByText("Your MMA sessions")).toBeTruthy();
    expect(screen.getByText(/with Leo/)).toBeTruthy();
    expect(screen.getByText(/Today ·/)).toBeTruthy();
    expectClean(container);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByText("Save session")).toBeTruthy();
  });

  it("historial antiguo (sin tipo)", () => {
    localStorage.setItem("flp_mma", JSON.stringify([
      { id: "1", art: "Boxeo", mode: "Sparring", minutes: 45, rpe: 7, load: 315, ts: Date.now() - 40 * 86400_000 },
      { id: "2", art: "BJJ", minutes: 60, rpe: 5, load: 300, ts: Date.now() - 41 * 86400_000 },
    ]));
    const { container } = renderEn(<MmaPage />);
    expect(screen.getAllByText(/Boxing/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Session/)).toBeTruthy();
    expectClean(container);
  });

  it("sin plan sugerido ni chat simulados (retirados en la beta)", () => {
    const { container } = renderEn(<MmaPage />);
    expect(screen.queryByText("Suggested plan")).toBeNull();
    expect(screen.queryByLabelText("Open coach chat")).toBeNull();
    expectClean(container);
  });

  it("repetir la última sesión y borrar con confirmación", () => {
    localStorage.setItem("flp_mma", JSON.stringify([
      { id: "1", art: "BJJ", type: "Drilling", minutes: 45, rpe: 6, load: 270, partner: "Ana", ts: Date.now() - 3600_000 },
    ]));
    const { container } = renderEn(<MmaPage />);
    fireEvent.click(screen.getByText("↻ Repeat last"));
    expect((container.querySelector("select") as HTMLSelectElement).value).toBe("BJJ");
    expect((screen.getByPlaceholderText("Partner (optional)") as HTMLInputElement).value).toBe("Ana");
    expect(screen.getByText("45 min")).toBeTruthy();
    fireEvent.click(screen.getByText("Delete"));
    fireEvent.click(screen.getByText("Delete everything?"));
    expect(screen.queryByText("Your MMA sessions")).toBeNull();
    expectClean(container);
  });
});
