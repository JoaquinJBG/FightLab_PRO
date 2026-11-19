FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# Motor de cálculo vendorizado (paquete `coach`); no se instala con pip
ENV PYTHONPATH=/app/vendor/ai-personal-coach

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Variables mínimas solo para este RUN (no quedan en la imagen): permiten
# que collectstatic no falle sin tocar la base de datos, ya que STATIC_ROOT
# y STORAGES no dependen de ella. Las variables reales las pone Render en
# tiempo de ejecución.
RUN DEBUG=False SECRET_KEY=build-time-only-not-used-at-runtime-0123456789-abcdefghij \
    python manage.py collectstatic --noinput

# Usuario sin privilegios: con una sola instancia (plan free de Render) no
# hay ganancia de aislar procesos, pero tampoco cuesta nada y evita correr
# gunicorn como root. Con --home real (no /nonexistent, el defecto de
# --system): gunicorn 26 escribe ahí el socket de su control server y sin
# un HOME escribible falla con "Permission denied: '/nonexistent'".
RUN addgroup --system app \
    && adduser --system --ingroup app --home /home/app app \
    && mkdir -p /home/app && chown -R app:app /home/app /app
ENV HOME=/home/app
USER app

EXPOSE 8000

# `manage.py boot` (users/management/commands/boot.py), en un solo proceso: migrate, createcachetable,
# sync_knowledge --on-start (la base de evidencia, solo si cambió) y, con DEMO_USER_EMAIL, seed_demo
# (entorno de prueba; con DEBUG=False exige DEMO_SEED_ALLOWED=true). Si sync_knowledge o seed_demo
# fallan se registra y gunicorn arranca igual; si falla migrate, no. --max-requests recicla cada
# worker tras ~500 peticiones (con jitter, no los dos a la vez) para que la RAM no crezca sin fin.
CMD ["sh", "-c", "python manage.py boot && exec gunicorn core.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2 --timeout 90 --max-requests 500 --max-requests-jitter 50"]
