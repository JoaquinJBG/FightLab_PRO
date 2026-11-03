"""El anexo de evidencia de combate pasa las comprobaciones de formato, y las comprobaciones
detectan los fallos que tienen que detectar."""

import pytest

from scripts.check_knowledge_fightlab import KNOWLEDGE_DIR, counts, main, run

HEADER = "# Combat\n\n> Evidence checked on 2026-10-29.\n\n"
RULE = """### A rule
**Rule:** Do the thing.
**Evidence:** A study found it.
**Grade:** {grade}
**Applies to:** Adult fighters.
**Individual variation / conflicts:** None known.
**Sources:** {cite}
"""
SOURCE = """### F001
Doe J et al., 2020. A title. J Sport 1:1-2
Type: {type} · DOI: [10.1/x](https://doi.org/10.1/x) · Files: combat-sports
URL: <https://pubmed.ncbi.nlm.nih.gov/1/>
Opened: <https://eutils.ncbi.nlm.nih.gov/x>
Supports: {supports}
"""
DROPPED = "# Dropped claims\n\n> Evidence checked on 2026-10-29.\n\n## ACWR\n\n- `FD01` **X.** (research): why.\n"


def write_annex(tmp_path, *, grade="moderate", cite="[F001]", type_="Meta-analysis",
                supports="10 studies, n=500, small effect.", dropped=DROPPED, extra=""):
    (tmp_path / "combat-sports.md").write_text(
        HEADER + "## Section\n\n" + RULE.format(grade=grade, cite=cite) + extra, encoding="utf-8"
    )
    (tmp_path / "sources.md").write_text(
        "# Sources\n\n" + SOURCE.format(type=type_, supports=supports), encoding="utf-8"
    )
    (tmp_path / "dropped-claims.md").write_text(dropped, encoding="utf-8")
    return tmp_path


def test_el_anexo_real_pasa():
    assert run(KNOWLEDGE_DIR) == []
    totals = counts(KNOWLEDGE_DIR)
    assert totals["rules"] > 0
    assert totals["rules"] == totals["strong"] + totals["moderate"] + totals["emerging"]


def test_un_anexo_correcto_pasa(tmp_path):
    assert run(write_annex(tmp_path)) == []
    assert main(["--knowledge-dir", str(tmp_path)]) == 0


@pytest.mark.parametrize(
    ("kwargs", "expected"),
    [
        ({"grade": "high"}, "has grade 'high'"),
        ({"cite": "[F002]"}, "[F002] is not in sources.md"),
        ({"cite": "[F002]"}, "F001 is never cited"),
        ({"cite": "[F001], [S123]"}, "[S123] is an upstream ID"),
        ({"type_": "Blog"}, "has type 'Blog'"),
        ({"supports": "The authors wrote \"it works\"."}, "looks like a verbatim quote"),
        ({"supports": "n=10 – small"}, "U+2013 en dash"),
        ({"extra": "\n### A rule\n**Grade:** strong\n"}, "heading 'A rule' repeats"),
        ({"extra": "\n### Bare\n**Grade:** strong\n[F001]\n"}, "has 0 '**Rule:**' lines"),
        ({"dropped": "# Dropped\n\n## ACWR\n"}, "dropped-claims.md: no 'Evidence checked on"),
        ({"dropped": DROPPED + "\n### Not a rule\n"}, "the loader would read it as a rule"),
    ],
)
def test_detecta_fallos(tmp_path, kwargs, expected):
    errors = run(write_annex(tmp_path, **kwargs))
    assert any(expected in e for e in errors), errors
    assert main(["--knowledge-dir", str(tmp_path)]) == 1


def test_sin_fecha_en_la_cabecera(tmp_path):
    write_annex(tmp_path)
    path = tmp_path / "combat-sports.md"
    path.write_text(path.read_text(encoding="utf-8").replace("Evidence checked on", "Checked"), encoding="utf-8")
    assert any("no 'Evidence checked on" in e for e in run(tmp_path))
