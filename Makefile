# Tests locales con un solo comando: `make test`.
# Postgres propio en el puerto 54329 (nunca el 5432 de otras apps) y entorno
# hermético: no lee el .env del repo ni necesita ninguna clave.
SHELL := bash

TEST_DB_PORT ?= 54329
TEST_DB_NAME ?= fightlab_test
TEST_DB_CONTAINER ?= fightlab-test-db
TEST_DATABASE_URL := postgres://fightlab:fightlab@127.0.0.1:$(TEST_DB_PORT)/$(TEST_DB_NAME)

# Python 3.12 (el mismo que backend/Dockerfile y CI). Usa el venv de .venv si existe.
_VENV_PY := $(firstword $(wildcard .venv/Scripts/python.exe .venv/bin/python))
PY ?= $(if $(_VENV_PY),$(abspath $(_VENV_PY)),python)
PNPM := pnpm --dir frontend

# Entorno del backend en tests: sin .env, sin clave de IA, DEBUG para SECRET_KEY de dev.
BACKEND_ENV = ENV_FILE=/nonexistent DEBUG=True DATABASE_URL=$(TEST_DATABASE_URL) ANTHROPIC_API_KEY=

.PHONY: test test-backend test-frontend test-e2e lint db-up db-down venv frontend-deps

test: test-backend test-frontend

venv:
	python -m venv .venv
	$(PY) -m pip install -r backend/requirements-dev.txt

db-up:
	@docker inspect $(TEST_DB_CONTAINER) >/dev/null 2>&1 || docker run -d --name $(TEST_DB_CONTAINER) \
		-e POSTGRES_USER=fightlab -e POSTGRES_PASSWORD=fightlab -e POSTGRES_DB=$(TEST_DB_NAME) \
		-p 127.0.0.1:$(TEST_DB_PORT):5432 postgres:15 >/dev/null
	@docker start $(TEST_DB_CONTAINER) >/dev/null
	@until docker exec $(TEST_DB_CONTAINER) pg_isready -U fightlab -d $(TEST_DB_NAME) >/dev/null 2>&1; do sleep 1; done
	@echo "Postgres de tests listo en 127.0.0.1:$(TEST_DB_PORT)"

db-down:
	-docker rm -f $(TEST_DB_CONTAINER)

test-backend: db-up
	cd backend && $(BACKEND_ENV) $(PY) -m pytest -q
	cd backend && $(BACKEND_ENV) $(PY) manage.py makemigrations --check --dry-run
	cd backend && $(BACKEND_ENV) DEBUG=False SECRET_KEY=local-dummy-Zq8Lw3Rt7Yp2Nm5Kd9Vh4Xc6Bj1Fg0Sa-not-a-real-secret BFF_SHARED_SECRET=x 		ALLOWED_HOSTS=api.example.test ADMIN_URL=secret-admin/ EMAIL_PROVIDER=console 		FRONTEND_URL=https://app.example.test $(PY) manage.py check --deploy --fail-level WARNING

frontend-deps:
	$(PNPM) install --frozen-lockfile

lint: frontend-deps
	$(PNPM) lint
	$(PNPM) typecheck

test-frontend: lint
	$(PNPM) test

# Requiere `pnpm --dir frontend exec playwright install chromium` la primera vez.
test-e2e: frontend-deps
	$(PNPM) test:e2e
