"""F25: `docker compose up` deja la base lista para registrarse. Sin la tabla de caché
(`createcachetable`) el registro daba 500 y la app decía «No se pudo registrar»."""
import re
from pathlib import Path

import yaml

COMPOSE = Path(__file__).resolve().parents[3] / "docker-compose.yml"


def test_backend_creates_the_cache_table_between_migrate_and_runserver():
    command = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))["services"]["backend"]["command"]
    steps = [s.strip() for s in re.split(r"&&", command.replace('sh -c "', "").rstrip('"\n'))]
    names = [s.split()[2] for s in steps if s.startswith("python manage.py")]
    assert names == ["migrate", "createcachetable", "runserver"]
