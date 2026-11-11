"use client";

// Escáner de código de barras. La cámara trasera lee EAN-13, EAN-8, UPC-A y UPC-E con
// `BarcodeDetector` si el navegador lo tiene; si no, con ZXing (`@zxing/browser`, MIT, y
// `@zxing/library`, Apache-2.0), que se descarga solo al abrir el escáner (import dinámico).
// El servidor busca el código primero en lo del usuario (catálogo de la cadena y productos
// guardados) y después en Open Food Facts por su proxy, que guarda cada respuesta: aquí además se
// guarda en la caché de React Query, así que el mismo código no se pregunta dos veces.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { productRating } from "./menu";

export const SCAN_FORMATS = ["ean_13", "ean_8", "upc_a", "upc_e"] as const;
export type ScanFormat = (typeof SCAN_FORMATS)[number];

// ---------------------------------------------------------------- el código

/** El dígito de control GS1 (módulo 10) de un GTIN-8/12/13/14 cuadra. */
export function checkDigitOk(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop() as number;
  // De derecha a izquierda (sin el de control): peso 3, 1, 3, 1…
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** UPC-E (8 cifras: sistema, 6 de datos y control) → UPC-A (12 cifras). `null` si no es UPC-E. */
export function expandUpcE(code: string): string | null {
  if (!/^[01]\d{7}$/.test(code)) return null;
  const [sys, d1, d2, d3, d4, d5, d6, check] = [...code];
  let body: string;
  if (d6 === "0" || d6 === "1" || d6 === "2") body = `${d1}${d2}${d6}0000${d3}${d4}${d5}`;
  else if (d6 === "3") body = `${d1}${d2}${d3}00000${d4}${d5}`;
  else if (d6 === "4") body = `${d1}${d2}${d3}${d4}00000${d5}`;
  else body = `${d1}${d2}${d3}${d4}${d5}0000${d6}`;
  return `${sys}${body}${check}`;
}

/** Lo que leyó la cámara (o escribió el usuario) como el código que se busca: solo cifras, el
 * UPC-E expandido a UPC-A y con el dígito de control bien. `null` si no vale. */
export function normalizeBarcode(raw: string, format?: string | null): string | null {
  const digits = raw.replace(/\D/g, "");
  const code = format === "upc_e" ? expandUpcE(digits.length === 6 ? `0${digits}` : digits) : digits;
  if (!code || !checkDigitOk(code)) return null;
  return code;
}

// ---------------------------------------------------------------- la cámara

export type CameraError = "denied" | "noCamera" | "unsupported" | "failed";

/** Por qué no arranca la cámara, para decirlo claro. */
export function cameraErrorKind(err: unknown): CameraError {
  const name = (err as { name?: string } | null)?.name ?? "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "noCamera";
  if (name === "NotSupportedError" || name === "TypeError") return "unsupported";
  return "failed";
}

type DetectedBarcode = { rawValue: string; format: string };
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<DetectedBarcode[]> };
type BarcodeDetectorClass = {
  new (options?: { formats: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
};

/** El `BarcodeDetector` nativo con los formatos que nos valen, o `null` si no hay. */
export async function nativeDetector(): Promise<BarcodeDetectorLike | null> {
  const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  if (!Detector) return null;
  try {
    const supported = Detector.getSupportedFormats ? await Detector.getSupportedFormats() : [...SCAN_FORMATS];
    const formats = SCAN_FORMATS.filter((f) => supported.includes(f));
    return formats.length ? new Detector({ formats }) : null;
  } catch {
    return null;
  }
}

export type Scanner = {
  /** `native` (BarcodeDetector) o `zxing`. */
  engine: "native" | "zxing";
  torch: boolean;
  setTorch(on: boolean): Promise<boolean>;
  stop(): void;
};

// convention (FightLab): cada cuánto se mira un fotograma con BarcodeDetector.
const NATIVE_EVERY_MS = 150;

/** Abre la cámara trasera en `video` y llama a `onCode` con cada código válido que lea. */
export async function startScanner(video: HTMLVideoElement, onCode: (code: string) => void): Promise<Scanner> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("no camera API"), { name: "NotSupportedError" });
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false,
  });
  const track = stream.getVideoTracks()[0];
  const caps = (track?.getCapabilities?.() ?? {}) as { torch?: boolean };
  let stopped = false;
  let stopEngine = () => {};

  const stop = () => {
    stopped = true;
    stopEngine();
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const found = (raw: string, format?: string | null) => {
    if (stopped) return;
    const code = normalizeBarcode(raw, format);
    if (code) onCode(code);
  };

  let engine: Scanner["engine"] = "native";
  try {
    const detector = await nativeDetector();
    if (detector) {
      video.srcObject = stream;
      video.muted = true;
      video.setAttribute("playsinline", "true");
      await video.play().catch(() => {});
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = async () => {
        if (stopped) return;
        try {
          if (video.readyState >= 2) {
            const hits = await detector.detect(video);
            for (const hit of hits) found(hit.rawValue, hit.format);
          }
        } catch { /* un fotograma que no se puede leer: el siguiente */ }
        if (!stopped) timer = setTimeout(tick, NATIVE_EVERY_MS);
      };
      timer = setTimeout(tick, 0);
      stopEngine = () => clearTimeout(timer);
    } else {
      engine = "zxing";
      const [{ BrowserMultiFormatOneDReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      const FORMAT_NAMES: Partial<Record<number, ScanFormat>> = {
        [BarcodeFormat.EAN_13]: "ean_13", [BarcodeFormat.EAN_8]: "ean_8",
        [BarcodeFormat.UPC_A]: "upc_a", [BarcodeFormat.UPC_E]: "upc_e",
      };
      const hints = new Map<number, unknown>([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E]],
      ]);
      const reader = new BrowserMultiFormatOneDReader(hints);
      const controls = await reader.decodeFromStream(stream, video, (result) => {
        if (result) found(result.getText(), FORMAT_NAMES[result.getBarcodeFormat()] ?? null);
      });
      stopEngine = () => controls.stop();
    }
  } catch (err) {
    stop();
    throw err;
  }
  if (stopped) stop();

  return {
    engine,
    torch: !!caps.torch,
    async setTorch(on: boolean) {
      if (!caps.torch || !track) return false;
      try {
        await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
        return on;
      } catch {
        return false;
      }
    },
    stop,
  };
}

