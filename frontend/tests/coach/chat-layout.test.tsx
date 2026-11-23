import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import es from "@/messages/es.json";
import { ChatPanel, type ChatMsg } from "@/components/coach/ChatPanel";
import { TabBar } from "@/components/tab-bar";
import { isTextEntry } from "@/lib/viewport";

vi.mock("next/navigation", () => ({ usePathname: () => "/coach" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a>,
}));
vi.mock("@/components/evidence/CitedText", () => ({
  CitedText: ({ text }: { text: string }) => <span>{text}</span>,
}));

// F4 de la prueba en móvil: la conversación vivía en una caja de 137 px y, con el teclado
// abierto, la barra de navegación tapaba la respuesta.

function inEs(ui: React.ReactNode) {
  return render(<NextIntlClientProvider locale="es" messages={es}>{ui}</NextIntlClientProvider>);
}

function mockPointer(coarse: boolean) {
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: coarse && q.includes("coarse"), media: q, addEventListener() {}, removeEventListener() {},
  }));
}

const MSGS: ChatMsg[] = [
  { role: "coach", text: "Hola" },
  { role: "user", text: "¿Cómo voy?" },
  { role: "coach", text: "Vas bien" },
];

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
});

describe("chat del coach a pantalla completa (F4)", () => {
  it("al tocar el campo ocupa toda la zona visible, encima de la barra, y se cierra", () => {
    const onSend = vi.fn();
    inEs(<ChatPanel msgs={MSGS} typing={false} input="" onInput={() => {}} onSend={onSend} modeLabel="IA" />);
    const chat = screen.getByTestId("coach-chat");
    expect(chat.dataset.expanded).toBe("false");

    fireEvent.focus(screen.getByPlaceholderText("Pregunta a tu coach…"));
    expect(chat.dataset.expanded).toBe("true");
    expect(screen.getByRole("dialog", { name: "Habla con tu coach" })).toBe(chat);
    expect(chat.className).toMatch(/\bfixed\b/);
    expect(chat.className).toMatch(/\bz-50\b/); // la barra de navegación es z-40
    // Alto = la zona visible de verdad (visualViewport, sin el teclado), no una caja fija
    expect(chat.style.height).toBe(`${window.innerHeight}px`);
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.click(screen.getByText("Cerrar chat"));
    expect(chat.dataset.expanded).toBe("false");
    expect(document.body.style.overflow).toBe("");
  });

  it("sigue el alto de visualViewport cuando se abre el teclado y baja al último mensaje", async () => {
    const listeners: Record<string, () => void> = {};
    const vv = {
      height: 681, offsetTop: 0, scale: 1,
      addEventListener: (ev: string, cb: () => void) => { listeners[ev] = cb; },
      removeEventListener: () => {},
    };
    vi.stubGlobal("visualViewport", vv);
    inEs(<ChatPanel msgs={MSGS} typing={false} input="" onInput={() => {}} onSend={() => {}} modeLabel="IA" />);
    const log = screen.getByTestId("coach-chat-log");
    Object.defineProperty(log, "scrollHeight", { configurable: true, value: 900 });

    fireEvent.click(screen.getByRole("button", { name: "¿Cómo voy?" })); // una pregunta rápida también amplía
    const chat = screen.getByTestId("coach-chat");
    expect(chat.style.height).toBe("681px");

    vv.height = 330; // teclado abierto
    vv.offsetTop = 40;
    act(() => listeners.resize());
    await waitFor(() => expect(chat.style.height).toBe("330px"));
    expect(chat.style.top).toBe("40px");
    expect(log.scrollTop).toBe(900);
  });

  it("no usa scrollIntoView, que arrastraba la página entera hasta el chat", () => {
    const spy = vi.fn();
    Element.prototype.scrollIntoView = spy;
    inEs(<ChatPanel msgs={MSGS} typing={true} input="" onInput={() => {}} onSend={() => {}} modeLabel="IA" />);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("barra de navegación con el teclado abierto (F4)", () => {
  it("en pantalla táctil se esconde mientras un campo de texto tiene el foco", () => {
    mockPointer(true);
    const { container } = inEs(<><TabBar /><input placeholder="campo" /><input type="date" aria-label="fecha" /></>);
    const nav = screen.getByTestId("tab-bar");
    expect(nav.hidden).toBe(false);

    const field = screen.getByPlaceholderText("campo");
    act(() => { field.focus(); });
    expect(nav.hidden).toBe(true);
    expect(nav.className).toMatch(/\bhidden\b/);

    act(() => { field.blur(); });
    expect(nav.hidden).toBe(false);

    // Un selector de fecha no abre el teclado: la barra sigue
    act(() => { (container.querySelector('input[type="date"]') as HTMLInputElement).focus(); });
    expect(nav.hidden).toBe(false);
  });

  it("con ratón no se esconde al escribir", () => {
    mockPointer(false);
    inEs(<><TabBar /><input placeholder="campo" /></>);
    act(() => { screen.getByPlaceholderText("campo").focus(); });
    expect(screen.getByTestId("tab-bar").hidden).toBe(false);
  });

  it("isTextEntry: texto y número sí; fecha, casillas, botones y solo lectura no", () => {
    const mk = (html: string) => {
      const d = document.createElement("div");
      d.innerHTML = html;
      return d.firstElementChild;
    };
    expect(isTextEntry(mk("<input>"))).toBe(true);
    expect(isTextEntry(mk('<input inputmode="decimal">'))).toBe(true);
    expect(isTextEntry(mk("<textarea></textarea>"))).toBe(true);
    expect(isTextEntry(mk('<input type="date">'))).toBe(false);
    expect(isTextEntry(mk('<input type="checkbox">'))).toBe(false);
    expect(isTextEntry(mk('<input readonly>'))).toBe(false);
    expect(isTextEntry(mk('<input inputmode="none">'))).toBe(false);
    expect(isTextEntry(mk("<button>x</button>"))).toBe(false);
    expect(isTextEntry(null)).toBe(false);
  });
});
