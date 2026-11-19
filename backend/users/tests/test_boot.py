"""`manage.py boot`: el arranque del contenedor en un solo proceso (fix G1-6).

migrate, createcachetable, sync_knowledge --on-start y, solo con DEMO_USER_EMAIL, seed_demo, con
`call_command`. Si sync_knowledge o seed_demo fallan se registra y se sigue (gunicorn arranca igual);
si falla migrate, el arranque se para, como antes con `&&`.
"""
import io
import re
from pathlib import Path

import pytest
from django.core.management import call_command

DOCKERFILE = Path(__file__).resolve().parents[2] / "Dockerfile"


class Calls(list):
    """Lo que `boot` pide a `call_command`; los nombres de `fail` lanzan una excepción."""

    def __init__(self):
        super().__init__()
        self.fail: set[str] = set()


@pytest.fixture
def calls(monkeypatch):
    seen = Calls()

    def fake(name, *args, **kwargs):
        seen.append((name, args, {k: v for k, v in kwargs.items() if k not in ("stdout", "stderr")}))
        if name in seen.fail:
            raise RuntimeError(f"{name} roto")

    monkeypatch.setattr("users.management.commands.boot.call_command", fake)
    return seen


def names(calls):
    return [c[0] for c in calls]


def run():
    out, err = io.StringIO(), io.StringIO()
    call_command("boot", stdout=out, stderr=err)
    return out.getvalue() + err.getvalue()


def test_runs_every_step_in_order(calls, monkeypatch):
    monkeypatch.setenv("DEMO_USER_EMAIL", "demo@fightlab.test")
    run()
    assert names(calls) == ["migrate", "createcachetable", "sync_knowledge", "seed_demo"]
    assert calls[0][2].get("interactive") is False
    assert calls[2][2].get("on_start") is True


def test_seed_demo_only_with_the_demo_email(calls, monkeypatch):
    monkeypatch.delenv("DEMO_USER_EMAIL", raising=False)
    run()
    assert names(calls) == ["migrate", "createcachetable", "sync_knowledge"]


@pytest.mark.parametrize("broken", ["sync_knowledge", "seed_demo"])
def test_a_failing_optional_step_is_logged_and_boot_goes_on(calls, monkeypatch, caplog, broken):
    monkeypatch.setenv("DEMO_USER_EMAIL", "demo@fightlab.test")
    calls.fail.add(broken)
    output = run()
    assert names(calls) == ["migrate", "createcachetable", "sync_knowledge", "seed_demo"]
    assert f"{broken} ha fallado" in output
    assert f"{broken} roto" in caplog.text


def test_a_failing_migrate_stops_the_boot(calls):
    calls.fail.add("migrate")
    with pytest.raises(RuntimeError):
        run()
    assert names(calls) == ["migrate"]


def test_the_container_boots_in_one_process_then_gunicorn():
    cmd = next(line for line in DOCKERFILE.read_text(encoding="utf-8").splitlines() if line.startswith("CMD "))
    assert re.search(r"python manage\.py boot && (exec )?gunicorn core\.wsgi", cmd), cmd
    for step in ("migrate", "createcachetable", "sync_knowledge", "seed_demo"):
        assert step not in cmd
