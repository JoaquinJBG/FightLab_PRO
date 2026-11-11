import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import AddFoodPage from "@/app/(shell)/nutrition/add/page";
import { BarcodeScanner } from "@/components/scanner/BarcodeScanner";
import {
  cameraErrorKind, checkDigitOk, expandUpcE, normalizeBarcode, parseDecimal, portionGrams, startScanner,
} from "@/lib/barcode";
import { CATALOGS, mockApi, renderApp } from "../support/app";

// Escáner de código de barras con la cámara SIMULADA: getUserMedia devuelve un stream falso y
// BarcodeDetector (o ZXing, si no hay) "lee" el código que pone cada prueba. Ninguna llamada a
// Open Food Facts: /api/proxy está simulado. Productos y códigos INVENTADOS.

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("meal=Comida"),
}));

const zxing = vi.hoisted(() => ({ imported: 0, code: "", format: 0 }));
vi.mock("@zxing/browser", () => {
  zxing.imported += 1;
  return {
    BrowserMultiFormatOneDReader: class {
      async decodeFromStream(_s: unknown, _v: unknown, cb: (r: unknown) => void) {
        setTimeout(() => cb({ getText: () => zxing.code, getBarcodeFormat: () => zxing.format }), 0);
        return { stop: vi.fn() };
      }
    },
  };
});

// Los números de `BarcodeFormat` de ZXing (los de la librería real), sin cargarla entera.
vi.mock("@zxing/library", () => ({
  BarcodeFormat: { EAN_8: 6, EAN_13: 7, UPC_A: 14, UPC_E: 15 },
  DecodeHintType: { POSSIBLE_FORMATS: 2 },
}));

const OFF_EAN = "8400000000017";
const es = CATALOGS.es.scanner;

type Cam = { applyConstraints: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> };
let cam: Cam;

function fakeCamera({ torch = false, fail }: { torch?: boolean; fail?: string } = {}) {
  cam = { applyConstraints: vi.fn().mockResolvedValue(undefined), stop: vi.fn() };
  const track = { getCapabilities: () => ({ torch }), applyConstraints: cam.applyConstraints, stop: cam.stop };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const getUserMedia = fail
    ? vi.fn().mockRejectedValue(Object.assign(new Error(fail), { name: fail }))
    : vi.fn().mockResolvedValue(stream);
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  return getUserMedia;
}

function fakeDetector(rawValue: string, format = "ean_13") {
  const detect = vi.fn().mockResolvedValue([{ rawValue, format }]);
  vi.stubGlobal("BarcodeDetector", Object.assign(
    class { detect = detect; },
    { getSupportedFormats: async () => ["ean_13", "ean_8", "upc_a", "upc_e", "qr_code"] },
  ));
  return detect;
}