// ---------------------------------------------------------------- la búsqueda

export const SOURCES = ["chain", "catalogue", "manual", "off"] as const;
export type ScanSource = (typeof SOURCES)[number];

export const scannedProduct = z.object({
  barcode: z.string(),
  name: z.string().nullable(),
  brand: z.string().nullable(),
  chain: z.string().nullable(),
  pack: z.string().nullable(),
  pack_g: z.number().nullable(),
  serving_g: z.number().nullable(),
  per: z.string(),
  kcal: z.number().nullable(),
  protein_g: z.number().nullable(),
  carbs_g: z.number().nullable(),
  fat_g: z.number().nullable(),
  fibre_g: z.number().nullable(),
  missing: z.array(z.string()),
  url: z.string().nullable(),
  unverified: z.boolean(),
  rating: productRating,
});
export type ScannedProduct = z.infer<typeof scannedProduct>;

export const scanFound = z.object({
  source: z.enum(SOURCES),
  product: scannedProduct,
  attribution: z.object({ source: z.string(), licence: z.string(), url: z.string() }).optional(),
});

export type ScanResult =
  | ({ status: "found" } & z.infer<typeof scanFound>)
  | { status: "notFound"; barcode: string; off: string | null };

/** Error de la API con su código (`barcode_invalid`, `name_taken`, `barcode_taken`…). */
export class ScanError extends Error {
  constructor(public code: string, public data: unknown = null) {
    super(code);
  }
}

const BASE = "/api/proxy/coach/barcode";

export async function lookupBarcode(code: string): Promise<ScanResult> {
  const res = await fetch(`${BASE}/${encodeURIComponent(code)}`, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (res.ok) return { status: "found", ...scanFound.parse(data) };
  if (res.status === 404 && data?.code === "not_found") {
    return { status: "notFound", barcode: code, off: typeof data.off === "string" ? data.off : null };
  }
  throw new ScanError(typeof data?.code === "string" ? data.code : String(res.status), data);
}

export const scanKey = (code: string) => ["barcode", code] as const;

/** El producto de un código. Se guarda sin caducar en la sesión: escanear el mismo código otra vez
 * no vuelve a llamar al servidor (ni, por tanto, a Open Food Facts). */
export function useBarcodeLookup(code: string | null) {
  return useQuery<ScanResult, ScanError>({
    queryKey: scanKey(code ?? ""),
    queryFn: () => lookupBarcode(code as string),
    enabled: !!code,
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
  });
}

export type ManualProduct = {
  name: string;
  brand?: string;
  per: "100 g" | "100 ml";
  kcal: number;
  protein_g: number | null;
  carbs_g: number | null;
  fat_g: number | null;
  fibre_g?: number | null;
  sugars_g?: number | null;
  saturates_g?: number | null;
  salt_g?: number | null;
};

/** Crea a mano el alimento de un código que nadie tiene; queda como encontrado en la caché. */
export function useCreateManualProduct(code: string) {
  const qc = useQueryClient();
  return useMutation<{ warnings: string[] } & z.infer<typeof scanFound>, ScanError, ManualProduct>({
    mutationFn: async (body) => {
      const res = await fetch(`${BASE}/${encodeURIComponent(code)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ScanError(typeof data?.code === "string" ? data.code : "invalid", data);
      return { ...scanFound.parse(data), warnings: Array.isArray(data.warnings) ? data.warnings : [] };
    },
    onSuccess: (r) => {
      const found: ScanResult = { status: "found", source: r.source, product: r.product };
      qc.setQueryData(scanKey(code), found);
      qc.invalidateQueries({ queryKey: ["catalogue"] });
      qc.invalidateQueries({ queryKey: ["foods"] });
    },
  });
}

// ---------------------------------------------------------------- la cantidad

export type PortionUnit = "g" | "serving" | "pack";

/** Gramos (o ml) de `amount` unidades de `unit`; `null` si esa unidad no existe en el producto. */
export function portionGrams(product: Pick<ScannedProduct, "serving_g" | "pack_g">, unit: PortionUnit, amount: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (unit === "g") return Math.round(amount);
  const size = unit === "serving" ? product.serving_g : product.pack_g;
  return size ? Math.round(size * amount) : null;
}

/** "1,5" o "1.5" → 1.5. Un solo separador decimal; `null` si no es un número. */
export function parseDecimal(text: string): number | null {
  const clean = text.trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  return Number(clean);
}
