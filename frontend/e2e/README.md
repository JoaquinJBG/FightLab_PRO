# E2E (Playwright)

Prueban el onboarding con cribado (`onboarding.spec.ts`), los objetivos, el pesaje y los bloqueos
de la fase 4 (`nutrition.spec.ts`), el check-in diario con la tendencia de la fase 5
(`checkin.spec.ts`), el plan de la semana de la fase 6 (`plan.spec.ts`), la revisión semanal de la
fase 7 (`review.spec.ts`), los menús de la fase 8 (`menu.spec.ts`) y los importadores de la fase 9 con
el aviso de sesión vigorosa (`import.spec.ts`, con CSV inventados) y la importación del historial de
ParteDiario y del coach de la fase 10 (`history.spec.ts`, con datos inventados) y la pantalla Hoy
con los avisos apagados de la fase 11 (`today.spec.ts`) y los menús completos de la fase 12 (`menu-import.spec.ts`:
importar JSON schema 1 y YAML del coach, reimportar sin perder lo tachado y la víspera en Hoy; `batch.spec.ts`: el
menaje manda en el cronograma y la sesión de batch a pantalla completa) y el catálogo de cadena privado de la fase 13 (`catalogue.spec.ts`, con un CSV inventado) de punta a punta: Next (BFF) + Django + motor del coach.
Usan el Chrome instalado (`channel: "chrome"`), así que no hace falta `playwright install`.
Tras el login la app va a `/today` (Hoy); el resumen de antes está en `/dashboard`.

La suite completa hace unos 40 inicios de sesión y el backend admite 10 por minuto desde la misma IP
(`login` en `DEFAULT_THROTTLE_RATES`): si alguna prueba falla esperando `/today` tras el login con un
429 en el log de Django, repítela sola.

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

`menu.spec.ts` espera el backend **sin** `COACH_OFF_CONTACT` (comprueba que el proxy de Open Food
Facts dice que no está configurado y que no se llama a OFF). Los menús usan siempre el proveedor
simulado: no hace falta `ANTHROPIC_API_KEY` y, aunque la haya, no se llama a Anthropic.

Variables: `E2E_BASE_URL` (por defecto `http://localhost:3000`) y `E2E_CHANNEL`
(`chrome`; `msedge` también vale). Las pruebas con la API mockeada (`pnpm test:e2e`) usan el
puerto 3100; si está ocupado, `E2E_PORT=3112 pnpm test:e2e`.

Las de la fase 12 esperan el backend **sin** las variables `R2_*`: la tarjeta de tickets dice que
la subida no está configurada y nunca se llama a Cloudflare R2.
