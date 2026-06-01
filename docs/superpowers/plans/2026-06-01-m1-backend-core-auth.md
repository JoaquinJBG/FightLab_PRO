# M1 Backend — Core / Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Django/DRF backend for FightLab Pro's Core/Auth module: a custom email-based user with JWT auth + email verification, plus the athlete profile and biometrics logging API.

**Architecture:** Two Django apps (`users`, `profiles`) on the existing `core` project. Business logic lives in `services.py` (writes/effects) and `selectors.py` (reads), keeping DRF views thin. Auth uses `djangorestframework-simplejwt` with token blacklist; email verification uses signed tokens (`django.core.signing`). The frontend (separate plan) consumes this over `/api/v1`.

**Tech Stack:** Django 5.2, DRF, djangorestframework-simplejwt, django-environ, PostgreSQL, pytest + pytest-django. Dev email via console backend.

**Spec:** [`../specs/2026-06-01-m1-core-auth-design.md`](../specs/2026-06-01-m1-core-auth-design.md)

---

## Conventions for the implementer

- Run all backend commands from `backend/` (where `manage.py` lives), inside the
  docker `backend` container or a local venv with deps installed.
- Test command shorthand used below: `pytest` (config in `backend/pyproject.toml`).
- Commit after each task with the message shown. Branch: work on `main` is fine
  for this solo repo unless told otherwise.
- After every model change: create the migration (`python manage.py makemigrations`)
  and include it in the commit.

## File structure (what this plan creates/modifies)

```
backend/
├── .env.example            # CREATE — documented env vars
├── pyproject.toml          # CREATE — pytest + tooling config
├── conftest.py             # CREATE — shared pytest fixtures
├── requirements.txt        # MODIFY — add pytest, pytest-django
├── core/
│   ├── settings.py         # MODIFY — env, DRF, JWT, CORS, custom user, Postgres, email
│   └── urls.py             # MODIFY — mount /api/v1
├── users/
│   ├── models.py           # MODIFY — CustomUser + manager
│   ├── admin.py            # MODIFY — register CustomUser
│   ├── tokens.py           # CREATE — email verification token helpers
│   ├── services.py         # CREATE — user_create, email_verify, verification_resend
│   ├── serializers.py      # CREATE — Register / Me serializers
│   ├── views.py            # MODIFY — auth endpoints
│   ├── urls.py             # CREATE — users routes
│   └── tests/              # CREATE — test package
└── profiles/               # CREATE — new app
    ├── models.py           # UserProfile, BiometricsLog
    ├── services.py         # profile_update, biometrics_create
    ├── selectors.py        # profile_get, biometrics_list
    ├── serializers.py      # Profile / Biometrics serializers
    ├── views.py            # profile + biometrics endpoints
    ├── urls.py
    ├── admin.py
    └── tests/
```

---

## Phase 0 — Tooling & project configuration

### Task 1: Add test dependencies and pytest config

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/pyproject.toml`

- [ ] **Step 1: Add test deps to requirements**

Append to `backend/requirements.txt` (file currently ends after `djangorestframework-simplejwt` with no newline — add a newline first):

```
djangorestframework-simplejwt
pytest
pytest-django
```

- [ ] **Step 2: Create pytest config**

Create `backend/pyproject.toml`:

```toml
[tool.pytest.ini_options]
DJANGO_SETTINGS_MODULE = "core.settings"
python_files = ["test_*.py"]
addopts = "-ra"
```

- [ ] **Step 3: Install deps**

Run: `pip install -r requirements.txt`
Expected: installs pytest, pytest-django successfully.

- [ ] **Step 4: Commit**

```bash
git add backend/requirements.txt backend/pyproject.toml
git commit -m "build: add pytest and pytest-django"
```

---

### Task 2: Environment-driven settings (env, Postgres, DRF, JWT, CORS, email)

**Files:**
- Create: `backend/.env.example`
- Modify: `backend/core/settings.py`
- Modify: `/home/joaquin/devFLP/fightlab-pro/.env` (root — used by docker-compose and Django)

- [ ] **Step 1: Document env vars**

Create `backend/.env.example`:

```dotenv
# Django
SECRET_KEY=change-me
DEBUG=True
ALLOWED_HOSTS=localhost,127.0.0.1

# PostgreSQL (also consumed by docker-compose db service)
POSTGRES_DB=fightlab
POSTGRES_USER=fightlab
POSTGRES_PASSWORD=fightlab
POSTGRES_HOST=db
POSTGRES_PORT=5432

# Frontend base URL (for verification links)
FRONTEND_URL=http://localhost:3000

# CORS (comma-separated origins allowed to call the API)
CORS_ALLOWED_ORIGINS=http://localhost:3000

