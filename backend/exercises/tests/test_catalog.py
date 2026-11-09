"""El catálogo fijado (`data/exercise_catalog.json`) y sus medios: forma, vocabulario y créditos.

`test_every_image_has_author_and_license` es la garantía de licencias de la F17: falla si alguna
imagen del catálogo no tiene autor, licencia, enlace a la licencia y a la fuente.
"""
from pathlib import Path

import pytest

from exercises.catalog import catalog
from exercises.vocab import CATEGORIES, EQUIPMENT, MUSCLES

REPO = Path(__file__).resolve().parents[3]
MEDIA_DIR = REPO / "frontend" / "public" / "exercise-media"
MAX_MEDIA_BYTES = 5 * 1024 * 1024
OPEN_LICENSES = {"CC BY-SA 3.0", "CC BY-SA 4.0", "CC BY 4.0", "CC BY 3.0", "CC0 1.0"}

ENTRIES = list(catalog())


def test_keys_are_unique_and_prefixed():
    keys = [e["key"] for e in ENTRIES]
    assert len(keys) == len(set(keys))
    for key in keys:
        assert key.startswith("cat:")
        slug = key[4:]
        assert slug and slug == slug.lower() and " " not in slug and ":" not in slug


@pytest.mark.parametrize("entry", ENTRIES, ids=lambda e: e["key"])
def test_entry_shape(entry):
    assert entry["names"]["es"].strip() and entry["names"]["en"].strip()
    assert entry["category"] in CATEGORIES
    assert entry["primary_muscles"], "sin músculo principal"
    assert set(entry["primary_muscles"]) <= set(MUSCLES)
    assert set(entry["secondary_muscles"]) <= set(MUSCLES)
    assert not set(entry["primary_muscles"]) & set(entry["secondary_muscles"])
    assert entry["equipment"] and set(entry["equipment"]) <= set(EQUIPMENT)
    for lang in ("es", "en"):
        assert all(isinstance(s, str) and s.strip() for s in entry["instructions"][lang])
    if entry["instructions"]["es"] or entry["instructions"]["en"]:
        assert entry["text_credit"], "pasos sin crédito"


@pytest.mark.parametrize("entry", ENTRIES, ids=lambda e: e["key"])
def test_every_image_has_author_and_license(entry):
    for img in entry["images"]:
        assert img["author"].strip(), f"{img['src']} sin autor"
        assert img["license"] in OPEN_LICENSES, f"{img['src']} licencia {img['license']!r}"
        assert img["license_url"].startswith("https://creativecommons.org/"), img["src"]
        assert img["source_url"].startswith("https://"), img["src"]
        assert img["source"] in {"wger", "everkinetic"}
        assert not img.get("ai_generated", False), f"{img['src']} hecha con IA"
        assert img["src"].startswith("/exercise-media/")
        assert (MEDIA_DIR / img["src"].removeprefix("/exercise-media/")).is_file(), img["src"]


def test_text_credits_are_complete():
    for entry in ENTRIES:
        credit = entry["text_credit"]
        if credit and credit["source"] == "wger":
            assert credit["author"].strip() and credit["license"] in OPEN_LICENSES, entry["key"]
            assert credit["source_url"].startswith("https://wger.de/"), entry["key"]


def media_files() -> list[Path]:
    if not MEDIA_DIR.is_dir():
        return []
    return [p for p in MEDIA_DIR.iterdir() if p.is_file() and p.name != "ATTRIBUTION.md"]


def test_media_folder_has_only_catalog_images():
    """Ningún medio sin crédito: todo archivo de la carpeta lo usa alguna entrada del catálogo."""
    used = {img["src"].removeprefix("/exercise-media/") for e in ENTRIES for img in e["images"]}
    orphans = sorted(p.name for p in media_files() if p.name not in used)
    assert orphans == []


def test_media_formats_and_total_size():
    files = media_files()
    assert all(p.suffix in {".webp", ".svg"} for p in files)
    assert sum(p.stat().st_size for p in files) < MAX_MEDIA_BYTES


def test_attribution_file_lists_every_image():
    used = sorted({img["src"].removeprefix("/exercise-media/") for e in ENTRIES for img in e["images"]})
    if not used:
        return
    text = (MEDIA_DIR / "ATTRIBUTION.md").read_text(encoding="utf-8")
    for name in used:
        assert name in text, name
