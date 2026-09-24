/**
 * Comprime una foto en el cliente antes de subirla: la redimensiona a un
 * lado largo de máximo `maxSide` px y la reexporta como JPEG (canvas), bajando
 * la calidad en escalones hasta quedar por debajo de `maxBytes`.
 *
 * Por qué en el cliente y no solo en el servidor: Vercel limita el cuerpo de
 * las peticiones del BFF a ~4.5 MB, así que hay que llegar ya ligeros. El
 * servidor (backend/profiles/image_processing.py) además reprocesa la imagen
 * a un máximo de 1600 px / ~500 KB antes de guardarla en Postgres, así que
 * esto es solo la primera pasada.
 */

export type CompressImageOptions = {
  maxSide?: number;
  maxBytes?: number;
  initialQuality?: number;
  minQuality?: number;
  qualityStep?: number;
};

const DEFAULTS: Required<CompressImageOptions> = {
  maxSide: 2048,
  maxBytes: 1.5 * 1024 * 1024,
  initialQuality: 0.9,
  minQuality: 0.4,
  qualityStep: 0.1,
};

/** Dimensiones finales sin ampliar imágenes que ya son más pequeñas que `maxSide`. */
export function targetDimensions(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxSide) return { width, height };
  const scale = maxSide / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Nombre de archivo con extensión .jpg, sea cual sea la extensión original. */
export function withJpegExtension(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "");
  return `${base || "foto"}.jpg`;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No se pudo generar la imagen comprimida."))),
      "image/jpeg",
      quality,
    );
  });
}

export async function compressImage(file: File, options: CompressImageOptions = {}): Promise<File> {
  const { maxSide, maxBytes, initialQuality, minQuality, qualityStep } = { ...DEFAULTS, ...options };

  // `imageOrientation: "from-image"` respeta la rotación EXIF antes de
  // dibujar en el canvas; como el canvas no conserva EXIF al exportar, el
  // resultado ya sale sin ese metadato (y sin GPS).
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const { width, height } = targetDimensions(bitmap.width, bitmap.height, maxSide);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    throw new Error("No se pudo preparar el lienzo para comprimir la imagen.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  let quality = initialQuality;
  let blob = await canvasToBlob(canvas, quality);
  while (blob.size > maxBytes && quality - qualityStep >= minQuality) {
    quality -= qualityStep;
    blob = await canvasToBlob(canvas, quality);
  }

  return new File([blob], withJpegExtension(file.name), { type: "image/jpeg" });
}
