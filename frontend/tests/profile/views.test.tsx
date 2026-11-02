import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import ProfilePage from "@/app/(shell)/profile/page";
import ProfileEditPage from "@/app/(shell)/profile/edit/page";
import { ProfileForm } from "@/components/profile-form";
import { expectClean, renderEn } from "../coach/_helpers";

const state = vi.hoisted(() => ({ profile: null as unknown, mutate: (() => Promise.resolve()) as (p: unknown) => Promise<unknown>, refresh: () => {} }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: () => state.refresh() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));
vi.mock("@/components/safety/SafetyBanner", () => ({ SafetyBanner: () => <div data-testid="safety-stub" /> }));
vi.mock("@/lib/hooks", () => ({
  useMe: () => ({ data: { id: 1, email: "ana@example.com", role: "ATHLETE" } }),
  useProfile: () => ({ data: state.profile }),
  useLogout: () => ({ mutateAsync: vi.fn() }),
  useUpdateProfile: () => ({ isPending: false, isError: false, isSuccess: true, mutateAsync: (p: unknown) => state.mutate(p), error: null }),
}));

const full = { date_of_birth: "1995-03-07", gender: "FEMALE", height_cm: 170, dominant_stance: "SOUTHPAW", preferred_units: "IMPERIAL", timezone: "UTC", language: "en" };

beforeEach(() => { state.profile = full; });

describe("Perfil en inglés", () => {
  it("con datos: etiquetas y valores de enums traducidos", () => {
    const { container } = renderEn(<ProfilePage />);
    expect(screen.getByText("Profile")).toBeTruthy();
    expect(screen.getByText("Female")).toBeTruthy();
    expect(screen.getByText("Southpaw")).toBeTruthy();
    expect(screen.getByText("Imperial")).toBeTruthy();
    expect(screen.getByText("170 cm")).toBeTruthy();
    expect(screen.getByText("Sign out")).toBeTruthy();
    expectClean(container, [/@example\.com/]);
  });

  it("vacío: muestra guiones y sin español", () => {
    state.profile = { ...full, date_of_birth: null, gender: null, height_cm: null, dominant_stance: null };
    const { container } = renderEn(<ProfilePage />);
    expect(screen.getAllByText("—").length).toBeGreaterThan(3);
    expectClean(container, [/@example\.com/]);
  });

  it("valor desconocido del servidor: se muestra sin romper", () => {
    state.profile = { ...full, gender: "XYZ" };
    renderEn(<ProfilePage />);
    expect(screen.getByText("XYZ")).toBeTruthy();
  });
});

describe("Editar perfil en inglés", () => {
  it("formulario con opciones y etiquetas traducidas", () => {
    const { container } = renderEn(<ProfileEditPage />);
    expect(screen.getByText("← Profile")).toBeTruthy();
    expect(screen.getByText("profile")).toBeTruthy();
    expect(screen.getByLabelText("Day")).toBeTruthy();
    expect(screen.getByLabelText("Year")).toBeTruthy();
    expect(screen.getByText("Metric (kg · cm)")).toBeTruthy();
    expect(screen.getByText("Orthodox")).toBeTruthy();
    expect(screen.getByText("Save changes")).toBeTruthy();
    expect(screen.getByText("Saved ✓")).toBeTruthy();
    expectClean(container);
  });

  it("fecha incompleta: el error sale en inglés", () => {
    state.profile = { ...full, date_of_birth: null };
    renderEn(<ProfileEditPage />);
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "5" } });
    fireEvent.click(screen.getByText("Save changes"));
    expect(screen.getByText("Complete the date (day, month and 4-digit year).")).toBeTruthy();
  });
});

describe("Idioma en el perfil", () => {
  it("con el selector apagado no aparece ni se envía", async () => {
    const mutate = vi.fn().mockResolvedValue({});
    state.mutate = mutate;
    renderEn(<ProfileForm submitLabel="Save" onSaved={() => {}} selectorEnabled={false} />);
    expect(screen.queryByTestId("profile-language")).toBeNull();
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(mutate).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0]).not.toHaveProperty("language");
  });

  it("con el selector encendido se cambia, se envía y se recargan los textos", async () => {
    const mutate = vi.fn().mockResolvedValue({});
    const refresh = vi.fn();
    state.mutate = mutate;
    state.refresh = refresh;
    renderEn(<ProfileForm submitLabel="Save" onSaved={() => {}} selectorEnabled />);
    const select = screen.getByTestId("profile-language") as HTMLSelectElement;
    expect(screen.getByText("Language")).toBeTruthy();
    expect(select.value).toBe("en");
    fireEvent.change(select, { target: { value: "es" } });
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(mutate.mock.calls[0][0]).toMatchObject({ language: "es" });
  });
});
