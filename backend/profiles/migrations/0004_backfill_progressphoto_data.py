# Migración de datos (paso 2/3, ver 0003 y 0005): lee el ImageField antiguo,
# si el archivo sigue existiendo en disco, y copia sus bytes a `data`. Es
# best-effort: si el archivo no está (disco efímero, entorno recién creado,
# nunca hubo fotos…) no revienta, solo deja esa foto sin datos y se registra
# en el log; 0005 la trata como "sin imagen" (404 al pedir el archivo).
import logging

from django.db import migrations

logger = logging.getLogger(__name__)


def backfill_photo_data(apps, schema_editor):
    ProgressPhoto = apps.get_model("profiles", "ProgressPhoto")
    qs = ProgressPhoto.objects.exclude(image="").exclude(image__isnull=True)
    for photo in qs.iterator():
        raw = b""
        try:
            with photo.image.open("rb") as fh:
                raw = fh.read()
        except Exception:
            logger.warning(
                "No se pudo leer el archivo de ProgressPhoto id=%s (%s); se deja sin datos.",
                photo.pk, photo.image.name,
            )

        width = height = None
        content_type = "application/octet-stream"
        if raw:
            content_type = _guess_content_type(photo.image.name)
            width, height = _try_dimensions(raw)

        photo.data = raw
        photo.content_type = content_type
        photo.width = width
        photo.height = height
        photo.save(update_fields=["data", "content_type", "width", "height"])


def _guess_content_type(name: str) -> str:
    name = (name or "").lower()
    if name.endswith(".png"):
        return "image/png"
    if name.endswith(".webp"):
        return "image/webp"
    if name.endswith(".gif"):
        return "image/gif"
    return "image/jpeg"


def _try_dimensions(raw: bytes):
    try:
        import io

        from PIL import Image

        with Image.open(io.BytesIO(raw)) as img:
            return img.size
    except Exception:
        return None, None


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("profiles", "0003_progressphoto_add_data_fields"),
    ]

    operations = [
        migrations.RunPython(backfill_photo_data, noop_reverse),
    ]
