"""Copia fijada de la biblioteca de ejercicios (F17): wger + everkinetic -> catálogo y medios.

    python -m exercises.tools.snapshot             # descarga (con caché) y genera todo
    python -m exercises.tools.snapshot --offline   # solo la selección, sin medios ni red

Lee la selección curada (`selection.py`) y, para cada entrada:

- de la API pública de wger (sin clave, solo lectura): los pasos en español e inglés con su autor y
  licencia, y las imágenes con autor (se descartan las que no lo tienen y las hechas con IA);
- de everkinetic/data (CC BY-SA 4.0): los dos fotogramas SVG y los pasos en inglés.

Escribe `exercises/data/exercise_catalog.json`, `exercises/data/ATTRIBUTION.md` y los medios
optimizados en `frontend/public/exercise-media/` (WebP de 400 px como máximo o SVG minificado, con
su `ATTRIBUTION.md`). Borra de esa carpeta lo que ya no usa el catálogo. No se ejecuta en CI: el
resultado se fija en el repo. No usa ExerciseDB, openGym, Gym visual, MuscleWiki ni free-exercise-db.
"""
from __future__ import annotations

import argparse
import html
import io
import json
import re
import tempfile
import time
import urllib.request
from pathlib import Path

from exercises.tools.selection import SELECTION

BACKEND = Path(__file__).resolve().parents[2]
REPO = BACKEND.parent
CATALOG_PATH = BACKEND / "exercises" / "data" / "exercise_catalog.json"
DATA_ATTRIBUTION = BACKEND / "exercises" / "data" / "ATTRIBUTION.md"
MEDIA_DIR = REPO / "frontend" / "public" / "exercise-media"
MEDIA_URL = "/exercise-media/"
MAX_MEDIA_BYTES = 5 * 1024 * 1024
MAX_IMAGES = 2
MAX_SIDE = 400

WGER_API = "https://wger.de/api/v2/exerciseinfo/{id}/?format=json"
WGER_PAGE = "https://wger.de/en/exercise/{id}/view/"
EK_BASE = "https://raw.githubusercontent.com/everkinetic/data/main/dist/"
EK_REPO = "https://github.com/everkinetic/data"
LANG_IDS = {"en": 2, "es": 4}
USER_AGENT = "FightLab-exercise-snapshot/1.0 (+https://github.com/JoaquinJBG/FightLab_PRO)"

# Licencias de wger (https://wger.de/api/v2/license/). La 5 (ODbL) no es para medios: no se usa.
LICENSES = {
    1: ("CC BY-SA 3.0", "https://creativecommons.org/licenses/by-sa/3.0/"),
    2: ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/"),
    3: ("CC0 1.0", "https://creativecommons.org/publicdomain/zero/1.0/"),
    4: ("CC BY 4.0", "https://creativecommons.org/licenses/by/4.0/"),
}
EK_LICENSE = ("CC BY-SA 4.0", "https://creativecommons.org/licenses/by-sa/4.0/")
EK_AUTHOR = "Everkinetic"
MIN_TEXT = 60  # menos que esto en wger suele ser un texto de relleno («…», una línea suelta)


# ------------------------------------------------------------------ descargas (con caché)

class Fetcher:
    def __init__(self, cache: Path, offline: bool = False):
        self.cache = cache
        self.offline = offline
        cache.mkdir(parents=True, exist_ok=True)

    def get(self, url: str, name: str) -> bytes:
        path = self.cache / name
        if path.exists():
            return path.read_bytes()
        if self.offline:
            raise FileNotFoundError(f"sin caché para {url}")
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=60) as resp:
                    data = resp.read()
                break
            except OSError:
                if attempt == 2:
                    raise
                time.sleep(2 * (attempt + 1))
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return data

    def json(self, url: str, name: str):
        return json.loads(self.get(url, name).decode("utf-8"))


# ------------------------------------------------------------------ textos