# Email verification link validity (seconds)
EMAIL_VERIFICATION_TIMEOUT=86400
```

- [ ] **Step 2: Fill the real root `.env`**

The repo root `.env` is empty and gitignored. Write the same keys with dev values
(copy of `.env.example`) so docker-compose `db` and Django both read them. Put it at
`/home/joaquin/devFLP/fightlab-pro/.env`.

- [ ] **Step 3: Rewrite settings.py**

Replace the body of `backend/core/settings.py` with:

```python
"""Django settings for core project (FightLab Pro)."""
from pathlib import Path
import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, ["localhost", "127.0.0.1"]),
    CORS_ALLOWED_ORIGINS=(list, ["http://localhost:3000"]),
    EMAIL_VERIFICATION_TIMEOUT=(int, 86400),
)
# Read repo-root .env (one level above BASE_DIR) if present.
environ.Env.read_env(BASE_DIR.parent / ".env")

SECRET_KEY = env("SECRET_KEY", default="django-insecure-dev-only")
DEBUG = env("DEBUG")
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
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
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

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB", default="fightlab"),
        "USER": env("POSTGRES_USER", default="fightlab"),
        "PASSWORD": env("POSTGRES_PASSWORD", default="fightlab"),
        "HOST": env("POSTGRES_HOST", default="db"),
        "PORT": env("POSTGRES_PORT", default="5432"),
    }
}

AUTH_USER_MODEL = "users.CustomUser"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- DRF + JWT ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
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

# --- Email (dev: console) ---
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
DEFAULT_FROM_EMAIL = "FightLab Pro <no-reply@fightlab.local>"

# --- App config ---
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:3000")
EMAIL_VERIFICATION_TIMEOUT = env("EMAIL_VERIFICATION_TIMEOUT")
```

- [ ] **Step 4: Add `corsheaders` and `django-environ` are installed**

They are already in `requirements.txt` (`django-cors-headers`, `django-environ`).
Run: `pip install -r requirements.txt`
Expected: no errors.

- [ ] **Step 5: Verify Django configuration loads**

Run: `python manage.py check`
Expected: `System check identified no issues (0 silenced).` (DB need not be up for `check`.)

- [ ] **Step 6: Commit**

```bash
git add backend/core/settings.py backend/.env.example
git commit -m "feat: configure settings for env, postgres, drf, jwt, cors, email"
```

---

## Phase 1 — `users` app: CustomUser

### Task 3: CustomUser model + email manager (TDD)

**Files:**
- Modify: `backend/users/models.py`
- Create: `backend/users/tests/__init__.py`
- Create: `backend/users/tests/test_models.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/users/tests/__init__.py` (empty file).

Create `backend/users/tests/test_models.py`:

```python
import pytest
from django.contrib.auth import get_user_model

User = get_user_model()


@pytest.mark.django_db
def test_create_user_with_email_and_no_username():
    user = User.objects.create_user(email="a@b.com", password="pw-strong-123")
    assert user.email == "a@b.com"
    assert user.check_password("pw-strong-123")
    assert user.username is None
    assert user.role == User.Role.ATHLETE
    assert user.is_email_verified is False
    assert user.is_active is True  # manager default; registration sets it False


@pytest.mark.django_db
def test_create_user_requires_email():
    with pytest.raises(ValueError):
        User.objects.create_user(email="", password="pw-strong-123")


@pytest.mark.django_db
def test_email_is_unique():
    User.objects.create_user(email="dup@b.com", password="pw-strong-123")
    with pytest.raises(Exception):
        User.objects.create_user(email="dup@b.com", password="pw-strong-456")


@pytest.mark.django_db
def test_create_superuser():
    admin = User.objects.create_superuser(email="admin@b.com", password="pw-strong-123")
    assert admin.is_staff is True
    assert admin.is_superuser is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest users/tests/test_models.py -v`
Expected: FAIL/ERROR (CustomUser does not exist yet / no `Role`).

- [ ] **Step 3: Implement the model**

Replace `backend/users/models.py` with:

```python
from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models


class CustomUserManager(BaseUserManager):
    """Manager where email is the unique identifier instead of username."""

    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("Users must have an email address")
        email = self.normalize_email(email)
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        extra_fields.setdefault("is_email_verified", True)
        if extra_fields.get("is_staff") is not True:
            raise ValueError("Superuser must have is_staff=True.")
        if extra_fields.get("is_superuser") is not True:
            raise ValueError("Superuser must have is_superuser=True.")
        return self._create_user(email, password, **extra_fields)


class CustomUser(AbstractUser):
    class Role(models.TextChoices):
        ATHLETE = "ATHLETE", "Athlete"
        COACH = "COACH", "Coach"
        ADMIN = "ADMIN", "Admin"

    username = None  # remove username
    email = models.EmailField("email address", unique=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.ATHLETE)
    is_email_verified = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = CustomUserManager()

    def __str__(self):
        return self.email
```

- [ ] **Step 4: Create the migration**

Run: `python manage.py makemigrations users`
Expected: creates `users/migrations/0001_initial.py`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest users/tests/test_models.py -v`
Expected: 4 passed. (pytest-django builds the test DB from migrations.)

- [ ] **Step 6: Register in admin**

Replace `backend/users/admin.py` with:

