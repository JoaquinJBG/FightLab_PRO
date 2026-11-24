import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { expectClean, renderEn } from "./i18nB-helpers";
import HistoryPage from "@/app/(shell)/training/history/page";

// Historial de Entreno: calendario + lista de todas las sesiones (gimnasio, MMA, deporte). Datos inventados.

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));

const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
const row = (id: number, kind: string, title: string) => ({
  id, client_id: `c${id}`, kind, title, started_at: "2026-11-05T17:00:00Z", duration_sec: 3600, rpe: null, kcal: null, note: "",
  detail: null, load_au: null, source: "app", created_at: "2026-11-05T18:00:00Z",
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function stub(list: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => (String(url).includes("/activities/calendar") ? json({}) : json(list))));
}

describe("Historial de Entreno", () => {
  it("lista gimnasio, MMA y deporte; solo gimnasio lleva al detalle", async () => {
    stub([row(1, "GYM", "Push"), row(2, "MMA", "Sparring"), row(3, "SPORT", "Run")]);
    const { container } = renderEn(<HistoryPage />);
    const list = await screen.findByTestId("history-list");
    expect(list.querySelectorAll("li")).toHaveLength(3);
    expect(list.querySelector('a[href="/training/gym/history/1"]')).toBeTruthy();
    expect(list.querySelectorAll("a")).toHaveLength(1);
    expect(screen.getByTestId("training-calendar")).toBeTruthy();
    expect(container.querySelector('a[href="/training"]')).toBeTruthy();
    expectClean(container);
  });

  it("sin sesiones: una frase", async () => {
    stub([]);
    renderEn(<HistoryPage />);
    expect(await screen.findByTestId("history-empty")).toBeTruthy();
  });
});