def html_to_steps(raw: str) -> list[str]:
    """Pasos a partir de la descripción HTML de wger: un paso por párrafo o elemento de lista; un
    párrafo largo y único se parte en frases."""
    text = re.sub(r"(?i)<\s*(br|/p|/li|/ol|/ul|li|p)[^>]*>", "\n", raw or "")
    text = html.unescape(re.sub(r"<[^>]+>", "", text))
    lines = [re.sub(r"\s+", " ", ln).strip(" -•\t") for ln in text.split("\n")]
    # «patas.Los» -> «patas. Los»; fuera los encabezados sueltos («Pasos:», «Instrucciones:»)
    lines = [re.sub(r"([.!?])(?=[A-ZÁÉÍÓÚÑ])", r"\1 ", ln) for ln in lines]
    lines = [ln for ln in lines if len(ln) > 2 and not (ln.endswith(":") and len(ln) < 40)]
    if len(lines) == 1 and len(lines[0]) > 220:
        lines = [s.strip() for s in re.split(r"(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])", lines[0]) if s.strip()]
    return lines[:12]


def wger_text(info: dict, lang: str, wger_id: int) -> tuple[list[str], dict | None]:
    tr = next((t for t in info.get("translations", []) if t["language"] == LANG_IDS[lang]), None)
    if not tr or len(re.sub(r"<[^>]+>", "", tr.get("description") or "").strip()) < MIN_TEXT:
        return [], None
    if tr.get("license") not in LICENSES:
        return [], None
    author = (tr.get("license_author") or "").strip() or ", ".join(tr.get("author_history") or [])
    if not author.strip():
        return [], None
    steps = html_to_steps(tr["description"])
    if not steps:
        return [], None
    lic, lic_url = LICENSES[tr["license"]]
    return steps, {
        "source": "wger", "author": author, "license": lic, "license_url": lic_url,
        "source_url": WGER_PAGE.format(id=wger_id),
        "modified": "HTML convertido a pasos",
    }


# ------------------------------------------------------------------ medios

def minify_svg(data: bytes) -> bytes:
    s = data.decode("utf-8")
    s = re.sub(r"<\?xml[^>]*\?>", "", s)
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<!DOCTYPE[^>]*>", "", s)
    s = re.sub(r"<metadata.*?</metadata>", "", s, flags=re.S)
    s = re.sub(r"<sodipodi:namedview.*?(/>|</sodipodi:namedview>)", "", s, flags=re.S)
    s = re.sub(r'\s(?:sodipodi|inkscape):[\w-]+="[^"]*"', "", s)
    s = re.sub(r'\sxmlns:(?:sodipodi|inkscape|dc|cc|rdf)="[^"]*"', "", s)
    s = re.sub(r"(\d+\.\d{2})\d+", r"\1", s)  # dos decimales bastan a este tamaño
    s = re.sub(r">\s+<", "><", s)
    s = re.sub(r"\s{2,}", " ", s)
    if "<script" in s.lower() or "javascript:" in s.lower() or re.search(r"\son\w+=", s):
        raise ValueError("SVG con código: no se publica")
    return s.strip().encode("utf-8")


def to_webp(data: bytes) -> bytes:
    from PIL import Image

    img = Image.open(io.BytesIO(data))
    img.load()
    if img.mode not in ("RGB", "RGBA"):
        img = img.convert("RGBA")
    img.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    img.save(out, "WEBP", quality=78, method=6)
    return out.getvalue()


def everkinetic_media(fetch: Fetcher, ek_index: dict, name: str, key: str) -> tuple[list[dict], list[str], dict]:
    ek = ek_index.get(name)
    if ek is None:
        raise KeyError(f"everkinetic: no existe {name!r} (entrada {key})")
    files = {}
    images = []
    for n, rel in enumerate(ek.get("svg", [])[:MAX_IMAGES], start=1):
        svg = minify_svg(fetch.get(EK_BASE + rel, "ek/" + rel))
        fname = f"{key}-{n}.svg"
        files[fname] = svg
        images.append({
            "src": MEDIA_URL + fname, "source": "everkinetic", "author": EK_AUTHOR,
            "license": EK_LICENSE[0], "license_url": EK_LICENSE[1], "source_url": EK_REPO,
            "modified": "SVG minificado (sin metadatos, 2 decimales)", "original": EK_BASE + rel,
        })
    steps = [s for s in ek.get("steps", []) if s.strip()]
    return images, steps, files