beforeEach(() => {
  push.mockClear();
  localStorage.clear();
  Object.defineProperty(HTMLMediaElement.prototype, "readyState", { get: () => 4, configurable: true });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("el código", () => {
  it("comprueba el dígito de control de EAN-13, EAN-8, UPC-A y GTIN-14", () => {
    expect(checkDigitOk("4006381333931")).toBe(true);
    expect(checkDigitOk("4006381333932")).toBe(false);
    expect(checkDigitOk("96385074")).toBe(true);
    expect(checkDigitOk("036000291452")).toBe(true);
    expect(checkDigitOk("00036000291452")).toBe(true);
    expect(checkDigitOk("12345")).toBe(false);
  });

  it("expande el UPC-E a UPC-A", () => {
    expect(expandUpcE("04252614")).toBe("042100005264");
    expect(expandUpcE("01234565")).toBe("012345000065");
    expect(normalizeBarcode("04252614", "upc_e")).toBe("042100005264");
    expect(normalizeBarcode("96385074", "ean_8")).toBe("96385074");
    expect(normalizeBarcode(" 8400-0000-0001-7 ")).toBe(OFF_EAN);
    expect(normalizeBarcode("8400000000018")).toBeNull();
  });

  it("dice por qué no arranca la cámara", () => {
    expect(cameraErrorKind({ name: "NotAllowedError" })).toBe("denied");
    expect(cameraErrorKind({ name: "NotFoundError" })).toBe("noCamera");
    expect(cameraErrorKind({ name: "NotSupportedError" })).toBe("unsupported");
    expect(cameraErrorKind(new Error("x"))).toBe("failed");
  });

  it("cantidad en gramos, raciones o envases, con coma o punto", () => {
    const p = { serving_g: 125, pack_g: 500 };
    expect(portionGrams(p, "g", 150)).toBe(150);
    expect(portionGrams(p, "serving", 1.5)).toBe(188);
    expect(portionGrams(p, "pack", 1)).toBe(500);
    expect(portionGrams({ serving_g: null, pack_g: null }, "serving", 1)).toBeNull();
    expect(portionGrams(p, "g", 0)).toBeNull();
    expect(parseDecimal("1,5")).toBe(1.5);
    expect(parseDecimal("1.5")).toBe(1.5);
    expect(parseDecimal("1,5,2")).toBeNull();
  });
});

describe("la cámara", () => {
  it("con BarcodeDetector usa la cámara trasera, lee el código y no carga ZXing", async () => {
    const getUserMedia = fakeCamera();
    fakeDetector(OFF_EAN);
    const before = zxing.imported;
    const onCode = vi.fn();
    const scanner = await startScanner(document.createElement("video"), onCode);
    await waitFor(() => expect(onCode).toHaveBeenCalledWith(OFF_EAN));
    expect(scanner.engine).toBe("native");
    expect(getUserMedia.mock.calls[0][0].video.facingMode).toEqual({ ideal: "environment" });
    expect(zxing.imported).toBe(before);
    scanner.stop();
    expect(cam.stop).toHaveBeenCalled();
  });

  it("sin BarcodeDetector carga ZXing y expande el UPC-E", async () => {
    fakeCamera();
    zxing.code = "04252614";
    zxing.format = 15; // BarcodeFormat.UPC_E
    const onCode = vi.fn();
    const scanner = await startScanner(document.createElement("video"), onCode);
    expect(scanner.engine).toBe("zxing");
    await waitFor(() => expect(onCode).toHaveBeenCalledWith("042100005264"));
    scanner.stop();
  }, 20_000); // el import dinámico de ZXing tarda más con la suite entera en paralelo

  it("ignora un código con el dígito de control mal", async () => {
    fakeCamera();
    fakeDetector("8400000000018");
    const onCode = vi.fn();
    const scanner = await startScanner(document.createElement("video"), onCode);
    await new Promise((r) => setTimeout(r, 30));
    expect(onCode).not.toHaveBeenCalled();
    scanner.stop();
  });

  it("permiso denegado: mensaje claro y el código a mano sigue", async () => {
    fakeCamera({ fail: "NotAllowedError" });
    const onCode = vi.fn();
    renderApp(<BarcodeScanner onCode={onCode} onClose={vi.fn()} />);
    expect((await screen.findByTestId("scanner-error")).textContent).toBe(es.errors.denied);
    fireEvent.change(screen.getByTestId("scanner-manual"), { target: { value: "8400000000018" } });
    fireEvent.click(screen.getByTestId("scanner-manual-go"));
    expect(screen.getByText(es.manualInvalid)).toBeTruthy();
    fireEvent.change(screen.getByTestId("scanner-manual"), { target: { value: OFF_EAN } });
    fireEvent.click(screen.getByTestId("scanner-manual-go"));
    expect(onCode).toHaveBeenCalledWith(OFF_EAN);
  });

  it("linterna solo si el móvil la tiene", async () => {
    fakeCamera({ torch: true });
    vi.stubGlobal("BarcodeDetector", Object.assign(class { detect = vi.fn().mockResolvedValue([]); }, {}));
    renderApp(<BarcodeScanner onCode={vi.fn()} onClose={vi.fn()} />);
    const torch = await screen.findByTestId("scanner-torch");
    expect(torch.textContent).toBe(es.torchOn);
    await act(async () => fireEvent.click(torch));
    expect(cam.applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
    expect(screen.getByTestId("scanner-torch").textContent).toBe(es.torchOff);
    cleanup();

    fakeCamera({ torch: false });
    renderApp(<BarcodeScanner onCode={vi.fn()} onClose={vi.fn()} />);
    await screen.findByTestId("scanner-engine");
    expect(screen.queryByTestId("scanner-torch")).toBeNull();
  });
});

const RATING = { rating: "bueno", check: "ok", nutriscore: "A", rule_key: "food-products/rate-packaged-products-with-nutri-score-and-uk-traffic-lights" };
const OFF_PRODUCT = {
  source: "off",
  attribution: { source: "Open Food Facts (unverified)", licence: "ODbL", url: "https://world.openfoodfacts.org/" },
  product: {
    barcode: OFF_EAN, name: "Yogur inventado", brand: "Marca Prueba", chain: null, pack: null, pack_g: null,
    serving_g: 125, per: "100 g", kcal: 60, protein_g: 4, carbs_g: 5, fat_g: 2.4, fibre_g: 0, missing: [],
    url: `https://world.openfoodfacts.org/product/${OFF_EAN}`, unverified: true, rating: RATING,
  },
};

describe("Nutrición → Añadir: escanear", () => {
  it("encuentra el producto, elige raciones y lo añade al diario; el mismo código no se busca dos veces", async () => {
    fakeCamera();
    fakeDetector(OFF_EAN);
    const api = mockApi({ [`/api/proxy/coach/barcode/${OFF_EAN}`]: { body: OFF_PRODUCT } });
    renderApp(<AddFoodPage />);
    fireEvent.click(screen.getByTestId("scan-open"));
    expect(await screen.findByTestId("scan-result")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("scan-result").dataset.state).toBe("found"));
    expect(screen.getByTestId("scan-name").textContent).toContain("Yogur inventado");
    expect(screen.getByTestId("scan-source").textContent).toBe(es.result.sources.off);
    expect(screen.getByTestId("rating-badge").dataset.rating).toBe("bueno");
    // Por defecto 1 ración de 125 g.
    expect(screen.getByTestId("scan-unit-serving").getAttribute("aria-pressed")).toBe("true");
    fireEvent.change(screen.getByTestId("scan-amount"), { target: { value: "2" } });
    expect(screen.getByTestId("scan-grams").textContent).toBe("250 g");
    expect(screen.getByTestId("scan-macros").textContent).toBe("150 kcal · P 10 · C 13 · G 6");

    // Escanear otra vez el mismo código: no hay otra llamada.
    fireEvent.click(screen.getByTestId("scan-again"));
    await waitFor(() => expect(screen.getByTestId("scan-result").dataset.state).toBe("found"));
    expect(api.mock.calls.filter(([u]) => String(u).includes("/barcode/"))).toHaveLength(1);

    fireEvent.click(screen.getByTestId("scan-unit-g"));
    fireEvent.change(screen.getByTestId("scan-amount"), { target: { value: "200" } });
    fireEvent.click(screen.getByTestId("scan-add"));
    const day = Object.keys(localStorage).find((k) => k.startsWith("flp_nutri_")) as string;
    const [item] = JSON.parse(localStorage.getItem(day) as string);
    expect(item).toMatchObject({ meal: "Comida", name: "Yogur inventado", grams: 200, kcal: 120, p: 8, c: 10, f: 5, source: "food" });
    expect(push).toHaveBeenCalledWith("/nutrition");
  });

  it("no encontrado: lo crea a mano con ese código y lo añade", async () => {
    fakeCamera();
    fakeDetector(OFF_EAN);
    const posts: unknown[] = [];
    mockApi({
      [`/api/proxy/coach/barcode/${OFF_EAN}`]: (init) => {
        if (init?.method === "POST") {
          posts.push(JSON.parse(String(init.body)));
          return { status: 201, body: { ...OFF_PRODUCT, source: "manual", attribution: undefined, warnings: [],
            product: { ...OFF_PRODUCT.product, name: "Turrón casero", serving_g: null, url: null, unverified: false, kcal: 500 } } };
        }
        return { status: 404, body: { code: "not_found", barcode: OFF_EAN, off: "off_not_configured" } };
      },
    });
    renderApp(<AddFoodPage />);
    fireEvent.click(screen.getByTestId("scan-open"));
    expect((await screen.findByTestId("scan-not-found")).textContent).toBe(es.result.notFound.off_not_configured);
    fireEvent.click(screen.getByTestId("scan-create"));
    fireEvent.change(screen.getByTestId("manual-name"), { target: { value: "Turrón casero" } });
    fireEvent.change(screen.getByTestId("manual-kcal"), { target: { value: "500" } });
    fireEvent.change(screen.getByTestId("manual-protein_g"), { target: { value: "10,5" } });
    fireEvent.click(screen.getByTestId("manual-save"));
    await waitFor(() => expect(screen.getByTestId("scan-result").dataset.source).toBe("manual"));
    expect(posts[0]).toMatchObject({ name: "Turrón casero", per: "100 g", kcal: 500, protein_g: 10.5, carbs_g: null });
    expect(screen.getByTestId("scan-source").textContent).toBe(es.result.sources.manual);
    fireEvent.click(screen.getByTestId("scan-add"));
    expect(push).toHaveBeenCalledWith("/nutrition");
  });

  it("un número imposible en el alimento a mano no se envía", async () => {
    fakeCamera();
    fakeDetector(OFF_EAN);
    const api = mockApi({ [`/api/proxy/coach/barcode/${OFF_EAN}`]: { status: 404, body: { code: "not_found", barcode: OFF_EAN, off: null } } });
    renderApp(<AddFoodPage />);
    fireEvent.click(screen.getByTestId("scan-open"));
    expect((await screen.findByTestId("scan-not-found")).textContent).toBe(es.result.notFound.none);
    fireEvent.click(screen.getByTestId("scan-create"));
    fireEvent.change(screen.getByTestId("manual-name"), { target: { value: "Algo" } });
    fireEvent.change(screen.getByTestId("manual-kcal"), { target: { value: "950" } });
    fireEvent.click(screen.getByTestId("manual-save"));
    expect(screen.getByText(CATALOGS.es.scanner.manual.invalid)).toBeTruthy();
    expect(api.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  });
});
