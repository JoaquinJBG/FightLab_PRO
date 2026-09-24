"""Django settings for core project (FightLab Pro)."""
import os
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
    BETA_ALLOWED_EMAILS=(list, []),
)
# Read repo-root .env (one level above BASE_DIR) if present. Configurable con
# ENV_FILE para que los tests puedan apuntar a una ruta que no exista sin
# tocar el .env real del desarrollador (que no se debe mover ni borrar).
environ.Env.read_env(os.environ.get("ENV_FILE", str(BASE_DIR.parent / ".env")))

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
# Render asigna un subdominio *.onrender.com y lo expone en esta variable de
# entorno: si no está en ALLOWED_HOSTS, su propio health check (que llega con
# ese Host) recibe 400 y el despliegue nunca pasa a "healthy".
_render_hostname = env("RENDER_EXTERNAL_HOSTNAME", default="")
if _render_hostname and _render_hostname not in ALLOWED_HOSTS:
    ALLOWED_HOSTS = [*ALLOWED_HOSTS, _render_hostname]

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
        "resend": "5/hour",
        "password-reset-confirm": "5/hour",
    },
    # Nº de proxies de confianza delante de Django, para que el throttling
    # por IP (SimpleRateThrottle.get_ident) recorte la cabecera X-Forwarded-For
    # en la posición correcta en vez de fiarse de la cabecera entera (que el
    # cliente controla). DRF solo lee esta clave aquí dentro, no como setting
    # de nivel superior. Cadena real: BFF de Next -> borde de Render ->
    # gunicorn; Render añade la IP de quien conecta con él, así que con el
    # BFF reenviando la IP del cliente el valor correcto es 2 (se fija en
    # .env.example/render.yaml; el 1 de aquí es solo un valor de arranque
    # seguro si alguien olvida definir la variable).
    "NUM_PROXIES": env.int("NUM_PROXIES", default=1),
}

from datetime import timedelta  # noqa: E402

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    # Desactivados: con serverless (Vercel BFF) varias peticiones pueden
    # disparar un refresh a la vez y la rotación cerraría sesión al azar.
    # El logout sigue metiendo el refresh en la blacklist.
    "ROTATE_REFRESH_TOKENS": False,
    "BLACKLIST_AFTER_ROTATION": False,
}

# Caché en la base de datos: LocMem cuenta por separado en cada worker de
# gunicorn, lo que rompería el throttling.
CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.db.DatabaseCache",
        "LOCATION": "django_cache_table",
    }
}

# --- CORS ---
CORS_ALLOWED_ORIGINS = env("CORS_ALLOWED_ORIGINS")
CORS_ALLOW_CREDENTIALS = True

# --- Seguridad en producción ---
if not DEBUG:
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SECURE_SSL_REDIRECT = True
    # /health no debe redirigirse: el health check de Render lo pide por HTTP.
    SECURE_REDIRECT_EXEMPT = [r"^health/?$"]
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # 3600s es razonable para la beta. PRELOAD no tiene efecto real en un
    # subdominio *.onrender.com (no se puede enviar a la lista de precarga
    # de los navegadores); solo importa si algún día se usa dominio propio.
    # Se deja porque no hace daño y evita un aviso más de check --deploy.
    SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=3600)
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True
    SECURE_HSTS_PRELOAD = True
    CSRF_TRUSTED_ORIGINS = env("CSRF_TRUSTED_ORIGINS")

# --- Logging (a consola: lo recoge el logging del propio PaaS) ---
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": env("DJANGO_LOG_LEVEL", default="INFO"),
    },
    "loggers": {
        "django": {
            "handlers": ["console"],
            "level": env("DJANGO_LOG_LEVEL", default="INFO"),
            "propagate": False,
        },
    },
}

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

# Ruta del admin, para no dejarlo en /admin/ en producción.
ADMIN_URL = env("ADMIN_URL", default="admin/")

# --- Beta cerrada por invitación ---
# Emails separados por comas. Vacía + DEBUG -> se permite todo (dev local).
# Vacía + DEBUG=False -> no se permite ningún registro (hay que pegar la lista en producción).
BETA_ALLOWED_EMAILS = [e.strip().lower() for e in env("BETA_ALLOWED_EMAILS")]

# --- Throttle detrás del BFF (Vercel -> Render) ---
# Sin esto, Django ve todas las peticiones anónimas de auth/* llegando desde
# las pocas IPs de salida del BFF y comparte un único contador de throttle
# entre toda la beta. Cuando el BFF manda este mismo secreto en la cabecera
# X-Bff-Secret junto con X-Bff-Client-Ip, el throttle de users/throttling.py
# confía en esa IP como identidad real del visitante; sin el secreto (valor
# por defecto, vacío) se ignora esa cabecera y se usa el comportamiento
# estándar de DRF (REMOTE_ADDR / X-Forwarded-For según NUM_PROXIES), así que
# nadie puede saltarse el throttle inventándose esas cabeceras.
BFF_SHARED_SECRET = env("BFF_SHARED_SECRET", default="")

# --- IA (Anthropic) ---
# Sin clave, los endpoints de IA responden 503 y el frontend degrada a reglas/simulado
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", default="")
AI_MODEL_CHAT = env("AI_MODEL_CHAT", default="claude-sonnet-4-6")
AI_MODEL_VISION = env("AI_MODEL_VISION", default="claude-sonnet-4-6")