def wger_media(fetch: Fetcher, info: dict, wger_id: int, key: str, skipped: list[str]) -> tuple[list[dict], dict]:
    images, files = [], {}
    ordered = sorted(info.get("images", []), key=lambda i: (not i.get("is_main"), i["id"]))
    for img in ordered:
        author = (img.get("license_author") or "").strip()
        if img.get("is_ai_generated"):
            skipped.append(f"{key}: wger imagen {img['id']} hecha con IA")
            continue
        if not author:
            skipped.append(f"{key}: wger imagen {img['id']} sin autor")
            continue
        if img.get("license") not in LICENSES:
            skipped.append(f"{key}: wger imagen {img['id']} licencia {img.get('license')}")
            continue
        if len(images) >= MAX_IMAGES:
            break
        raw = fetch.get(img["image"], f"wger/img/{img['id']}{Path(img['image']).suffix}")
        fname = f"{key}-{len(images) + 1}.webp"
        files[fname] = to_webp(raw)
        lic, lic_url = LICENSES[img["license"]]
        images.append({
            "src": MEDIA_URL + fname, "source": "wger", "author": author, "license": lic,
            "license_url": lic_url, "source_url": WGER_PAGE.format(id=wger_id),
            "modified": f"redimensionada a {MAX_SIDE} px como máximo, WebP", "original": img["image"],
        })
    return images, files


# ------------------------------------------------------------------ catálogo

def base_entry(sel: dict) -> dict:
    """La entrada del catálogo con lo que sale de la selección curada (sin medios ni wger)."""
    own = {}
    instructions = {"es": [], "en": []}
    for lang in ("es", "en"):
        steps = list(sel.get(f"steps_{lang}", []))
        if steps:
            instructions[lang] = steps
            own[lang] = {"source": "fightlab", "author": "FightLab", "license": "CC BY 4.0",
                         "license_url": "https://creativecommons.org/licenses/by/4.0/",
                         "source_url": "https://github.com/JoaquinJBG/FightLab_PRO"}
    secondary = [m for m in sel.get("secondary", []) if m not in sel["primary"]]
    return {
        "key": f"cat:{sel['key']}",
        "category": sel["category"],
        "names": {"es": sel["es"], "en": sel["en"]},
        "aliases": {"es": list(sel.get("aliases_es", [])), "en": list(sel.get("aliases_en", []))},
        "legacy_names": list(sel.get("legacy", [])),
        "primary_muscles": list(sel["primary"]),
        "secondary_muscles": secondary,
        "equipment": list(sel["equipment"]),
        "instructions": instructions,
        "text_credits": own,
        "images": [],
        "wger_id": sel.get("wger"),
        "everkinetic": sel.get("everkinetic"),
    }


def build(fetch: Fetcher, *, offline_only: bool = False) -> tuple[list[dict], dict[str, bytes], list[str]]:
    entries, files, skipped = [], {}, []
    ek_index = {}
    if not offline_only:
        ek_index = {e["name"]: e for e in fetch.json(EK_BASE + "exercises.json", "ek/exercises.json")}
    for sel in SELECTION:
        entry = base_entry(sel)
        if offline_only:
            entries.append(entry)
            continue
        key = sel["key"]
        ek_steps: list[str] = []
        if sel.get("everkinetic"):
            imgs, ek_steps, f = everkinetic_media(fetch, ek_index, sel["everkinetic"], key)
            entry["images"] = imgs
            files.update(f)
        if sel.get("wger"):
            info = fetch.json(WGER_API.format(id=sel["wger"]), f"wger/{sel['wger']}.json")
            for lang in ("es", "en"):
                if entry["instructions"][lang]:
                    continue  # el texto propio manda
                steps, credit = wger_text(info, lang, sel["wger"])
                if steps:
                    entry["instructions"][lang] = steps
                    entry["text_credits"][lang] = credit
            if not entry["images"]:
                img_id = sel.get("wger_images", sel["wger"])
                img_info = info if img_id == sel["wger"] else fetch.json(
                    WGER_API.format(id=img_id), f"wger/{img_id}.json")
                imgs, f = wger_media(fetch, img_info, img_id, key, skipped)
                entry["images"] = imgs
                files.update(f)
        if not entry["instructions"]["en"] and ek_steps:
            entry["instructions"]["en"] = ek_steps
            entry["text_credits"]["en"] = {
                "source": "everkinetic", "author": EK_AUTHOR, "license": EK_LICENSE[0],
                "license_url": EK_LICENSE[1], "source_url": EK_REPO, "modified": "",
            }
        entries.append(entry)
    return entries, files, skipped