```python
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import CustomUser


@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    ordering = ("email",)
    list_display = ("email", "role", "is_email_verified", "is_active", "is_staff")
    search_fields = ("email",)
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Roles", {"fields": ("role", "is_email_verified")}),
        ("Permissions", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Dates", {"fields": ("last_login", "created_at", "updated_at")}),
    )
    readonly_fields = ("created_at", "updated_at", "last_login")
    add_fieldsets = (
        (None, {"classes": ("wide",), "fields": ("email", "password1", "password2", "role")}),
    )
```

- [ ] **Step 7: Commit**

```bash
git add backend/users/models.py backend/users/admin.py backend/users/tests/ backend/users/migrations/0001_initial.py
git commit -m "feat: add email-based CustomUser model and manager"
```

---

## Phase 2 — Email verification token utility

### Task 4: Signed email-verification tokens (TDD)

**Files:**
- Create: `backend/users/tokens.py`
- Create: `backend/users/tests/test_tokens.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/users/tests/test_tokens.py`:

```python
import pytest
from django.contrib.auth import get_user_model

from users.tokens import (
    generate_email_verification_token,
    verify_email_verification_token,
)

User = get_user_model()


@pytest.mark.django_db
def test_roundtrip_returns_user_id():
    user = User.objects.create_user(email="a@b.com", password="pw-strong-123")
    token = generate_email_verification_token(user)
    assert verify_email_verification_token(token) == user.id


def test_tampered_token_raises():
    with pytest.raises(ValueError):
        verify_email_verification_token("not-a-valid-token")


@pytest.mark.django_db
def test_expired_token_raises():
    user = User.objects.create_user(email="a@b.com", password="pw-strong-123")
    token = generate_email_verification_token(user)
    with pytest.raises(ValueError):
        verify_email_verification_token(token, max_age=-1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest users/tests/test_tokens.py -v`
Expected: ERROR (module `users.tokens` not found).

- [ ] **Step 3: Implement the token helpers**

Create `backend/users/tokens.py`:

```python
from django.conf import settings
from django.core import signing

_SALT = "users.email-verification"


def generate_email_verification_token(user) -> str:
    """Return a signed, URL-safe token encoding the user id."""
    return signing.dumps({"user_id": user.id}, salt=_SALT)


def verify_email_verification_token(token: str, max_age: int | None = None) -> int:
    """Return the user id from a valid token, else raise ValueError."""
    if max_age is None:
        max_age = settings.EMAIL_VERIFICATION_TIMEOUT
    try:
        data = signing.loads(token, salt=_SALT, max_age=max_age)
    except signing.BadSignature as exc:
        raise ValueError("Invalid or expired verification token") from exc
    return data["user_id"]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest users/tests/test_tokens.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/users/tokens.py backend/users/tests/test_tokens.py
git commit -m "feat: add signed email-verification token helpers"
```

---

## Phase 3 — Registration & verification (services + endpoints)

### Task 5: `user_create` and `email_verify` services (TDD)

**Files:**
- Create: `backend/users/services.py`
- Create: `backend/users/tests/test_services.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/users/tests/test_services.py`:

```python
import pytest
from django.contrib.auth import get_user_model
from django.core import mail

from users.services import user_create, email_verify, verification_resend
from users.tokens import generate_email_verification_token

User = get_user_model()


@pytest.mark.django_db
def test_user_create_makes_inactive_user_and_sends_email():
    user = user_create(email="a@b.com", password="pw-strong-123")
    assert user.is_active is False
    assert user.is_email_verified is False
    assert len(mail.outbox) == 1
    assert "a@b.com" in mail.outbox[0].to


@pytest.mark.django_db
def test_user_create_rejects_duplicate_email():
    user_create(email="a@b.com", password="pw-strong-123")
    with pytest.raises(ValueError):
        user_create(email="a@b.com", password="pw-strong-456")


@pytest.mark.django_db
def test_email_verify_activates_user():
    user = user_create(email="a@b.com", password="pw-strong-123")
    token = generate_email_verification_token(user)
    verified = email_verify(token=token)
    verified.refresh_from_db()
    assert verified.is_active is True
    assert verified.is_email_verified is True


@pytest.mark.django_db
def test_verification_resend_sends_again_for_unverified():
    user_create(email="a@b.com", password="pw-strong-123")
    mail.outbox.clear()
    verification_resend(email="a@b.com")
    assert len(mail.outbox) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest users/tests/test_services.py -v`
Expected: ERROR (module `users.services` not found).

- [ ] **Step 3: Implement the services**

Create `backend/users/services.py`:

