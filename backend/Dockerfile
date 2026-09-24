FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev gcc && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Variables mínimas solo para este RUN (no quedan en la imagen): permiten
# que collectstatic no falle sin tocar la base de datos, ya que STATIC_ROOT
# y STORAGES no dependen de ella. Las variables reales las pone Render en
# tiempo de ejecución.
RUN DEBUG=False SECRET_KEY=build-time-only-not-used-at-runtime \
    python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py createcachetable && gunicorn core.wsgi:application --bind 0.0.0.0:${PORT:-8000} --workers 2 --timeout 90"]
