"""Genera `exercises/data/exercise_catalog.json` a partir de `selection.py` (F17).

    python -m exercises.tools.snapshot --offline   # solo la selección, sin medios ni red

No se ejecuta en CI: el resultado se fija en el repo.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from exercises.tools.selection import SELECTION

BACKEND = Path(__file__).resolve().parents[2]
CATALOG_PATH = BACKEND / "exercises" / "data" / "exercise_catalog.json"


def base_entry(sel: dict) -> dict:
    """La entrada del catálogo con lo que sale de la selección curada (sin medios)."""
    steps_es = list(sel.get("steps_es", []))
    steps_en = list(sel.get("steps_en", []))
    own_text = bool(steps_es or steps_en)
    return {
        "key": f"cat:{sel['key']}",
        "category": sel["category"],
        "names": {"es": sel["es"], "en": sel["en"]},
        "aliases": {"es": list(sel.get("aliases_es", [])), "en": list(sel.get("aliases_en", []))},
        "legacy_names": list(sel.get("legacy", [])),
        "primary_muscles": list(sel["primary"]),
        "secondary_muscles": list(sel.get("secondary", [])),
        "equipment": list(sel["equipment"]),
        "instructions": {"es": steps_es, "en": steps_en},
        "text_credit": {"source": "fightlab"} if own_text else None,
        "images": [],
        "wger_id": sel.get("wger"),
        "everkinetic": sel.get("everkinetic"),
    }


def write_catalog(entries: list[dict], path: Path = CATALOG_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": 1, "exercises": entries}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="sin red: solo la selección")
    args = parser.parse_args(argv)
    if not args.offline:
        raise SystemExit("La copia de wger y everkinetic llega en el bloque 2; usa --offline.")
    write_catalog([base_entry(s) for s in SELECTION])


if __name__ == "__main__":
    main()
