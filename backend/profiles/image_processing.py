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

Antes de decodificar ningún píxel se rechazan las imágenes que superen
``MAX_INPUT_PIXELS``: ``Image.open`` es perezoso (solo lee la cabecera), así
que comprobar ``opened.size`` es barato, pero convertir a RGB y redimensionar
no lo es. Sin este tope, un PNG de color liso de pocos KB pero de miles de
píxeles de lado (p. ej. 13000x13000) decodifica una imagen RGB de cientos de
MB en memoria: en Render free (512 MB) eso tumba el worker con un solo POST.
Para JPEG además se usa ``Image.draft`` para que libjpeg decodifique ya a una
resolución reducida, y el resize (``thumbnail``) se hace ANTES de convertir a
RGB, así nunca hay en memoria una copia RGB a la resolución de entrada
completa.
"""
from __future__ import annotations

import io

from PIL import Image, ImageOps

MAX_SIDE_PX = 1600
# Tope de píxeles de ENTRADA (ancho x alto) antes de decodificar. Deliberadamente
# muy por debajo del límite propio de Pillow (que solo avisa/corta a partir de
# ~90-180 megapíxeles): con este tope el rechazo es determinista y barato.
MAX_INPUT_PIXELS = 40_000_000  # 40 MP, p. ej. ~6500x6150
TARGET_MAX_BYTES = 500 * 1024
JPEG_QUALITY_START = 82
JPEG_QUALITY_FLOOR = 40
JPEG_QUALITY_STEP = 10


class UnsupportedImageError(ValueError):
    """La imagen es válida para Pillow pero excede los límites que aceptamos."""


def process_progress_photo(file_obj) -> tuple[bytes, str, int, int]:
    """Devuelve ``(bytes_jpeg, content_type, width, height)``.

    Lanza la excepción de Pillow que corresponda si ``file_obj`` no es una
    imagen válida, o ``UnsupportedImageError`` si supera ``MAX_INPUT_PIXELS``;
    la vista traduce ambos casos a un 400.
    """
    with Image.open(file_obj) as opened:
        width, height = opened.size
        if width * height > MAX_INPUT_PIXELS:
            raise UnsupportedImageError(
                f"Imagen demasiado grande ({width}x{height} px); "
                f"el máximo son {MAX_INPUT_PIXELS} píxeles."
            )

        # Solo afecta a JPEG (decodificación DCT escalada de libjpeg); no hace
        # nada en PNG/WebP, de ahí que el tope de arriba sea imprescindible
        # también para esos formatos.
        opened.draft("RGB", (MAX_SIDE_PX, MAX_SIDE_PX))

        img = ImageOps.exif_transpose(opened)
        if img is None:  # exif_transpose puede devolver None si no hay que tocar nada
            img = opened

        # Redimensiona ANTES de convertir a RGB: así el `convert` (si hace
        # falta) opera ya sobre la imagen reducida, no sobre la de tamaño
        # completo.
        if max(img.size) > MAX_SIDE_PX:
            img.thumbnail((MAX_SIDE_PX, MAX_SIDE_PX), Image.LANCZOS)

        if img.mode != "RGB":
            img = img.convert("RGB")

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
