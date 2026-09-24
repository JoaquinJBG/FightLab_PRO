import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { compressImage, targetDimensions, withJpegExtension } from "./compress-image";

describe("targetDimensions", () => {
  test("no amplía una imagen ya más pequeña que el máximo", () => {
    expect(targetDimensions(800, 600, 2048)).toEqual({ width: 800, height: 600 });
  });

  test("reduce el lado largo manteniendo el aspecto", () => {
    expect(targetDimensions(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
  });
});

describe("withJpegExtension", () => {
  test("cambia cualquier extensión a .jpg", () => {
    expect(withJpegExtension("foto.png")).toBe("foto.jpg");
    expect(withJpegExtension("foto.HEIC")).toBe("foto.jpg");
  });

  test("da un nombre por defecto si el original no tiene", () => {
    expect(withJpegExtension("")).toBe("foto.jpg");
  });
});

// jsdom no implementa canvas de verdad (ni createImageBitmap): se sustituyen
// por dobles mínimos que se comportan como el navegador para lo que usa
// compressImage.
describe("compressImage", () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const originalToBlob = HTMLCanvasElement.prototype.toBlob;

  beforeEach(() => {
    (globalThis as unknown as { createImageBitmap: typeof createImageBitmap }).createImageBitmap = vi.fn(
      async () => ({ width: 4000, height: 3000, close: vi.fn() }),
    ) as unknown as typeof createImageBitmap;

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    // El tamaño del blob simulado depende de la calidad pedida, para poder
    // comprobar que el bucle de compresión la va bajando.
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (
      callback: BlobCallback,
      _type?: string,
      quality?: number,
    ) {
      const size = Math.round(2_000_000 * (quality ?? 1));
      callback(new Blob([new Uint8Array(size)], { type: "image/jpeg" }));
    }) as unknown as typeof HTMLCanvasElement.prototype.toBlob;
  });

  afterEach(() => {
    (globalThis as unknown as { createImageBitmap: typeof createImageBitmap }).createImageBitmap =
      originalCreateImageBitmap;
    HTMLCanvasElement.prototype.getContext = originalGetContext;
    HTMLCanvasElement.prototype.toBlob = originalToBlob;
  });

  test("devuelve un File JPEG por debajo de maxBytes bajando la calidad", async () => {
    const file = new File([new Uint8Array(10)], "original.png", { type: "image/png" });
    const result = await compressImage(file, { maxBytes: 500_000, minQuality: 0.1 });
    expect(result.type).toBe("image/jpeg");
    expect(result.name).toBe("original.jpg");
    expect(result.size).toBeLessThanOrEqual(500_000);
  });

  test("redimensiona el canvas al lado largo máximo indicado", async () => {
    let sizeUsed: { width: number; height: number } | null = null;
    HTMLCanvasElement.prototype.getContext = vi.fn(function (this: HTMLCanvasElement) {
      sizeUsed = { width: this.width, height: this.height };
      return { drawImage: vi.fn() };
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const file = new File([new Uint8Array(10)], "original.png", { type: "image/png" });
    await compressImage(file, { maxSide: 1000, maxBytes: 5_000_000 });

    // bitmap simulado 4000x3000 → lado largo 1000 → 1000x750
    expect(sizeUsed).toEqual({ width: 1000, height: 750 });
  });
});
