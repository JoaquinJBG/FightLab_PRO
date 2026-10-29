"""Clave estable de una regla: slug de `archivo/encabezado` (spec §6.7)."""
import re
import unicodedata


def slugify(text: str) -> str:
    folded = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", folded.lower()).strip("-")


def rule_key(file: str, heading: str) -> str:
    """`nutrition.md` + `Default RMR equation: Mifflin-St Jeor` → `nutrition/default-rmr-...`."""
    stem = file[:-3] if file.endswith(".md") else file
    return f"{slugify(stem)}/{slugify(heading)}"
