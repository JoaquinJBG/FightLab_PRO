import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import CheckinPage from "@/app/(shell)/checkin/page";
import { mockApi, CATALOGS, type Locale } from "../support/app";

vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => localStorage.clear());

const READINESS = {
  status: "no_data", drops_today: [], days_with_drop: 0, hrv_drop: false,
  rule_key: "recovery-habits/simple-readiness-monitoring", grade: "moderate",
  hrv_rule_key: "recovery-habits/hrv-is-optional", hrv_grade: "emerging",
};
const STATE = { date: "2026-10-29", checkin: null, weight_blocked: false, weekly_questions: [], readiness: READINESS };
const SAFETY_AFTER = { flags: {}, reasons: [], refer_gp: false, deferral_line: null, emergency_number: "112" };
const RESULT = { ...STATE, alerts: [], refused: [], safety: SAFETY_AFTER };
const TREND_FEW = {
  status: "insufficient_data", blocked: false, rate_kg_week: null, rate_pct_week: null, weight_kg: null, points: 3,
  days: 5, start: "2026-10-25", end: "2026-10-29", can_recalibrate: false, min_points: 7, min_days: 14,
  rule_key: "nutrition/read-the-scale-with-weekly-averages", grade: "moderate", reasons: [],
};
const CHECKIN_DAY = {
  date: "2026-10-29", weight_kg: 71, waist_cm: null, intake_kcal: null, resting_heart_rate: null, hrv_ms: null,
  sleep_hours: 7, sleep_quality: null, energy: null, soreness: null, stress: null, mood: null, soreness_zones: [],
  illness: null, notes: "x", period_status: null, hormonal_contraception: null, bp_systolic: null, bp_diastolic: null,
};
const ALERT = {
  code: "cardiac_stop", sign: "cardiac", level: "stop", urgent: false,
  rule_key: "recovery-habits/cardiac-warning-symptoms-stop-and-refer", grade: "moderate",
  text: "Stop exercising and see a doctor.", professional: "clínico",
};
const URGENT = {
  ...ALERT, code: "cardiac_emergency", level: "emergency", urgent: true, text: "Llama ya a 112.", professional: null,
};

function renderIn(locale: Locale = "es") {
  const errors: string[] = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const utils = render(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider
        locale={locale}
        messages={CATALOGS[locale]}
        onError={(e) => errors.push(e.message)}
        getMessageFallback={({ namespace, key }) => `MISSING:${namespace}.${key}`}
      >
        <CheckinPage />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...utils, errors };
}

function routes(over: Record<string, unknown> = {}, post: unknown = RESULT) {
  return {
    "/api/proxy/coach/checkin": (init?: RequestInit) => ({ body: init?.method === "POST" ? post : (over.state ?? STATE) }),
    "/api/proxy/coach/trend": { body: over.trend ?? TREND_FEW },
  };
}

const posted = (calls: ReturnType<typeof mockApi>) => {
  const call = calls.mock.calls.find(([, init]) => init?.method === "POST");
  return call ? JSON.parse(String(call[1]!.body)) : null;
};

const submit = () => fireEvent.click(screen.getByRole("button", { name: /Guardar check-in|Save check-in/ }));

