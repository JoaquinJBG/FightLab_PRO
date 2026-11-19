import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import WeighInPage from "@/app/(shell)/nutrition/weigh-in/page";
import { SafetyPanel } from "@/components/safety/SafetyBanner";
import { PROFILE, SAFETY, WEIGH_IN, mockApi, renderApp } from "../support/app";

// E.5: el contenido de corte en el pesaje es solo información con sus reglas, sin cantidades
// por kg ni % perdido, nada para menores y nada con los bloqueos de la fase 4.

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

const route = (weighIn: unknown, flags: Record<string, boolean> = {}) => ({
  "/api/proxy/coach/weigh-in": { body: weighIn },
  "/api/proxy/coach/safety": { body: { ...SAFETY, flags } },
  "/api/proxy/me/profile": { body: PROFILE },
});

describe("hacer el peso: información, no un protocolo", () => {
  it("adultos: cada punto lleva su regla, el aviso y la derivación", async () => {
    mockApi(route(WEIGH_IN));
    renderApp(<WeighInPage />, "en");
    const card = await screen.findByTestId("cut-info");
    expect(card.textContent).toContain("information, not a protocol");
    expect(card.textContent).toContain("sports dietitian");
    expect(card.querySelectorAll('[data-variant="evidence"]').length).toBe(9);
    expect(card.querySelector('[data-testid="combat-disclaimer"]')!.textContent).toContain("no consejo médico");
    // Sin cantidades por kg ni % de lo perdido, ni objetivo de recuperación
    expect(card.textContent).not.toMatch(/\d+\s*(ml|g|mg)\s*\/\s*kg|\d+\s*%\s*of (the )?(weight|loss)|150 ?%/i);
    expect(screen.getByText(/Weigh-in: target and countdown/)).toBeTruthy();
  });

  it("menores: sin contenido de corte, con el motivo y su regla", async () => {
    mockApi(route({ ...WEIGH_IN, blocked: true }, { no_cut_content: true, no_weight_targets: true }));
    renderApp(<WeighInPage />, "en");
    const card = await screen.findByTestId("cut-minor");
    expect(card.textContent).toContain("under-18s");
    expect(screen.queryByTestId("cut-info")).toBeNull();
  });

  it("con el déficit bloqueado no hay contenido de corte", async () => {
    mockApi(route({ ...WEIGH_IN, deficit_blocked: true }, { no_deficit: true }));
    renderApp(<WeighInPage />, "en");
    await screen.findByTestId("weigh-deficit-note");
    expect(screen.queryByTestId("cut-info")).toBeNull();
  });
});

describe("aviso de seguridad con un golpe en la cabeza", () => {
  it("enlaza el CRT6 oficial y no lo reproduce", () => {
    const reason = {
      code: "head_blow_no_contact", rule_key: "combat-sports/a-head-blow-with-symptoms-sets-no-contact-and-refers",
      grade: "strong", params: {}, text: "un golpe en la cabeza con síntomas…", professional: "médico", severity: "refer" as const,
    };
    renderApp(<SafetyPanel data={{ ...SAFETY, reasons: [reason], crt6_url: "https://doi.org/10.1136/bjsports-2023-107021" }} />);
    expect(screen.getByTestId("crt6-link").getAttribute("href")).toBe("https://doi.org/10.1136/bjsports-2023-107021");
  });
});
