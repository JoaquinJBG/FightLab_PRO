# E2E (Playwright)

Prueban el onboarding con cribado (`onboarding.spec.ts`), los objetivos, el pesaje y los bloqueos
de la fase 4 (`nutrition.spec.ts`), el check-in diario con la tendencia de la fase 5
(`checkin.spec.ts`), el plan de la semana de la fase 6 (`plan.spec.ts`), la revisión semanal de la
fase 7 (`review.spec.ts`) y los importadores de la fase 9 con el aviso de sesión vigorosa
(`import.spec.ts`, con CSV inventados) de punta a punta: Next (BFF) + Django + motor del coach.
Usan el Chrome instalado (`channel: "chrome"`), así que no hace falta `playwright install`.

1. Backend con su base de datos migrada, en el puerto que lee el BFF (por defecto 8001):

   ```bash
   cd backend
   python manage.py migrate
   python manage.py load_knowledge   # opcional: grados de evidencia en los chips
   python manage.py load_knowledge --dir knowledge_fightlab --origin fightlab   # anexo de combate
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

El selector de idioma está encendido por defecto (`LANGUAGE_SELECTOR_ENABLED` en el backend y
`NEXT_PUBLIC_LANGUAGE_SELECTOR_ENABLED` en el build del frontend; con `False`/`false` se apaga).
Una prueba recorre el onboarding con un navegador en inglés eligiendo inglés en el primer paso.

Variables: `E2E_BASE_URL` (por defecto `http://localhost:3000`) y `E2E_CHANNEL`
(`chrome`; `msedge` también vale).
