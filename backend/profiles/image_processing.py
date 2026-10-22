"""Procesado de imágenes subidas: fotos de progreso y fotos de comida para la IA.

Las fotos de progreso se guardan en la propia base de datos (Postgres), no en
disco: el hosting gratuito (Render free) tiene disco efímero, así que no hay
dónde persistir archivos entre reinicios. Antes de guardar, cada foto se:

- reduce a un máximo de ``MAX_SIDE_PX`` en el lado largo y se reorienta según
  su EXIF;
- reexporta como JPEG sin pasar ``exif=...`` a ``Image.save``, así el
  resultado no lleva ningún metadato EXIF ni GPS;
- comprime bajando la calidad en escalones hasta acercarse a
  ``TARGET_MAX_BYTES`` (o hasta tocar el suelo de calidad).

``load_bounded`` rechaza las imágenes que superen el tope de píxeles antes de
decodificar: ``Image.open`` solo lee la cabecera, así que comprobar
``opened.size`` es barato, pero decodificar no lo es. Sin este tope, un PNG de
color liso de pocos KB pero de 13000x13000 píxeles decodifica cientos de MB:
en Render free (512 MB) eso tumba el worker con un solo POST. Pillow solo corta
a partir de ~180 MP, demasiado tarde.

Para JPEG, ``Image.draft`` hace que libjpeg decodifique ya reducida;
PNG/WebP/GIF no tienen decodificación escalada, así que su tope es menor. El
giro EXIF va DESPUÉS de reducir: ``exif_transpose`` sobre la entrada copiaría
la imagen entera a resolución completa.
"""
from __future__ import annotations

import io

from PIL import Image

MAX_SIDE_PX = 1600
# Tope de píxeles de ENTRADA (ancho x alto) antes de decodificar.
MAX_INPUT_PIXELS = 40_000_000  # 40 MP, p. ej. ~6500x6150 (JPEG, decodifica escalado)
# Sin decodificación escalada el pico medido es ~10 B/px (24 MP -> 246 MB): 12 MP ≈ 120 MB.
MAX_INPUT_PIXELS_NON_JPEG = 12_000_000
TARGET_MAX_BYTES = 500 * 1024
JPEG_QUALITY_START = 82
JPEG_QUALITY_FLOOR = 40
JPEG_QUALITY_STEP = 10

_EXIF_ORIENTATION = 0x0112
_ORIENTATION_TRANSPOSE = {
    2: Image.Transpose.FLIP_LEFT_RIGHT,
    3: Image.Transpose.ROTATE_180,
    4: Image.Transpose.FLIP_TOP_BOTTOM,
    5: Image.Transpose.TRANSPOSE,
    6: Image.Transpose.ROTATE_270,
    7: Image.Transpose.TRANSVERSE,
    8: Image.Transpose.ROTATE_90,
}


class UnsupportedImageError(ValueError):
    """La imagen es válida para Pillow pero excede los límites que aceptamos."""


class UnsupportedImageFormatError(UnsupportedImageError):
    """La imagen está en un formato que no aceptamos."""


def max_input_pixels(fmt: str | None) -> int:
    return MAX_INPUT_PIXELS if fmt == "JPEG" else MAX_INPUT_PIXELS_NON_JPEG


def webp_size(header: bytes) -> tuple[int, int] | None:
    """Tamaño ``(ancho, alto)`` leído de la cabecera RIFF de un WebP, o ``None`` si no lo es.

    Lanza ``UnsupportedImageError`` si es un WebP cuya cabecera no se entiende.
    """
    if len(header) < 12 or header[:4] != b"RIFF" or header[8:12] != b"WEBP":
        return None
    chunk = header[12:16]
    if len(header) >= 30 and chunk == b"VP8X":
        return 1 + int.from_bytes(header[24:27], "little"), 1 + int.from_bytes(header[27:30], "little")
    if len(header) >= 30 and chunk == b"VP8 " and header[23:26] == b"\x9d\x01\x2a":
        return (
            int.from_bytes(header[26:28], "little") & 0x3FFF,
            int.from_bytes(header[28:30], "little") & 0x3FFF,
        )
    if len(header) >= 25 and chunk == b"VP8L" and header[20] == 0x2F:
        bits = int.from_bytes(header[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    raise UnsupportedImageError("Cabecera WebP no reconocida.")


def _check_webp_header(file_obj) -> None:
    # Pillow decodifica el primer fotograma WebP dentro de Image.open: el tope
    # hay que aplicarlo antes, leyendo la cabecera a mano.
    start = file_obj.tell()
    header = file_obj.read(30)
    file_obj.seek(start)
    size = webp_size(header)
    if size is not None and size[0] * size[1] > MAX_INPUT_PIXELS_NON_JPEG:
        raise UnsupportedImageError(
            f"Imagen demasiado grande ({size[0]}x{size[1]} px); "
            f"el máximo son {MAX_INPUT_PIXELS_NON_JPEG} píxeles."
        )


def load_bounded(file_obj, *, max_side: int, formats: frozenset[str] | None = None) -> tuple[Image.Image, str]:
    """Devuelve ``(imagen_rgb_reducida_y_orientada, formato_original)``.

    Lanza ``UnsupportedImageFormatError`` si ``formats`` no incluye el formato
    real, ``UnsupportedImageError`` si supera el tope de píxeles (ambas antes
    de decodificar), o la excepción de Pillow si el archivo no es una imagen.
    """
    _check_webp_header(file_obj)
    with Image.open(file_obj) as opened:
        fmt = opened.format or ""
        if formats is not None and fmt not in formats:
            raise UnsupportedImageFormatError(f"Formato no soportado: {fmt or 'desconocido'}")
        width, height = opened.size
        limit = max_input_pixels(fmt)
        if width * height > limit:
            raise UnsupportedImageError(
                f"Imagen demasiado grande ({width}x{height} px); el máximo son {limit} píxeles."
            )
        orientation = opened.getexif().get(_EXIF_ORIENTATION)

        opened.draft("RGB", (max_side, max_side))
        opened.thumbnail((max_side, max_side), Image.LANCZOS)

        img = opened
        method = _ORIENTATION_TRANSPOSE.get(orientation)
        if method is not None:
            img = img.transpose(method)
        # convert() siempre devuelve una copia: la imagen sobrevive al cierre de `opened`.
        return img.convert("RGB"), fmt


def process_progress_photo(file_obj) -> tuple[bytes, str, int, int]:
    """Devuelve ``(bytes_jpeg, content_type, width, height)``.

    Lanza la excepción de Pillow que corresponda si ``file_obj`` no es una
    imagen válida, o ``UnsupportedImageError`` si supera el tope de píxeles;
    la vista traduce ambos casos a un 400.
    """
    img, _ = load_bounded(file_obj, max_side=MAX_SIDE_PX)
    width, height = img.size

    quality = JPEG_QUALITY_START
    data = _encode_jpeg(img, quality)
    while len(data) > TARGET_MAX_BYTES and quality > JPEG_QUALITY_FLOOR:
        quality -= JPEG_QUALITY_STEP
        data = _encode_jpeg(img, quality)

    return data, "image/jpeg", width, height


def _encode_jpeg(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    # Sin `exif=`: Pillow no escribe ningún bloque EXIF/GPS en el JPEG de salida.
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()
