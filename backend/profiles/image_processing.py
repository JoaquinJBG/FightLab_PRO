"""Procesado de las fotos de progreso al subirlas.

Las fotos se guardan en la propia base de datos (Postgres), no en disco: el
hosting gratuito (Render free) tiene disco efímero, así que no hay dónde
persistir archivos entre reinicios. Antes de guardar, cada foto se:

- reorienta según su EXIF (`exif_transpose`) y se reduce a un máximo de
  ``MAX_SIDE_PX`` en el lado largo;
- reexporta como JPEG sin pasar ``exif=...`` a ``Image.save``, así el
  resultado no lleva ningún metadato EXIF ni GPS;
- comprime bajando la calidad en escalones hasta acercarse a
  ``TARGET_MAX_BYTES`` (o hasta tocar el suelo de calidad).
"""
from __future__ import annotations

import io

from PIL import Image, ImageOps

MAX_SIDE_PX = 1600
TARGET_MAX_BYTES = 500 * 1024
JPEG_QUALITY_START = 82
JPEG_QUALITY_FLOOR = 40
JPEG_QUALITY_STEP = 10


def process_progress_photo(file_obj) -> tuple[bytes, str, int, int]:
    """Devuelve ``(bytes_jpeg, content_type, width, height)``.

    Lanza la excepción de Pillow que corresponda si ``file_obj`` no es una
    imagen válida; la vista la traduce a un 400.
    """
    with Image.open(file_obj) as opened:
        img = ImageOps.exif_transpose(opened)
        if img is None:  # exif_transpose puede devolver None si no hay que tocar nada
            img = opened
        if img.mode not in ("RGB",):
            img = img.convert("RGB")

        width, height = img.size
        longest = max(width, height)
        if longest > MAX_SIDE_PX:
            scale = MAX_SIDE_PX / longest
            width = max(1, round(width * scale))
            height = max(1, round(height * scale))
            img = img.resize((width, height), Image.LANCZOS)

        quality = JPEG_QUALITY_START
        data = _encode_jpeg(img, quality)
        while len(data) > TARGET_MAX_BYTES and quality > JPEG_QUALITY_FLOOR:
            quality -= JPEG_QUALITY_STEP
            data = _encode_jpeg(img, quality)

        return data, "image/jpeg", img.width, img.height


def _encode_jpeg(img: Image.Image, quality: int) -> bytes:
    buf = io.BytesIO()
    # Sin `exif=`: Pillow no escribe ningún bloque EXIF/GPS en el JPEG de salida.
    img.save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()