describe.each([["es"], ["en"]] as const)("Check-in diario (%s)", (locale) => {
  it("muestra el formulario matinal sin claves sin traducir", async () => {
    mockApi(routes());
    const { container, errors } = renderIn(locale);
    await screen.findByTestId("wellness-section");
    expect(screen.getByTestId("weight")).toBeTruthy();
    expect(screen.getByTestId("waist")).toBeTruthy();
    expect(screen.getByTestId("intake")).toBeTruthy();
    expect(screen.getByTestId("signs-section")).toBeTruthy();
    expect(errors).toEqual([]);
    expect(container.textContent).not.toContain("MISSING:");
    if (locale === "en") expect(container.textContent).not.toMatch(/[áéíóúñ¿¡]/);
  });

  it("con no_weight_targets no pide peso, cintura ni kcal, y solo manda lo demás", async () => {
    const calls = mockApi(routes({ state: { ...STATE, weight_blocked: true } }));
    renderIn(locale);
    await screen.findByTestId("checkin-blocked");
    expect(screen.queryByTestId("weight")).toBeNull();
    expect(screen.queryByTestId("waist")).toBeNull();
    expect(screen.queryByTestId("intake")).toBeNull();
    fireEvent.change(screen.getByTestId("sleep-hours"), { target: { value: "6.5" } });
    submit();
    await screen.findByTestId("checkin-result");
    expect(posted(calls)).toEqual({ sleep_hours: 6.5 });
  });

  it("manda el bienestar, el peso y no manda lo vacío", async () => {
    const calls = mockApi(routes());
    renderIn(locale);
    await screen.findByTestId("wellness-section");
    fireEvent.click(within("score-energy").getByRole("button", { name: /4/ }));
    fireEvent.click(within("score-stress").getByRole("button", { name: /2/ }));
    fireEvent.change(screen.getByTestId("weight"), { target: { value: "71.4" } });
    fireEvent.change(screen.getByTestId("notes"), { target: { value: "bien" } });
    submit();
    await screen.findByTestId("checkin-result");
    expect(posted(calls)).toEqual({ weight_kg: 71.4, energy: 4, stress: 2, notes: "bien" });
  });

  it("las preguntas semanales solo salen si el servidor las pide y mandan el resultado", async () => {
    const calls = mockApi(routes({ state: { ...STATE, weekly_questions: [{ code: "menstrual", ask_contraception: true }, { code: "bp" }] } }));
    renderIn(locale);
    await screen.findByTestId("weekly-section");
    fireEvent.click(screen.getByTestId("period-irregular_new"));
    fireEvent.click(screen.getByLabelText(locale === "es" ? /anticonceptivo/ : /hormonal contraception/));
    fireEvent.change(screen.getByTestId("bp-systolic"), { target: { value: "128" } });
    fireEvent.change(screen.getByTestId("bp-diastolic"), { target: { value: "82" } });
    submit();
    await screen.findByTestId("checkin-result");
    expect(posted(calls)).toEqual({
      period_status: "irregular_new", hormonal_contraception: true, bp_systolic: 128, bp_diastolic: 82,
    });
  });

  it("sin preguntas semanales no hay sección", async () => {
    mockApi(routes());
    renderIn(locale);
    await screen.findByTestId("signs-section");
    expect(screen.queryByTestId("weekly-section")).toBeNull();
  });

  it("las señales marcadas viajan estructuradas, y la lesión pide la zona", async () => {
    const calls = mockApi(routes());
    renderIn(locale);
    await screen.findByTestId("signs-section");
    fireEvent.click(screen.getByTestId("sign-cardiac"));
    fireEvent.click(screen.getByTestId("sign-cardiac-emergency"));
    fireEvent.click(screen.getByTestId("sign-injury"));
    const button = screen.getByRole("button", { name: /Guardar check-in|Save check-in/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(true); // lesión sin zona
    fireEvent.change(screen.getByTestId("injury-area"), { target: { value: "hombro" } });
    fireEvent.change(screen.getByTestId("injury-exercises"), { target: { value: "Press militar, Fondos" } });
    fireEvent.click(screen.getByTestId("injury-severe"));
    expect(button.disabled).toBe(false);
    submit();
    await screen.findByTestId("checkin-result");
    expect(posted(calls).signs).toEqual([
      { code: "cardiac", emergency: true },
      { code: "injury", area: "hombro", exercises: ["Press militar", "Fondos"], severe: true },
    ]);
  });

  it("una señal de urgencia sustituye al resultado por la pantalla de 'urgencia ahora'", async () => {
    mockApi(routes({}, { ...RESULT, alerts: [URGENT], safety: { ...SAFETY_AFTER, refer_gp: true, deferral_line: "Habla con tu médico.", flags: { no_training: true } } }));
    renderIn(locale);
    await screen.findByTestId("signs-section");
    fireEvent.click(screen.getByTestId("sign-cardiac"));
    submit();
    const screenEl = await screen.findByTestId("urgent-screen");
    expect(screenEl.textContent).toContain("Llama ya a 112.");
    expect(screen.getByTestId("urgent-call").getAttribute("href")).toBe("tel:112");
    expect(screenEl.textContent).toContain("Habla con tu médico.");
    expect(screen.queryByTestId("checkin-result")).toBeNull();
  });

  it("un aviso que no es de urgencia sale en el resultado con su regla, el profesional y la línea de derivación", async () => {
    mockApi(
      routes({}, {
        ...RESULT,
        alerts: [ALERT],
        safety: { ...SAFETY_AFTER, refer_gp: true, deferral_line: "Habla con tu médico.", flags: { no_training: true } },
      }),
    );
    renderIn(locale);
    await screen.findByTestId("signs-section");
    fireEvent.click(screen.getByTestId("sign-cardiac"));
    submit();
    const alerts = await screen.findByTestId("checkin-alerts");
    expect(alerts.textContent).toContain("Stop exercising and see a doctor.");
    expect(alerts.textContent).toContain("clínico");
    expect(alerts.querySelector("[data-testid=evidence-chip]")).toBeTruthy();
    expect(screen.getByTestId("checkin-deferral").textContent).toContain("Habla con tu médico.");
    expect(screen.queryByTestId("urgent-screen")).toBeNull();
  });

  it("tras guardar un peso, el resultado dice solo el estado de la tendencia (insuficiente) y cuántos faltan", async () => {
    mockApi(routes());
    renderIn(locale);
    await screen.findByTestId("wellness-section");
    fireEvent.change(screen.getByTestId("weight"), { target: { value: "71" } });
    submit();
    const box = await screen.findByTestId("trend-insufficient");
    expect(box.textContent).toMatch(/\b7\b/);
    expect(box.textContent).toMatch(/\b4\b/); // faltan 4
    expect(screen.queryByTestId("trend-ok")).toBeNull();
  });

  it("sin peso no se comenta la tendencia", async () => {
    mockApi(routes());
    renderIn(locale);
    await screen.findByTestId("wellness-section");
    fireEvent.change(screen.getByTestId("sleep-hours"), { target: { value: "7" } });
    submit();
    await screen.findByTestId("checkin-result");
    expect(screen.queryByTestId("trend-insufficient")).toBeNull();
    expect(screen.queryByTestId("trend-ok")).toBeNull();
  });

  it("el resultado cita la readiness y la HRV opcional cuando la HRV cae", async () => {
    mockApi(
      routes({}, {
        ...RESULT,
        readiness: { ...READINESS, status: "easy", drops_today: ["energy"], hrv_drop: true },
      }),
    );
    renderIn(locale);
    await screen.findByTestId("wellness-section");
    fireEvent.click(within("score-energy").getByRole("button", { name: /2/ }));
    submit();
    const card = await screen.findByTestId("readiness-card");
    expect(card.getAttribute("data-status")).toBe("easy");
    expect(card.querySelectorAll("[data-testid=evidence-chip][data-variant=evidence]").length).toBe(2);
    expect(card.querySelectorAll("[data-testid=evidence-chip][data-variant=convention]").length).toBe(1);
    expect(card.textContent).toContain(CATALOGS[locale].checkin.wellness.scores.energy.label);
  });

  it("un rechazo del servidor (400) se explica y no cambia de pantalla", async () => {
    mockApi({
      "/api/proxy/coach/checkin": (init?: RequestInit) =>
        init?.method === "POST" ? { status: 400, body: { weight_kg: "20 is outside 25-400" } } : { body: STATE },
    });
    renderIn(locale);
    await screen.findByTestId("wellness-section");
    fireEvent.change(screen.getByTestId("weight"), { target: { value: "20" } });
    submit();
    const err = await screen.findByTestId("checkin-error");
    expect(err.textContent).toContain("weight_kg");
    expect(screen.queryByTestId("checkin-result")).toBeNull();
  });

  it("un 403 weight_targets_blocked dice que no se puede guardar", async () => {
    mockApi({
      "/api/proxy/coach/checkin": (init?: RequestInit) =>
        init?.method === "POST" ? { status: 403, body: { code: "weight_targets_blocked", fields: ["weight_kg"] } } : { body: STATE },
    });
    renderIn(locale);
    await screen.findByTestId("wellness-section");
    fireEvent.change(screen.getByTestId("weight"), { target: { value: "70" } });
    submit();
    expect((await screen.findByTestId("checkin-error")).textContent).toBe(CATALOGS[locale].checkin.errors.blocked);
  });

  it("avisa de que ya hay un check-in hoy", async () => {
    mockApi(routes({ state: { ...STATE, checkin: CHECKIN_DAY } }));
    renderIn(locale);
    await screen.findByTestId("checkin-already");
  });

  it("los campos de pulsómetro son opcionales y citan 'HRV is optional'", async () => {
    const calls = mockApi(routes());
    renderIn(locale);
    await screen.findByTestId("wellness-section");
    expect(screen.queryByTestId("hrv")).toBeNull();
    fireEvent.click(screen.getByText(CATALOGS[locale].checkin.data.optionalToggle));
    expect(screen.getByTestId("hrv")).toBeTruthy();
    fireEvent.change(screen.getByTestId("hrv"), { target: { value: "70" } });
    fireEvent.change(screen.getByTestId("rhr"), { target: { value: "52" } });
    submit();
    await screen.findByTestId("checkin-result");
    expect(posted(calls)).toEqual({ resting_heart_rate: 52, hrv_ms: 70 });
  });

  it("'Añadir algo más' vuelve al formulario vacío", async () => {
    mockApi(routes());
    renderIn(locale);
    await screen.findByTestId("wellness-section");
    fireEvent.change(screen.getByTestId("sleep-hours"), { target: { value: "7" } });
    submit();
    await screen.findByTestId("checkin-result");
    fireEvent.click(screen.getByText(CATALOGS[locale].checkin.result.again));
    await waitFor(() => expect(screen.getByTestId("sleep-hours")).toBeTruthy());
    expect((screen.getByTestId("sleep-hours") as HTMLInputElement).value).toBe("");
  });
});

function within(testId: string) {
  const el = screen.getByTestId(testId);
  return { getByRole: (role: string, opts: { name: RegExp }) => {
    const found = [...el.querySelectorAll("button")].find((b) => opts.name.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));
    if (!found) throw new Error(`sin ${role} ${opts.name} en ${testId}`);
    return found;
  } };
}
