# E2E (Playwright)

Prueban el onboarding con cribado de punta a punta: Next (BFF) + Django + motor del coach.
Usan el Chrome instalado (`channel: "chrome"`), así que no hace falta `playwright install`.

1. Backend con su base de datos migrada, en el puerto que lee el BFF (por defecto 8001):

   ```bash
   cd backend
   python manage.py migrate
   python manage.py load_knowledge   # opcional: grados de evidencia en los chips
   python manage.py runserver 127.0.0.1:8001
   ```

2. Frontend compilado y arrancado (`DJANGO_API_URL` si el backend no está en 8001):

   ```bash
   cd frontend
   pnpm build && pnpm start
   ```

3. Las pruebas. `E2E_PYTHON` es el Python del venv del backend, con el mismo entorno
   (base de datos, `PYTHONPATH=vendor/ai-personal-coach`) que Django: `global-setup.ts` crea
   los usuarios de prueba con `manage.py shell`.

   ```bash
   E2E_PYTHON=../backend/.venv/Scripts/python.exe pnpm e2e
   ```

Variables: `E2E_BASE_URL` (por defecto `http://localhost:3000`) y `E2E_CHANNEL`
(`chrome`; `msedge` también vale).
