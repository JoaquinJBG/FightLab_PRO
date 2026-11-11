import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import es from "@/messages/es.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("uid=MQ&token=abc-123"),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));

import ResetPasswordPage from "@/app/reset-password/page";
import LoginPage from "@/app/login/page";

// F27 de la prueba en móvil: sin campo de usuario, Chrome no sabía de qué cuenta era la contraseña
// nueva, sugería la suya y la puso en los dos campos.

const inEs = (ui: React.ReactNode) => render(<NextIntlClientProvider locale="es" messages={es}>{ui}</NextIntlClientProvider>);

afterEach(() => vi.unstubAllGlobals());

describe("autocompletar del gestor de contraseñas (F27)", () => {
  it("la nueva contraseña lleva el usuario oculto con el email del enlace y new-password", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ email: "ana@example.com" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = inEs(<ResetPasswordPage />);
    const user = await screen.findByTestId("reset-username");
    await waitFor(() => expect((user as HTMLInputElement).value).toBe("ana@example.com"));
    expect(user.getAttribute("autocomplete")).toBe("username");
    expect(user.className).toContain("sr-only");
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/password-reset/check", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body).toEqual({ uid: "MQ", token: "abc-123" });
    const pw = container.querySelectorAll('input[type="password"]');
    expect(pw).toHaveLength(2);
    for (const p of pw) expect(p.getAttribute("autocomplete")).toBe("new-password");
    // El usuario va antes que las contraseñas, dentro del mismo formulario
    expect(user.closest("form")).toBe(pw[0].closest("form"));
  });

  it("con un enlace malo el usuario queda vacío y la pantalla sigue igual", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    inEs(<ResetPasswordPage />);
    const user = (await screen.findByTestId("reset-username")) as HTMLInputElement;
    await new Promise((r) => setTimeout(r, 0));
    expect(user.value).toBe("");
  });

  it("la entrada: usuario y current-password", () => {
    const { container } = inEs(<LoginPage />);
    expect(container.querySelector('input[type="email"]')?.getAttribute("autocomplete")).toBe("username");
    expect(container.querySelector('input[type="password"]')?.getAttribute("autocomplete")).toBe("current-password");
  });
});
