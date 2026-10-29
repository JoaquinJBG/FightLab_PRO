import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import es from "@/messages/es.json";
import en from "@/messages/en.json";

const navState = vi.hoisted(() => ({ token: "abc" as string | null, pathname: "/dashboard" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => navState.pathname,
  useSearchParams: () => ({ get: () => navState.token }),
}));
vi.mock("@/lib/hooks", () => ({
  useProfile: () => ({ data: { goal: null }, isLoading: true, isError: false }),
  useScreening: () => ({ data: undefined, isLoading: true }),
  useUpdateProfile: () => ({ mutate: vi.fn() }),
}));

import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/register/page";
import VerifyEmailPage from "@/app/verify-email/page";
import { TabBar } from "@/components/tab-bar";
import { ModulePlaceholder } from "@/components/placeholder";
import { OnboardingGate } from "@/components/onboarding-gate";

const RAW_KEY = /^[a-z]+(\.[A-Za-z]+)+$/;
const ES_WORDS = /Contraseña|Entrar|Entrando|cuenta|Verificación|Verificando|Inicio|Entreno|Nutrición|Perfil|Próximamente|Cargando|Mostrar|Ocultar|Revisa|caracteres|Credenciales|¿/;

function renderIn(locale: "es" | "en", ui: React.ReactNode) {
  const errors: unknown[] = [];
  const messages = (locale === "es" ? es : en) as unknown as Record<string, unknown>;
  const utils = render(
    <NextIntlClientProvider locale={locale} messages={messages} onError={(e) => errors.push(e)}>
      {ui}
    </NextIntlClientProvider>,
  );
  return { ...utils, errors };
}

function check(locale: "es" | "en", container: HTMLElement, errors: unknown[]) {
  expect(errors).toEqual([]);
  const text = container.textContent ?? "";
  const nodes = [...container.querySelectorAll("*")]
    .filter((n) => n.children.length === 0)
    .map((n) => n.textContent?.trim() ?? "");
  expect(nodes.filter((s) => RAW_KEY.test(s))).toEqual([]);
  const attrs = [...container.querySelectorAll("[placeholder],[aria-label]")].map(
    (n) => `${n.getAttribute("placeholder") ?? ""} ${n.getAttribute("aria-label") ?? ""}`,
  );
  if (locale === "en") expect(`${text} ${attrs.join(" ")}`).not.toMatch(ES_WORDS);
}

afterEach(() => {
  vi.unstubAllGlobals();
  navState.token = "abc";
  navState.pathname = "/dashboard";
});

describe.each(["en", "es"] as const)("auth y navegación (%s)", (locale) => {
  it("login", async () => {
    const { container, errors } = renderIn(locale, <LoginPage />);
    check(locale, container, errors);
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(container.querySelector("p.text-bad")).not.toBeNull());
    check(locale, container, errors);
    expect(container.querySelector("p.text-bad")!.textContent).toBe(
      locale === "en" ? "Invalid email" : "Email no válido",
    );
  });

  it("login con credenciales rechazadas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { container, errors } = renderIn(locale, <LoginPage />);
    const [email, pass] = [...container.querySelectorAll("input")];
    fireEvent.change(email, { target: { value: "a@b.com" } });
    fireEvent.change(pass, { target: { value: "12345678" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(container.querySelector("p.text-bad")).not.toBeNull());
    check(locale, container, errors);
  });

  it("registro: checklist, mostrar/ocultar y pantalla de éxito", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 201 }));
    const { container, errors } = renderIn(locale, <RegisterPage />);
    check(locale, container, errors);
    const [email, pass] = [...container.querySelectorAll("input")];
    fireEvent.change(email, { target: { value: "ana@mail.com" } });
    fireEvent.change(pass, { target: { value: "abc12345xyz" } });
    check(locale, container, errors);
    fireEvent.click(screen.getByRole("button", { name: locale === "en" ? "Show" : "Mostrar" }));
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(container.textContent).toContain("ana@mail.com"));
    check(locale, container, errors);
  });

  it("registro: requisitos sin cumplir", async () => {
    const { container, errors } = renderIn(locale, <RegisterPage />);
    const [email, pass] = [...container.querySelectorAll("input")];
    fireEvent.change(email, { target: { value: "ana@mail.com" } });
    fireEvent.change(pass, { target: { value: "12345678" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(container.querySelector("p.text-bad")).not.toBeNull());
    check(locale, container, errors);
  });

  it("verificación: ok y error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const a = renderIn(locale, <VerifyEmailPage />);
    await waitFor(() => expect(a.container.querySelector("a")).not.toBeNull());
    check(locale, a.container, a.errors);
    a.unmount();
    navState.token = null;
    const b = renderIn(locale, <VerifyEmailPage />);
    await waitFor(() => expect(b.container.querySelector("a")).not.toBeNull());
    check(locale, b.container, b.errors);
  });

  it("menú inferior", () => {
    const { container, errors } = renderIn(locale, <TabBar />);
    check(locale, container, errors);
    expect(container.querySelectorAll("a")).toHaveLength(5);
    expect(container.textContent).toContain(locale === "en" ? "Training" : "Entreno");
  });

  it("placeholder y puerta de onboarding", () => {
    const a = renderIn(locale, <ModulePlaceholder icon={null} title="T" tag="X" description="D" />);
    check(locale, a.container, a.errors);
    const b = renderIn(locale, <OnboardingGate>hijo</OnboardingGate>);
    check(locale, b.container, b.errors);
    expect(b.container.textContent).toContain(locale === "en" ? "Loading…" : "Cargando…");
  });
});
