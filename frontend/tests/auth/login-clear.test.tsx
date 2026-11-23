import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import es from "@/messages/es.json";

vi.mock("@/lib/activities", () => ({ resetActivityUid: vi.fn() }));
vi.mock("@/lib/user-state", () => ({ claimDeviceForCurrentUser: vi.fn(async () => {}) }));

import LoginPage from "@/app/login/page";

describe("login: estado de pestaña del dueño anterior", () => {
  it("un login correcto borra el chat del coach (flp_*) de la sesión anterior", async () => {
    sessionStorage.setItem("flp_coach_chat", JSON.stringify([{ role: "user", content: "de A" }]));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign, search: "" });
    const { container } = render(
      <NextIntlClientProvider locale="es" messages={es}>
        <LoginPage />
      </NextIntlClientProvider>,
    );
    const [email, pass] = [...container.querySelectorAll("input")];
    fireEvent.change(email, { target: { value: "b@b.com" } });
    fireEvent.change(pass, { target: { value: "12345678" } });
    fireEvent.submit(container.querySelector("form")!);
    await waitFor(() => expect(assign).toHaveBeenCalledWith("/today"));
    expect(sessionStorage.getItem("flp_coach_chat")).toBeNull();
    vi.unstubAllGlobals();
  });
});
