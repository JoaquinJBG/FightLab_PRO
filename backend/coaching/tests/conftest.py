from pathlib import Path

import pytest
from django.core.management import call_command

FIXTURES = Path(__file__).resolve().parents[2] / "vendor" / "ai-personal-coach" / "tests" / "fixtures" / "knowledge"
GOOD_DIR = FIXTURES / "good"
BAD_DIR = FIXTURES / "bad"


@pytest.fixture
def real_knowledge(db):
    """Carga el `knowledge/` real del coach (459 reglas, 859 fuentes)."""
    call_command("load_knowledge", verbosity=0)
