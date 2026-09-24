"""Django settings for core project (FightLab Pro)."""
import logging
import os
from pathlib import Path
import environ
from django.core.exceptions import ImproperlyConfigured

logger = logging.getLogger(__name__)

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
    "anymail",
    # Local
    "users",
    "profiles",
    "ai",
    "activities",
    "userstate",
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
# Tolera lo que se suele pegar desde el panel de Neon: comillas, espacios o el
# comando `psql '...'` entero en vez de solo la cadena de conexión.
_raw_db_url = env.str("DATABASE_URL", default="").strip()
if _raw_db_url.startswith("psql "):
    _raw_db_url = _raw_db_url[len("psql "):].strip()
_raw_db_url = _raw_db_url.strip("'\"")
DATABASES = {
    "default": environ.Env.db_url_config(_raw_db_url or _default_db_url),
}
if not DATABASES["default"].get("ENGINE"):
    raise ImproperlyConfigured(
        "DATABASE_URL no es válida: debe empezar por postgresql:// (sin comillas ni 'psql')."
    )
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
    # TrustedBffAnonRateThrottle sustituye a UserRateThrottle: para peticiones
    # autenticadas identifica por request.user.pk igual que la clase de DRF
    # (sin cambios), pero para las anónimas (p. ej. VerifyEmailView, que no
    # define throttle_classes propio) confía en X-Bff-Client-Ip+X-Bff-Secret
    # como TrustedBffScopedRateThrottle, en vez de compartir un único
    # contador por la IP de salida del BFF. Ver users/throttling.py.
    "DEFAULT_THROTTLE_CLASSES": (
        "users.throttling.TrustedBffAnonRateThrottle",
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
    # de nivel superior. Este valor SOLO se usa como fallback (sin
    # BFF_SHARED_SECRET, o con el secreto incorrecto): la URL pública de
    # Render (*.onrender.com) se puede llamar directamente sin pasar por el
    # BFF, y ahí solo hay UN proxy de confianza (el propio borde de Render),
    # así que el valor correcto es 1 en todos los entornos (.env.example y
    # render.yaml incluidos). Poner aquí 2 (asumiendo siempre BFF -> Render)
    # dejaría que cualquiera que llame directo al backend se salte el
    # throttle inventándose X-Forwarded-For.
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
# Desde septiembre de 2025, Render bloquea en los web services del plan free
# el tráfico saliente a los puertos SMTP 25/465/587
# (https://render.com/changelog/free-web-services-will-no-longer-allow-outbound-traffic-to-smtp-ports),
# así que en producción no se puede usar el backend SMTP de Django. En su
# lugar, EMAIL_PROVIDER elige entre 'smtp' (por defecto: compatibilidad con
# el .env de dev/tests previo a este cambio, válido en local o en un plan de
# pago), 'console' (el enlace se imprime en el log, para dev sin credenciales)
# y 'brevo'/'resend' (envío real por su API HTTP vía django-anymail, la
# opción para el plan free de Render).
EMAIL_PROVIDER = env("EMAIL_PROVIDER", default="smtp")
# Timeout de red para el envío de email. Django lee EMAIL_TIMEOUT de forma
# nativa para el backend SMTP; para Anymail se reutiliza el mismo valor en
# ANYMAIL["REQUESTS_TIMEOUT"] más abajo. Sin esto, un SMTP que no responde
# (como el bloqueo silencioso de Render) deja la petición de registro
# colgada hasta el timeout de gunicorn o del BFF.
EMAIL_TIMEOUT = env.int("EMAIL_TIMEOUT", default=10)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="FightLab Pro <no-reply@fightlab.local>")

if EMAIL_PROVIDER == "brevo":
    EMAIL_BACKEND = "anymail.backends.brevo.EmailBackend"
    ANYMAIL = {
        "BREVO_API_KEY": env("BREVO_API_KEY", default=""),
        "REQUESTS_TIMEOUT": EMAIL_TIMEOUT,
    }
elif EMAIL_PROVIDER == "resend":
    EMAIL_BACKEND = "anymail.backends.resend.EmailBackend"
    ANYMAIL = {
        "RESEND_API_KEY": env("RESEND_API_KEY", default=""),
        "REQUESTS_TIMEOUT": EMAIL_TIMEOUT,
    }
elif EMAIL_PROVIDER == "console":
    EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
else:
    # 'smtp' (valor por defecto de EMAIL_PROVIDER): sin EMAIL_BACKEND en el
    # .env -> consola (el enlace se imprime en el backend). Con el backend
    # SMTP -> envío real; los valores de Gmail se toman del .env. NO apto
    # para el plan free de Render (ver EMAIL_PROVIDER más arriba).
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
if not DEBUG and not BFF_SHARED_SECRET:
    logger.warning(
        "BFF_SHARED_SECRET no está configurado con DEBUG=False: el throttle "
        "de auth (login, register, password-reset...) no podrá distinguir "
        "a los visitantes detrás del BFF y compartirán un único contador "
        "por la IP de salida de Vercel."
    )

# --- IA (Anthropic) ---
# Sin clave, los endpoints de IA responden 503 y el frontend degrada a reglas/simulado
ANTHROPIC_API_KEY = env("ANTHROPIC_API_KEY", default="")
AI_MODEL_CHAT = env("AI_MODEL_CHAT", default="claude-sonnet-5")
AI_MODEL_VISION = env("AI_MODEL_VISION", default="claude-sonnet-5")
