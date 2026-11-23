import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import es from "@/messages/es.json";
import en from "@/messages/en.json";

type Q = { data?: unknown; isLoading: boolean; isError: boolean; isFetching: boolean; error: unknown };
let profileQ: Q;
const refetch = vi.fn();

vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/hooks", () => {
  class ApiError extends Error {
    constructor(message: string, readonly status: number) {
      super(message);
    }
  }
  return {
    ApiError,
    useProfile: () => ({ ...profileQ, refetch }),
    useScreening: () => ({ data: undefined, isLoading: false }),
    useUpdateProfile: () => ({ mutate: vi.fn() }),
  };
});
vi.mock("@/lib/onboarding", () => ({ isOnboardingComplete: () => true }));

import { OnboardingGate, WAKE_DEADLINE_MS, backoffDelay } from "@/components/onboarding-gate";
import { ApiError } from "@/lib/hooks";

const loading: Q = { isLoading: true, isError: false, isFetching: true, error: null };
const failed = (status = 502): Q => ({ isLoading: false, isError: true, isFetching: false, error: new ApiError(String(status), status) });
const ok: Q = { data: { goal: null }, isLoading: false, isError: false, isFetching: false, error: null };

function ui() {
  return (
    <NextIntlClientProvider locale="es" messages={es}>
      <OnboardingGate>
        <p>contenido</p>
      </OnboardingGate>
    </NextIntlClientProvider>
  );
}

describe("OnboardingGate: backend dormido", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    refetch.mockReset();
    profileQ = loading;
  });
  afterEach(() => vi.useRealTimers());

  test("backoff 2, 4, 8, 15 s y 15 s después", () => {
    expect([0, 1, 2, 3, 4, 9].map(backoffDelay)).toEqual([2000, 4000, 8000, 15000, 15000, 15000]);
  });

  test("rápido: nunca enseña «Despertando»", () => {
    const { rerender } = render(ui());
    expect(screen.queryByText("Despertando el servidor…")).toBeNull();
    profileQ = ok;
    rerender(ui());
    expect(screen.getByText("contenido")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(120_000));
    expect(screen.queryByText("Despertando el servidor…")).toBeNull();
    expect(refetch).not.toHaveBeenCalled();
  });

  test("lento: enseña «Despertando…» con role=status y, al responder, sigue normal", () => {
    const { rerender } = render(ui());
    act(() => void vi.advanceTimersByTime(5_000));
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Despertando el servidor…");
    expect(status.textContent).toContain("hasta un minuto");
    profileQ = ok;
    rerender(ui());
    expect(screen.getByText("contenido")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("falla (502) y reintenta solo con backoff; si se recupera, sigue normal", () => {
    profileQ = failed();
    const { rerender } = render(ui());
    expect(screen.getByRole("status").textContent).toContain("Despertando");
    expect(screen.queryByRole("button")).toBeNull();
    act(() => void vi.advanceTimersByTime(1_999));
    expect(refetch).not.toHaveBeenCalled();
    act(() => void vi.advanceTimersByTime(1));
    expect(refetch).toHaveBeenCalledTimes(1);
    // Segundo intento: 4 s después (la petición vuelve a fallar).
    profileQ = { ...failed(), isFetching: true };
    rerender(ui());
    profileQ = failed();
    rerender(ui());
    act(() => void vi.advanceTimersByTime(4_000));
    expect(refetch).toHaveBeenCalledTimes(2);
    profileQ = ok;
    rerender(ui());
    expect(screen.getByText("contenido")).toBeTruthy();
    act(() => void vi.advanceTimersByTime(60_000));
    expect(refetch).toHaveBeenCalledTimes(2);
  });

  test("lento y se rinde a los 90 s: error con «Reintentar»", () => {
    profileQ = failed(503);
    const { rerender } = render(ui());
    // Cada intento falla de inmediato: la pantalla sigue en «Despertando» hasta los 90 s.
    let elapsed = 0;
    let attempt = 0;
    while (elapsed + backoffDelay(attempt) < WAKE_DEADLINE_MS) {
      const d = backoffDelay(attempt++);
      act(() => void vi.advanceTimersByTime(d));
      elapsed += d;
      profileQ = { ...failed(503), isFetching: true };
      rerender(ui());
      profileQ = failed(503);
      rerender(ui());
      expect(screen.queryByRole("button")).toBeNull();
    }
    expect(refetch.mock.calls.length).toBeGreaterThanOrEqual(5);
    act(() => void vi.advanceTimersByTime(WAKE_DEADLINE_MS - elapsed));
    expect(screen.getByRole("alert").textContent).toContain("No se pudo cargar tu perfil.");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    const calls = refetch.mock.calls.length;
    act(() => void vi.advanceTimersByTime(60_000));
    expect(refetch).toHaveBeenCalledTimes(calls); // ya no reintenta solo
  });

  test("un 4xx no se reintenta: error directo", () => {
    profileQ = failed(403);
    render(ui());
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    act(() => void vi.advanceTimersByTime(30_000));
    expect(refetch).not.toHaveBeenCalled();
  });

  test("mismas claves en es y en; la clave vieja ya no existe", () => {
    const gate = (m: typeof es) => Object.keys(m.shell.gate).sort();
    expect(gate(en as typeof es)).toEqual(gate(es));
    expect(gate(es)).toContain("waking");
    expect(gate(es)).not.toContain("slow");
  });
});