```python
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.mail import send_mail
from django.db import IntegrityError, transaction

from .tokens import generate_email_verification_token, verify_email_verification_token

User = get_user_model()


def _send_verification_email(user) -> None:
    token = generate_email_verification_token(user)
    link = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    send_mail(
        subject="Verify your FightLab Pro account",
        message=f"Welcome to FightLab Pro. Verify your email:\n\n{link}\n",
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[user.email],
    )


@transaction.atomic
def user_create(*, email: str, password: str):
    """Create an inactive user and send the verification email."""
    try:
        user = User.objects.create_user(
            email=email, password=password, is_active=False
        )
    except IntegrityError as exc:
        raise ValueError("A user with this email already exists") from exc
    _send_verification_email(user)
    return user


@transaction.atomic
def email_verify(*, token: str):
    """Activate the user encoded in a valid verification token."""
    user_id = verify_email_verification_token(token)
    try:
        user = User.objects.get(id=user_id)
    except User.DoesNotExist as exc:
        raise ValueError("User no longer exists") from exc
    if not user.is_email_verified:
        user.is_active = True
        user.is_email_verified = True
        user.save(update_fields=["is_active", "is_email_verified", "updated_at"])
    return user


def verification_resend(*, email: str) -> None:
    """Resend the verification email if the user exists and is unverified."""
    try:
        user = User.objects.get(email=email)
    except User.DoesNotExist:
        return  # do not leak which emails exist
    if user.is_email_verified:
        return
    _send_verification_email(user)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest users/tests/test_services.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/users/services.py backend/users/tests/test_services.py
git commit -m "feat: add user_create, email_verify, verification_resend services"
```

---

### Task 6: Registration & verification endpoints (TDD)

**Files:**
- Create: `backend/users/serializers.py`
- Modify: `backend/users/views.py`
- Create: `backend/users/urls.py`
- Modify: `backend/core/urls.py`
- Create: `backend/users/tests/test_auth_api.py`

- [ ] **Step 1: Write the failing API tests**

Create `backend/users/tests/test_auth_api.py`:

```python
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from users.tokens import generate_email_verification_token

User = get_user_model()


@pytest.fixture
def client():
    return APIClient()


@pytest.mark.django_db
def test_register_creates_inactive_user(client):
    resp = client.post(
        "/api/v1/auth/register",
        {"email": "a@b.com", "password": "pw-strong-123"},
        format="json",
    )
    assert resp.status_code == 201
    user = User.objects.get(email="a@b.com")
    assert user.is_active is False


@pytest.mark.django_db
def test_register_rejects_duplicate(client):
    client.post("/api/v1/auth/register", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    resp = client.post("/api/v1/auth/register", {"email": "a@b.com", "password": "pw-strong-456"}, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_verify_email_activates(client):
    client.post("/api/v1/auth/register", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    user = User.objects.get(email="a@b.com")
    token = generate_email_verification_token(user)
    resp = client.post("/api/v1/auth/verify-email", {"token": token}, format="json")
    assert resp.status_code == 200
    user.refresh_from_db()
    assert user.is_active is True
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest users/tests/test_auth_api.py -v`
Expected: FAIL (404 — routes not mounted).

- [ ] **Step 3: Write serializers**

Create `backend/users/serializers.py`:

```python
from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

User = get_user_model()


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, validators=[validate_password])


class VerifyEmailSerializer(serializers.Serializer):
    token = serializers.CharField()


class ResendVerificationSerializer(serializers.Serializer):
    email = serializers.EmailField()


class MeSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ("id", "email", "role", "is_email_verified")
        read_only_fields = fields
```

- [ ] **Step 4: Write views**

Replace `backend/users/views.py` with:

```python
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import services
from .serializers import (
    MeSerializer,
    RegisterSerializer,
    ResendVerificationSerializer,
    VerifyEmailSerializer,
)


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            services.user_create(**serializer.validated_data)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_201_CREATED)


class VerifyEmailView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = VerifyEmailSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            services.email_verify(**serializer.validated_data)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"detail": "Email verified"}, status=status.HTTP_200_OK)


class ResendVerificationView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ResendVerificationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.verification_resend(**serializer.validated_data)
        # Always 200 to avoid leaking which emails are registered.
        return Response({"detail": "If the account exists, an email was sent"})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(MeSerializer(request.user).data)
```

- [ ] **Step 5: Wire users urls**

Create `backend/users/urls.py`:

```python
from django.urls import path
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from .views import (
    MeView,
    RegisterView,
    ResendVerificationView,
    VerifyEmailView,
)
from .logout import LogoutView

urlpatterns = [
    path("auth/register", RegisterView.as_view(), name="register"),
    path("auth/verify-email", VerifyEmailView.as_view(), name="verify-email"),
    path("auth/verify-email/resend", ResendVerificationView.as_view(), name="verify-email-resend"),
    path("auth/login", TokenObtainPairView.as_view(), name="login"),
    path("auth/refresh", TokenRefreshView.as_view(), name="refresh"),
    path("auth/logout", LogoutView.as_view(), name="logout"),
    path("me", MeView.as_view(), name="me"),
]
```

> Note: `LogoutView` is created in Task 7. To keep this task's tests green now,
> temporarily comment out the `logout` import and route, then re-enable them in
> Task 7. (The test file for this task does not hit logout.)

- [ ] **Step 6: Mount /api/v1 in core urls**

