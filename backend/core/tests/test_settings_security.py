"""Comprueba en un subproceso aparte (settings.py se ejecuta una sola vez
por proceso) que la configuración de producción es la esperada."""
import os
import secrets
import subprocess
import sys

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Variables que settings.py podría rellenar desde el .env local si no se
# pasan explícitas: se limpian del entorno base para que el subproceso solo
# vea lo que cada test define.
_SETTINGS_KEYS = [
    "SECRET_KEY", "DEBUG", "ALLOWED_HOSTS", "DATABASE_URL",
    "POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_HOST", "POSTGRES_PORT",
    "CORS_ALLOWED_ORIGINS", "CSRF_TRUSTED_ORIGINS", "FRONTEND_URL",
    "EMAIL_VERIFICATION_TIMEOUT", "ENV_FILE",
]


def _run(extra_env, args):
    base_env = {k: v for k, v in os.environ.items() if k not in _SETTINGS_KEYS}
    env = {**base_env, **extra_env}
    return subprocess.run(
        args,
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )


def test_secret_key_obligatoria_sin_debug(tmp_path):
    """Sin SECRET_KEY y con DEBUG=False, Django no debe arrancar.

    Se apunta ENV_FILE a una ruta que no existe en tmp_path para que el
    subproceso no lea ningún .env real (ni el del worktree, que sí trae un
    SECRET_KEY de desarrollo): así el test no toca ni renombra ficheros del
    desarrollador, y no hay carrera si dos ejecuciones corren en paralelo.
    """
    env = {
        "DJANGO_SETTINGS_MODULE": "core.settings",
        "ENV_FILE": str(tmp_path / "no-existe.env"),
        "DEBUG": "False",
        "ALLOWED_HOSTS": "example.com",
        "DATABASE_URL": "postgres://u:p@localhost:5432/db",
    }
    result = _run(env, [sys.executable, "-c", "import django; django.setup()"])
    assert result.returncode != 0
    assert "SECRET_KEY" in result.stderr


def test_check_deploy_sin_avisos_con_produccion_simulada():
    env = {
        "DJANGO_SETTINGS_MODULE": "core.settings",
        "DEBUG": "False",
        "SECRET_KEY": secrets.token_urlsafe(50),
        "ALLOWED_HOSTS": "fightlab-backend.onrender.com",
        "CSRF_TRUSTED_ORIGINS": "https://fightlab-backend.onrender.com",
        "CORS_ALLOWED_ORIGINS": "",
        "DATABASE_URL": "postgres://u:p@localhost:5432/db",
        "FRONTEND_URL": "https://fightlab.vercel.app",
    }
    result = _run(env, [sys.executable, "manage.py", "check", "--deploy"])
    assert result.returncode == 0, result.stdout + result.stderr
    assert "System check identified no issues" in result.stdout
