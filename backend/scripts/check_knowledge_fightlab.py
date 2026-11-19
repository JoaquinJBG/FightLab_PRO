"""Comprobaciones de formato del anexo de evidencia de combate (backend/knowledge_fightlab/).

Aplica las mismas reglas que `scripts/check_knowledge.py` del coach (spec §9), adaptadas a los
IDs `[Fxxx]` del anexo. El script del coach no sirve tal cual: sus expresiones solo reconocen
`[Sxxx]`, así que con `[Fxxx]` las comprobaciones de IDs pasarían sin comprobar nada, y además
exige un `index.md` que el anexo no necesita (se carga en la base de datos, no lo lee una skill).

Reglas:
- Cada `[Fxxx]` citado existe en `sources.md` y cada fuente se cita al menos una vez.
- Ninguna cita `[Sxxx]` en el anexo (esos IDs son del coach y aquí no resuelven).
- Cada regla (`### `) tiene una sola línea `**Grade:**` con strong, moderate o emerging, y los
  campos de la plantilla del coach (Rule, Evidence, Grade, Applies to, conflicts, Sources).
- "Evidence checked on AAAA-MM-DD" en la cabecera (5 primeras líneas) de cada archivo de reglas
  y de `dropped-claims.md`.
- Encabezados `##`/`###` únicos por archivo (el cargador busca por encabezado).
- Sin rayas (U+2013, U+2014) en ningún `.md`.
- Cada fuente tiene `Type:` de la lista y `URL:`; la nota `Supports:` va con palabras propias,
  sin comillas (las citas literales son de las editoriales, no CC BY).
- `dropped-claims.md` no tiene encabezados `### `, para que el cargador no lo lea como reglas.

Uso: python scripts/check_knowledge_fightlab.py [--knowledge-dir DIR]
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

KNOWLEDGE_DIR = Path(__file__).resolve().parent.parent / "knowledge_fightlab"
NOT_RULE_FILES = {"sources.md", "index.md", "dropped-claims.md", "README.md"}
GRADES = ("strong", "moderate", "emerging")
FIELDS = (
    "**Rule:**",
    "**Evidence:**",
    "**Grade:**",
    "**Applies to:**",
    "**Individual variation / conflicts:**",
    "**Sources:**",
)
SOURCE_TYPES = {
    "Meta-analysis",
    "Systematic review",
    "Umbrella review",
    "Position stand",
    "Consensus statement",
    "Guideline",
    "RCT",
    "Cohort",
    "Cross-sectional",
    "Narrative review",
    "Other",
}

HEADER_LINES = 5
CHECKED_RE = re.compile(r"Evidence checked on (\d{4}-\d{2}-\d{2})")
CITE_RE = re.compile(r"\[(F\d{3,})\]")
UPSTREAM_CITE_RE = re.compile(r"\[(S\d+)\]")
SOURCE_HEADING_RE = re.compile(r"^### (F\d{3,})\s*$", re.MULTILINE)
GRADE_RE = re.compile(r"^\*\*Grade:\*\*\s*(.*?)\s*$")
TYPE_RE = re.compile(r"^Type: ([^·]+?)\s*(?:·|$)")
QUOTE_RE = re.compile(r"[\"“”‘’]|(?:^|\s)'[^']{8,}'")
DASHES = {"–": "U+2013 en dash", "—": "U+2014 em dash"}


@dataclass
class Rule:
    heading: str
    line: int
    body: list[str] = field(default_factory=list)


def read(path: Path) -> str:
    return Path(path).read_text(encoding="utf-8")


def rule_files(kdir: Path) -> list[Path]:
    return sorted(p for p in Path(kdir).glob("*.md") if p.name not in NOT_RULE_FILES)


def headings(text: str) -> list[tuple[int, int, str]]:
    """(línea, nivel, texto) de cada `## ` o `### ` fuera de bloques de código."""
    found, in_fence = [], False
    for lineno, line in enumerate(text.splitlines(), start=1):
        if line.lstrip().startswith("```"):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for level, prefix in ((2, "## "), (3, "### ")):
            if line.startswith(prefix):
                found.append((lineno, level, line[len(prefix) :].strip()))
    return found


def iter_rules(text: str) -> list[Rule]:
    lines = text.splitlines()
    marks = {lineno: level for lineno, level, _ in headings(text)}
    rules: list[Rule] = []
    current = None
    for lineno, line in enumerate(lines, start=1):
        level = marks.get(lineno)
        if level == 3:
            current = Rule(heading=line[4:].strip(), line=lineno)
            rules.append(current)
        elif level == 2:
            current = None
        elif current is not None:
            current.body.append(line)
    return rules


def check_ids(kdir: Path) -> list[str]:
    defined = SOURCE_HEADING_RE.findall(read(kdir / "sources.md"))
    errors = [f"sources.md: {s} is defined twice" for s in sorted({s for s in defined if defined.count(s) > 1})]
    cited: dict[str, str] = {}
    for path in rule_files(kdir):
        text = read(path)
        for sid in CITE_RE.findall(text):
            cited.setdefault(sid, path.name)
        errors += [f"{path.name}: [{s}] is an upstream ID, cite [Fxxx] only" for s in UPSTREAM_CITE_RE.findall(text)]
    errors += [f"{cited[s]}: [{s}] is not in sources.md" for s in sorted(set(cited) - set(defined))]
    errors += [f"sources.md: {s} is never cited" for s in sorted(set(defined) - set(cited))]
    return errors


def check_rules(path: Path) -> list[str]:
    errors = []
    rules = iter_rules(read(path))
    if not rules:
        errors.append(f"{path.name}: no '### ' rules")
    for rule in rules:
        where = f"{path.name}:{rule.line}: rule '{rule.heading}'"
        grades = [m.group(1) for line in rule.body if (m := GRADE_RE.match(line))]
        if len(grades) != 1:
            errors.append(f"{where} has {len(grades)} Grade lines (expected 1)")
        elif grades[0] not in GRADES:
            errors.append(f"{where} has grade '{grades[0]}' (expected one of {', '.join(GRADES)})")
        for name in FIELDS:
            count = sum(line.startswith(name) for line in rule.body)
            if count != 1:
                errors.append(f"{where} has {count} '{name}' lines (expected 1)")
        if not CITE_RE.search("\n".join(rule.body)):
            errors.append(f"{where} cites no [Fxxx] source")
    return errors


def check_checked_date(path: Path) -> list[str]:
    head = "\n".join(read(path).splitlines()[:HEADER_LINES])
    match = CHECKED_RE.search(head)
    if not match:
        return [f"{path.name}: no 'Evidence checked on YYYY-MM-DD' in the header"]
    try:
        date.fromisoformat(match.group(1))
    except ValueError:
        return [f"{path.name}: invalid date in 'Evidence checked on {match.group(1)}'"]
    return []


def check_duplicate_headings(path: Path) -> list[str]:
    seen: dict[str, int] = {}
    errors = []
    for lineno, _, heading in headings(read(path)):
        if heading in seen:
            errors.append(f"{path.name}:{lineno}: heading '{heading}' repeats line {seen[heading]}")
        else:
            seen.setdefault(heading, lineno)
    return errors


def check_dashes(path: Path) -> list[str]:
    errors = []
    for lineno, line in enumerate(read(path).splitlines(), start=1):
        for char, name in DASHES.items():
            if char in line:
                errors.append(f"{path.name}:{lineno}: {name}")
    return errors


def check_sources(kdir: Path) -> list[str]:
    text = read(kdir / "sources.md")
    matches = list(SOURCE_HEADING_RE.finditer(text))
    errors = []
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        lines = [line.strip() for line in text[match.end() : end].strip().splitlines()]
        sid = match.group(1)
        types = [m.group(1) for line in lines if (m := TYPE_RE.match(line))]
        if len(types) != 1:
            errors.append(f"sources.md: {sid} has {len(types)} 'Type:' lines (expected 1)")
        elif types[0] not in SOURCE_TYPES:
            errors.append(f"sources.md: {sid} has type '{types[0]}'")
        if not any(line.startswith("URL:") for line in lines):
            errors.append(f"sources.md: {sid} has no 'URL:' line")
        for line in lines:
            if line.startswith("Supports:") and QUOTE_RE.search(line):
                errors.append(f"sources.md: {sid} 'Supports:' looks like a verbatim quote")
    return errors


def check_dropped(kdir: Path) -> list[str]:
    path = kdir / "dropped-claims.md"
    if not path.exists():
        return [f"{path.name} is missing"]
    errors = check_checked_date(path) + check_duplicate_headings(path)
    errors += [
        f"{path.name}:{lineno}: '### ' heading; the loader would read it as a rule"
        for lineno, level, _ in headings(read(path))
        if level == 3
    ]
    return errors


def counts(kdir: Path) -> dict[str, int]:
    result = {"sources": len(SOURCE_HEADING_RE.findall(read(kdir / "sources.md"))), "rules": 0}
    result |= dict.fromkeys(GRADES, 0)
    for path in rule_files(kdir):
        for rule in iter_rules(read(path)):
            result["rules"] += 1
            grade = next((m.group(1) for line in rule.body if (m := GRADE_RE.match(line))), None)
            if grade in GRADES:
                result[grade] += 1
    return result


def run(kdir: Path) -> list[str]:
    kdir = Path(kdir)
    if not (kdir / "sources.md").exists():
        return [f"{kdir}: no sources.md"]
    errors = check_ids(kdir) + check_sources(kdir) + check_dropped(kdir)
    if not rule_files(kdir):
        errors.append(f"{kdir}: no rule files")
    for path in rule_files(kdir):
        errors += check_rules(path) + check_checked_date(path) + check_duplicate_headings(path)
    for path in sorted(kdir.glob("*.md")):
        errors += check_dashes(path)
    return errors


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--knowledge-dir", type=Path, default=KNOWLEDGE_DIR)
    args = parser.parse_args(argv)
    errors = run(args.knowledge_dir)
    for line in errors:
        print(f"ERROR {line}")
    if (args.knowledge_dir / "sources.md").exists():
        totals = counts(args.knowledge_dir)
        print(
            f"{totals['sources']} sources, {totals['rules']} rules ({totals['strong']} strong, "
            f"{totals['moderate']} moderate, {totals['emerging']} emerging); {len(errors)} errors"
        )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