Replace the `urlpatterns` in `backend/core/urls.py` with:

```python
from django.contrib import admin
from django.urls import include, path

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/v1/", include("users.urls")),
    path("api/v1/", include("profiles.urls")),
]
```

> Note: `profiles.urls` is created in Task 9. Comment out that line until Task 9,
> then re-enable it. (Alternatively, do Task 9 before running the server.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest users/tests/test_auth_api.py -v`
Expected: 3 passed.

- [ ] **Step 8: Commit**

```bash
git add backend/users/serializers.py backend/users/views.py backend/users/urls.py backend/core/urls.py backend/users/tests/test_auth_api.py
git commit -m "feat: add register and email-verification endpoints"
```

---

### Task 7: JWT login/refresh/logout + /me (TDD)

**Files:**
- Create: `backend/users/logout.py`
- Create: `backend/users/tests/test_jwt_api.py`
- Modify: `backend/users/urls.py` (re-enable logout)

- [ ] **Step 1: Write the failing tests**

Create `backend/users/tests/test_jwt_api.py`:

```python
import pytest
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient

from users.services import user_create, email_verify
from users.tokens import generate_email_verification_token

User = get_user_model()


@pytest.fixture
def client():
    return APIClient()


@pytest.fixture
def verified_user(db):
    user = user_create(email="a@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    return user


@pytest.mark.django_db
def test_unverified_user_cannot_login(client):
    user_create(email="a@b.com", password="pw-strong-123")  # inactive
    resp = client.post("/api/v1/auth/login", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_verified_user_logs_in_and_hits_me(client, verified_user):
    resp = client.post("/api/v1/auth/login", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    assert resp.status_code == 200
    access = resp.data["access"]
    assert "refresh" in resp.data

    me = client.get("/api/v1/me", HTTP_AUTHORIZATION=f"Bearer {access}")
    assert me.status_code == 200
    assert me.data["email"] == "a@b.com"


@pytest.mark.django_db
def test_me_requires_auth(client):
    resp = client.get("/api/v1/me")
    assert resp.status_code == 401


@pytest.mark.django_db
def test_logout_blacklists_refresh(client, verified_user):
    login = client.post("/api/v1/auth/login", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    refresh = login.data["refresh"]
    out = client.post("/api/v1/auth/logout", {"refresh": refresh}, format="json")
    assert out.status_code == 205
    # Reusing a blacklisted refresh fails:
    again = client.post("/api/v1/auth/refresh", {"refresh": refresh}, format="json")
    assert again.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest users/tests/test_jwt_api.py -v`
Expected: FAIL (logout route 404 / not wired).

- [ ] **Step 3: Implement LogoutView**

Create `backend/users/logout.py`:

```python
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        token_str = request.data.get("refresh")
        if not token_str:
            return Response({"detail": "refresh required"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            RefreshToken(token_str).blacklist()
        except TokenError:
            return Response({"detail": "invalid token"}, status=status.HTTP_400_BAD_REQUEST)
        return Response(status=status.HTTP_205_RESET_CONTENT)
```

- [ ] **Step 4: Re-enable logout import/route in `users/urls.py`**

Ensure the `from .logout import LogoutView` import and the `auth/logout` path
(shown in Task 6 Step 5) are uncommented and present.

- [ ] **Step 5: Apply blacklist migrations**

The `token_blacklist` app ships migrations; pytest-django applies them automatically
for the test DB. No action needed beyond having the app in `INSTALLED_APPS` (Task 2).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest users/tests/test_jwt_api.py -v`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add backend/users/logout.py backend/users/urls.py backend/users/tests/test_jwt_api.py
git commit -m "feat: add jwt login, refresh, logout with blacklist"
```

---

## Phase 4 — `profiles` app: profile & biometrics

### Task 8: Create profiles app with UserProfile + BiometricsLog models (TDD)

**Files:**
- Run: `python manage.py startapp profiles` (creates the package)
- Modify: `backend/profiles/models.py`
- Modify: `backend/users/services.py` (auto-create profile on verify)
- Create: `backend/profiles/tests/__init__.py`
- Create: `backend/profiles/tests/test_models.py`

- [ ] **Step 1: Create the app**

Run: `python manage.py startapp profiles`
Then ensure `"profiles"` is in `INSTALLED_APPS` (already added in Task 2).

- [ ] **Step 2: Write the failing tests**

Create `backend/profiles/tests/__init__.py` (empty).

Create `backend/profiles/tests/test_models.py`:

```python
import pytest
from django.core.exceptions import ValidationError
from django.db import IntegrityError

from profiles.models import UserProfile, BiometricsLog
from users.services import user_create, email_verify
from users.tokens import generate_email_verification_token


@pytest.fixture
def profile(db):
    user = user_create(email="a@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    return user.profile


@pytest.mark.django_db
def test_profile_created_on_verification():
    user = user_create(email="x@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    assert UserProfile.objects.filter(user=user).exists()
    assert user.profile.preferred_units == UserProfile.Units.METRIC


@pytest.mark.django_db
def test_biometrics_log_basic(profile):
    log = BiometricsLog.objects.create(profile=profile, weight_kg=80.5, hrv_ms=65)
    assert log.source == BiometricsLog.Source.MANUAL
    assert log.weight_kg == 80.5


@pytest.mark.django_db
def test_sleep_score_must_be_1_to_10(profile):
    log = BiometricsLog(profile=profile, sleep_quality_score=11)
    with pytest.raises(ValidationError):
        log.full_clean()


@pytest.mark.django_db
def test_unique_external_id_per_source(profile):
    BiometricsLog.objects.create(profile=profile, source=BiometricsLog.Source.WHOOP, external_id="abc")
    with pytest.raises(IntegrityError):
        BiometricsLog.objects.create(profile=profile, source=BiometricsLog.Source.WHOOP, external_id="abc")
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pytest profiles/tests/test_models.py -v`
Expected: ERROR (`profiles.models` has no `UserProfile`/`BiometricsLog`; `user.profile` missing).

- [ ] **Step 4: Implement the models**

Replace `backend/profiles/models.py` with:

```python
from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class UserProfile(models.Model):
    class Gender(models.TextChoices):
        MALE = "MALE", "Male"
        FEMALE = "FEMALE", "Female"
        OTHER = "OTHER", "Other"

    class Stance(models.TextChoices):
        ORTHODOX = "ORTHODOX", "Orthodox"
        SOUTHPAW = "SOUTHPAW", "Southpaw"
        SWITCH = "SWITCH", "Switch"

    class Units(models.TextChoices):
        METRIC = "METRIC", "Metric"
        IMPERIAL = "IMPERIAL", "Imperial"

    user = models.OneToOneField(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile"
    )
    date_of_birth = models.DateField(null=True, blank=True)
    gender = models.CharField(max_length=6, choices=Gender.choices, null=True, blank=True)
    height_cm = models.PositiveSmallIntegerField(null=True, blank=True)
    dominant_stance = models.CharField(
        max_length=8, choices=Stance.choices, null=True, blank=True
    )
    preferred_units = models.CharField(
        max_length=8, choices=Units.choices, default=Units.METRIC
    )
    timezone = models.CharField(max_length=64, default="UTC")

    def __str__(self):
        return f"Profile<{self.user.email}>"


class BiometricsLog(models.Model):
    class Source(models.TextChoices):
        MANUAL = "MANUAL", "Manual"
        GARMIN = "GARMIN", "Garmin"
        APPLE_HEALTH = "APPLE_HEALTH", "Apple Health"
        WHOOP = "WHOOP", "Whoop"
        OTHER = "OTHER", "Other"

    profile = models.ForeignKey(
        UserProfile, on_delete=models.CASCADE, related_name="biometrics"
    )
    weight_kg = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    body_fat_pct = models.DecimalField(max_digits=4, decimal_places=1, null=True, blank=True)
    resting_heart_rate = models.PositiveSmallIntegerField(null=True, blank=True)
    sleep_quality_score = models.PositiveSmallIntegerField(
        null=True, blank=True,
        validators=[MinValueValidator(1), MaxValueValidator(10)],
    )
    hrv_ms = models.PositiveSmallIntegerField(null=True, blank=True)
    timestamp = models.DateTimeField(db_index=True, default=None)
    source = models.CharField(max_length=12, choices=Source.choices, default=Source.MANUAL)
    external_id = models.CharField(max_length=128, null=True, blank=True)
    raw_payload = models.JSONField(null=True, blank=True)

    class Meta:
        ordering = ("-timestamp",)
        constraints = [
            models.UniqueConstraint(
                fields=["profile", "source", "external_id"],
                condition=models.Q(external_id__isnull=False),
                name="unique_external_id_per_source",
            )
        ]

    def save(self, *args, **kwargs):
        if self.timestamp is None:
            from django.utils import timezone
            self.timestamp = timezone.now()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Biometrics<{self.profile.user.email} @ {self.timestamp:%Y-%m-%d}>"
```

- [ ] **Step 5: Auto-create the profile on verification**

In `backend/users/services.py`, update `email_verify` so that after activating the
user it ensures a profile exists. Add this import at the top of the function body
(local import avoids a circular import at module load):

Replace the body of `email_verify` (after the user is fetched) so the success path is:

```python
    if not user.is_email_verified:
        user.is_active = True
        user.is_email_verified = True
        user.save(update_fields=["is_active", "is_email_verified", "updated_at"])
    from profiles.models import UserProfile
    UserProfile.objects.get_or_create(user=user)
    return user
```

- [ ] **Step 6: Create the migration**

Run: `python manage.py makemigrations profiles`
Expected: creates `profiles/migrations/0001_initial.py`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest profiles/tests/test_models.py users/tests/test_services.py -v`
Expected: all passed (profile auto-created; biometrics constraints enforced).

- [ ] **Step 8: Commit**

```bash
git add backend/profiles/ backend/users/services.py
git commit -m "feat: add UserProfile and BiometricsLog models with auto-created profile"
```

---

### Task 9: Profile & biometrics services, selectors, and endpoints (TDD)

**Files:**
- Create: `backend/profiles/services.py`
- Create: `backend/profiles/selectors.py`
- Create: `backend/profiles/serializers.py`
- Modify: `backend/profiles/views.py`
- Create: `backend/profiles/urls.py`
- Modify: `backend/core/urls.py` (ensure `profiles.urls` included — see Task 6 Step 6)
- Create: `backend/profiles/tests/test_api.py`

- [ ] **Step 1: Write the failing API tests**

Create `backend/profiles/tests/test_api.py`:

```python
import pytest
from rest_framework.test import APIClient

from users.services import user_create, email_verify
from users.tokens import generate_email_verification_token


@pytest.fixture
def auth_client(db):
    user = user_create(email="a@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(user))
    client = APIClient()
    login = client.post("/api/v1/auth/login", {"email": "a@b.com", "password": "pw-strong-123"}, format="json")
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {login.data['access']}")
    return client


@pytest.mark.django_db
def test_get_and_patch_profile(auth_client):
    resp = auth_client.get("/api/v1/me/profile")
    assert resp.status_code == 200
    assert resp.data["preferred_units"] == "METRIC"

    patched = auth_client.patch("/api/v1/me/profile", {"height_cm": 180, "dominant_stance": "SOUTHPAW"}, format="json")
    assert patched.status_code == 200
    assert patched.data["height_cm"] == 180
    assert patched.data["dominant_stance"] == "SOUTHPAW"


@pytest.mark.django_db
def test_create_and_list_biometrics(auth_client):
    created = auth_client.post("/api/v1/me/biometrics", {"weight_kg": "80.50", "sleep_quality_score": 8}, format="json")
    assert created.status_code == 201

    listed = auth_client.get("/api/v1/me/biometrics")
    assert listed.status_code == 200
    assert len(listed.data) == 1
    assert listed.data[0]["sleep_quality_score"] == 8


@pytest.mark.django_db
def test_biometrics_rejects_bad_sleep_score(auth_client):
    resp = auth_client.post("/api/v1/me/biometrics", {"sleep_quality_score": 99}, format="json")
    assert resp.status_code == 400


@pytest.mark.django_db
def test_user_only_sees_own_biometrics(auth_client):
    # second user with one log
    other = user_create(email="other@b.com", password="pw-strong-123")
    email_verify(token=generate_email_verification_token(other))
    from profiles.models import BiometricsLog
    BiometricsLog.objects.create(profile=other.profile, weight_kg=70)

    auth_client.post("/api/v1/me/biometrics", {"weight_kg": "80.00"}, format="json")
    listed = auth_client.get("/api/v1/me/biometrics")
    assert len(listed.data) == 1  # only own
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest profiles/tests/test_api.py -v`
Expected: FAIL (routes 404).

- [ ] **Step 3: Write selectors**

Create `backend/profiles/selectors.py`:

```python
from .models import BiometricsLog, UserProfile


def profile_get(*, user) -> UserProfile:
    return user.profile


def biometrics_list(*, user, date_from=None, date_to=None):
    qs = BiometricsLog.objects.filter(profile=user.profile)
    if date_from is not None:
        qs = qs.filter(timestamp__gte=date_from)
    if date_to is not None:
        qs = qs.filter(timestamp__lte=date_to)
    return qs
```

- [ ] **Step 4: Write services**

Create `backend/profiles/services.py`:

```python
from .models import BiometricsLog, UserProfile

EDITABLE_PROFILE_FIELDS = {
    "date_of_birth", "gender", "height_cm",
    "dominant_stance", "preferred_units", "timezone",
}


def profile_update(*, user, **fields) -> UserProfile:
    profile = user.profile
    for key, value in fields.items():
        if key in EDITABLE_PROFILE_FIELDS:
            setattr(profile, key, value)
    profile.full_clean()
    profile.save()
    return profile


def biometrics_create(*, user, **fields) -> BiometricsLog:
    log = BiometricsLog(profile=user.profile, **fields)
    log.full_clean()  # enforces sleep_quality_score 1..10 etc.
    log.save()
    return log
```

- [ ] **Step 5: Write serializers**

Create `backend/profiles/serializers.py`:

```python
from rest_framework import serializers

from .models import BiometricsLog, UserProfile


class ProfileSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserProfile
        fields = (
            "date_of_birth", "gender", "height_cm",
            "dominant_stance", "preferred_units", "timezone",
        )


class BiometricsSerializer(serializers.ModelSerializer):
    class Meta:
        model = BiometricsLog
        fields = (
            "id", "weight_kg", "body_fat_pct", "resting_heart_rate",
            "sleep_quality_score", "hrv_ms", "timestamp", "source",
            "external_id", "raw_payload",
        )
        read_only_fields = ("id",)
        extra_kwargs = {"timestamp": {"required": False}}
```

- [ ] **Step 6: Write views**

Replace `backend/profiles/views.py` with:

```python
from rest_framework import status
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import selectors, services
from .models import BiometricsLog
from .serializers import BiometricsSerializer, ProfileSerializer


class ProfileView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        profile = selectors.profile_get(user=request.user)
        return Response(ProfileSerializer(profile).data)

    def patch(self, request):
        serializer = ProfileSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        profile = services.profile_update(user=request.user, **serializer.validated_data)
        return Response(ProfileSerializer(profile).data)


class BiometricsListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        logs = selectors.biometrics_list(user=request.user)
        return Response(BiometricsSerializer(logs, many=True).data)

    def post(self, request):
        serializer = BiometricsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            log = services.biometrics_create(user=request.user, **serializer.validated_data)
        except Exception as exc:  # full_clean ValidationError
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(BiometricsSerializer(log).data, status=status.HTTP_201_CREATED)


class BiometricsDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        log = get_object_or_404(BiometricsLog, pk=pk, profile=request.user.profile)
        log.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
```

> Note on validation: `BiometricsSerializer` does not itself bound the sleep score,
> so `biometrics_create` calls `full_clean()` which raises `ValidationError`; the
> view converts that to HTTP 400. This keeps the model the single source of truth.

- [ ] **Step 7: Wire profiles urls**

Create `backend/profiles/urls.py`:

```python
from django.urls import path

from .views import BiometricsDetailView, BiometricsListCreateView, ProfileView

urlpatterns = [
    path("me/profile", ProfileView.as_view(), name="profile"),
    path("me/biometrics", BiometricsListCreateView.as_view(), name="biometrics"),
    path("me/biometrics/<int:pk>", BiometricsDetailView.as_view(), name="biometrics-detail"),
]
```

Ensure `core/urls.py` includes `path("api/v1/", include("profiles.urls"))` (Task 6 Step 6).

- [ ] **Step 8: Run tests to verify they pass**

Run: `pytest profiles/tests/test_api.py -v`
Expected: 4 passed.

- [ ] **Step 9: Commit**

```bash
git add backend/profiles/ backend/core/urls.py
git commit -m "feat: add profile and biometrics endpoints with services/selectors"
```

---

## Phase 5 — Integration & dev runtime

### Task 10: Full suite, migrations check, and runnable dev server

**Files:**
- Modify: `/home/joaquin/devFLP/fightlab-pro/docker-compose.yml`

- [ ] **Step 1: Run the whole backend test suite**

Run: `pytest -v`
Expected: all tests across `users` and `profiles` pass.

- [ ] **Step 2: Verify no missing migrations**

Run: `python manage.py makemigrations --check --dry-run`
Expected: `No changes detected` (exit code 0).

- [ ] **Step 3: Make the backend container run the dev server**

In `docker-compose.yml`, change the backend `command` from `tail -f /dev/null` to:

```yaml
    command: >
      sh -c "python manage.py migrate &&
             python manage.py runserver 0.0.0.0:8000"
```

- [ ] **Step 4: Bring up the stack and smoke-test register**

Run: `docker compose up -d --build`
Then: `curl -s -X POST http://localhost:8000/api/v1/auth/register -H "Content-Type: application/json" -d '{"email":"smoke@b.com","password":"pw-strong-123"}' -o /dev/null -w "%{http_code}\n"`
Expected: `201`. The verification link is printed in the backend container logs
(`docker compose logs backend`).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "build: run migrations and dev server in backend container"
```

---

## Self-review checklist (done while writing — kept for the implementer)

- **Spec coverage:** CustomUser ✓ (Task 3), email verification ✓ (Tasks 4–6),
  JWT login/refresh/logout ✓ (Task 7), `/me` ✓ (Task 7), UserProfile + auto-create
  ✓ (Task 8), BiometricsLog incl. `hrv_ms`/`source`/`external_id`/`raw_payload` and
  the unique constraint ✓ (Task 8), profile & biometrics endpoints with
  services/selectors ✓ (Task 9), per-user data isolation ✓ (Task 9 test),
  Services/Selectors pattern ✓ throughout, Postgres + env + Docker ✓ (Tasks 2, 10).
- **Out of scope (correctly deferred):** password reset, wearable ingestion,
  coach permissions, AI, the entire frontend/PWA (separate plan).
- **Naming consistency:** `user_create`, `email_verify`, `verification_resend`,
  `profile_get`, `profile_update`, `biometrics_create`, `biometrics_list`,
  `generate_email_verification_token`, `verify_email_verification_token` — used
  identically across tasks.

## Known sequencing notes for the implementer

- Task 6 references `users.logout` (Task 7) and `profiles.urls` (Task 9). Follow the
  inline notes to comment those out until their task lands, or implement Tasks 6→9
  back-to-back and only run the server after Task 9.
- `BiometricsLog.timestamp` has no DB default; it is set in `save()`. The serializer
  marks it optional so clients may omit it (defaults to now) or pass an explicit value.
```