def attribution_md(entries: list[dict]) -> str:
    lines = [
        "# Créditos de la biblioteca de ejercicios",
        "",
        "Generado por `backend/exercises/tools/snapshot.py`: no lo edites a mano.",
        "",
        "Las imágenes y los textos de terceros de esta carpeta y de `backend/exercises/data/` **no** están",
        "bajo la licencia MIT del código ni bajo la CC BY 4.0 del contenido de FightLab: cada uno conserva",
        "su licencia (CC BY-SA 3.0 o 4.0) y su autor, que se listan abajo. Los cambios hechos son técnicos",
        "(redimensionar, pasar a WebP, minificar el SVG o convertir el HTML en pasos).",
        "",
        "- wger (https://wger.de): imágenes y textos con autor por entrada.",
        "- Everkinetic (https://github.com/everkinetic/data): dibujos de línea y pasos, CC BY-SA 4.0.",
        "",
        "## Imágenes",
        "",
        "| Archivo | Ejercicio | Autor | Fuente | Licencia | Cambios |",
        "|---|---|---|---|---|---|",
    ]
    for e in entries:
        for img in e["images"]:
            fname = img["src"].removeprefix(MEDIA_URL)
            lines.append(
                f"| {fname} | {e['names']['es']} | {img['author']} | [{img['source']}]({img['source_url']}) "
                f"| [{img['license']}]({img['license_url']}) | {img['modified']} |"
            )
    lines += ["", "## Textos (pasos)", "", "| Ejercicio | Idioma | Autor | Fuente | Licencia |", "|---|---|---|---|---|"]
    for e in entries:
        for lang, c in sorted(e["text_credits"].items()):
            if c["source"] == "fightlab":
                continue
            lines.append(
                f"| {e['names']['es']} | {lang} | {c['author']} | [{c['source']}]({c['source_url']}) "
                f"| [{c['license']}]({c['license_url']}) |"
            )
    return "\n".join(lines) + "\n"


def write_catalog(entries: list[dict], path: Path = CATALOG_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"version": 2, "exercises": entries}
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def write_media(files: dict[str, bytes], entries: list[dict]) -> int:
    MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    for old in MEDIA_DIR.iterdir():
        if old.is_file() and old.name not in files:
            old.unlink()
    for name, data in files.items():
        (MEDIA_DIR / name).write_bytes(data)
    md = attribution_md(entries)
    (MEDIA_DIR / "ATTRIBUTION.md").write_text(md, encoding="utf-8")
    DATA_ATTRIBUTION.write_text(md, encoding="utf-8")
    return sum(len(d) for d in files.values())


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--offline", action="store_true", help="sin red: solo la selección, sin medios")
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "fightlab-exercise-snapshot",
                        help="carpeta de caché de las descargas (fuera del repo)")
    args = parser.parse_args(argv)
    fetch = Fetcher(args.cache)
    entries, files, skipped = build(fetch, offline_only=args.offline)
    if args.offline:
        write_catalog(entries)
        return
    total = sum(len(d) for d in files.values())
    if total >= MAX_MEDIA_BYTES:
        raise SystemExit(f"Los medios ocupan {total} bytes: más de {MAX_MEDIA_BYTES}")
    write_catalog(entries)
    write_media(files, entries)
    with_img = sum(1 for e in entries if e["images"])
    print(f"{len(entries)} ejercicios, {with_img} con imagen, {len(files)} archivos, {total / 1024:.0f} KB")
    for line in skipped:
        print("descartada:", line)
    for e in entries:
        if not e["images"]:
            print("sin imagen:", e["key"], f"({e['category']})")
        if not e["instructions"]["es"] and not e["instructions"]["en"]:
            print("sin pasos:", e["key"])


if __name__ == "__main__":
    main()
