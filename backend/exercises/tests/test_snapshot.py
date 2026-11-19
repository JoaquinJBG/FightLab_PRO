"""El script de la copia fijada (sin red): texto a pasos, SVG y filtro de imágenes de wger."""
import io

import pytest
from PIL import Image

from exercises.tools import snapshot
from exercises.tools.selection import SELECTION
from exercises.vocab import CATEGORIES, EQUIPMENT, MUSCLES


def test_html_to_steps():
    raw = "<p>Pasos:</p><ol><li>Túmbate en el banco.</li><li>Baja la barra.Súbela.</li></ol><p>&nbsp;</p>"
    assert snapshot.html_to_steps(raw) == ["Túmbate en el banco.", "Baja la barra. Súbela."]


def test_minify_svg_strips_metadata_and_refuses_scripts():
    svg = b'<?xml version="1.0"?><!-- c --><svg xmlns="http://www.w3.org/2000/svg"><metadata>x</metadata>  <path d="M1.23456 2"/></svg>'
    assert snapshot.minify_svg(svg) == b'<svg xmlns="http://www.w3.org/2000/svg"><path d="M1.23 2"/></svg>'
    with pytest.raises(ValueError):
        snapshot.minify_svg(b'<svg><script>alert(1)</script></svg>')
    with pytest.raises(ValueError):
        snapshot.minify_svg(b'<svg onload="x()"></svg>')


class FakeFetch:
    def get(self, url, name):
        out = io.BytesIO()
        Image.new("RGB", (800, 600), "white").save(out, "PNG")
        return out.getvalue()


def test_wger_media_skips_ai_and_anonymous_images():
    info = {"images": [
        {"id": 1, "image": "https://wger.de/a.png", "license": 2, "license_author": "", "is_ai_generated": False, "is_main": True},
        {"id": 2, "image": "https://wger.de/b.png", "license": 2, "license_author": "ana", "is_ai_generated": True},
        {"id": 3, "image": "https://wger.de/c.png", "license": 5, "license_author": "ana", "is_ai_generated": False},
        {"id": 4, "image": "https://wger.de/d.png", "license": 2, "license_author": "ana", "is_ai_generated": False},
    ]}
    skipped = []
    images, files = snapshot.wger_media(FakeFetch(), info, 9, "x", skipped)
    assert [i["author"] for i in images] == ["ana"]
    assert images[0]["license"] == "CC BY-SA 4.0"
    assert list(files) == ["x-1.webp"]
    assert Image.open(io.BytesIO(files["x-1.webp"])).size == (400, 300)
    assert len(skipped) == 3


def test_selection_is_consistent():
    keys = [s["key"] for s in SELECTION]
    assert len(keys) == len(set(keys))
    for s in SELECTION:
        assert set(s["primary"]) <= set(MUSCLES), s["key"]
        assert set(s.get("secondary", [])) <= set(MUSCLES), s["key"]
        assert set(s["equipment"]) <= set(EQUIPMENT), s["key"]
        assert s["category"] in CATEGORIES, s["key"]


def test_offline_build_matches_selection():
    entries, files, _ = snapshot.build(None, offline_only=True)
    assert [e["key"] for e in entries] == [f"cat:{s['key']}" for s in SELECTION]
    assert files == {}
