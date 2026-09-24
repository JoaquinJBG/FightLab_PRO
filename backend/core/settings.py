"""Django settings for core project (FightLab Pro)."""
from pathlib import Path
import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:3000"]),
    CSRF_TRUSTED_ORIGINS=(list, []),
    EMAIL_VERIFICATION_TIMEOUT=(int, 86400),
)
# Read repo-root .env (one level above BASE_DIR) if present.
environ.Env.read_env(BASE_DIR.parent / ".env")

DEBUG = env("DEBUG")

if DEBUG:
    SECRET_KEY = env("SECRET_KEY", default="django-insecure-dev-only")
else:
    # Obligatoria en producción: sin ella se podrían falsificar JWT y tokens
    # de verificación de email con la clave insegura por defecto.
    try:
        SECRET_KEY = env("SECRET_KEY")
    except ImproperlyConfigured as exc:
        raise ImproperlyConfigured(
            "SECRET_KEY es obligatoria cuando DEBUG=False."
        ) from exc

ALLOWED_HOSTS = env("ALLOWED_HOSTS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # Third party
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "corsheaders",
    # Local
    "users",
    "profiles",
    "ai",
    "activities",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "core.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "core.wsgi.application"

# DATABASE_URL tiene prioridad (Render/Neon en producción); si falta se
# construye a partir de las variables POSTGRES_* para que sigan funcionando
# el docker-compose local y los tests.
_default_db_url = "postgres://{user}:{password}@{host}:{port}/{name}".format(
    user=env("POSTGRES_USER", default="fightlab"),
    password=env("POSTGRES_PASSWORD", default="fightlab"),
    host=env("POSTGRES_HOST", default="db"),
    port=env("POSTGRES_PORT", default="5432"),
    name=env("POSTGRES_DB", default="fightlab"),
)
DATABASES = {
    "default": env.db("DATABASE_URL", default=_default_db_url),
}
DATABASES["default"]["CONN_MAX_AGE"] = 60
DATABASES["default"]["CONN_HEALTH_CHECKS"] = True

AUTH_USER_MODEL = "users.CustomUser"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "es-es"
TIME_ZONE = "Europe/Madrid"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(env("MEDIA_ROOT", default=str(BASE_DIR / "media")))
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Límites de subida (fotos comprimidas en el cliente y en el servidor) ---
DATA_UPLOAD_MAX_MEMORY_SIZE = env.int("DATA_UPLOAD_MAX_MEMORY_SIZE", default=10 * 1024 * 1024)
FILE_UPLOAD_MAX_MEMORY_SIZE = env.int("FILE_UPLOAD_MAX_MEMORY_SIZE", default=10 * 1024 * 1024)

# --- DRF + JWT ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
    "DEFAULT_THROTTLE_CLASSES": (
        "rest_framework.throttling.UserRateThrottle",
    ),
    # Nombres de scope válidos en todo el proyecto (los usan los views con
    # ScopedRateThrottle); "user" es el límite general por usuario/IP.
    "DEFAULT_THROTTLE_RATES": {
        "user": "300/min",
        "login": "10/min",
        "register": "5/hour",
        "password-reset": "5/hour",
        "ai-chat": "20/hour",
        "ai-food": "10/hour",
        "activities-sync": "30/min",
        "user-state": "60/min",
    },
}

from datetime import timedelta  # noqa: E402

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
}

# --- CORS ---
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = True

# --- Email ---
# Sin EMAIL_BACKEND en el .env -> consola (el enlace se imprime en el backend).
# Con el backend SMTP -> envío real; los valores de Gmail se toman del .env.
EMAIL_BACKEND = env(
    "EMAIL_BACKEND",
    default="django.core.mail.backends.console.EmailBackend",
)
if "smtp" in EMAIL_BACKEND.lower():
    EMAIL_HOST = env("EMAIL_HOST", default="smtp.gmail.com")
    EMAIL_PORT = env.int("EMAIL_PORT", default=587)
    EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
    EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
    EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="FightLab Pro <no-reply@fightlab.local>")

# --- App config ---
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:3000")
EMAIL_VERIFICATION_TIMEOUT = env("EMAIL_VERIFICATION_TIMEOUT")

# --- IA (Anthropic) ---
# Sin clave, los endpoints de IA responden 503 y el frontend degrada a reglas/simulado
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", default="")
AI_MODEL_CHAT = env("AI_MODEL_CHAT", default="claude-sonnet-4-6")
AI_MODEL_VISION = env("AI_MODEL_VISION", default="claude-sonnet-4-6")
