"""Menús inventados para las pruebas de la fase 12 (JSON `schema: 1` y YAML del coach).

Nada de aquí sale de un menú real: platos, cantidades y fechas son de prueba. Los nombres de
alimentos son los de la tabla del motor (`foods/base.csv`) para que el motor los reconozca.
"""
from __future__ import annotations

import json
from datetime import date, timedelta

START = date(2026, 11, 2)  # lunes; la sesión de batch es el domingo de antes


def schema1(menu_id: str = "2026-11-02", start: date = START, days: int = 5, **extra) -> dict:
    dates = [start + timedelta(days=i) for i in range(days)]
    session = (start - timedelta(days=1)).isoformat()
    data = {
        "schema": 1,
        "id": menu_id,
        "start": start.isoformat(),
        "end": dates[-1].isoformat(),
        "title": "Menú de prueba",
        "notes": ["Cantidades inventadas para las pruebas."],
        "targets": {"kcal": 2500.0},
        "days": [
            {
                "date": d.isoformat(),
                "meals": [
                    {"meal": "Desayuno", "free": False, "dish_id": "D1", "dish": "Avena con yogur", "tupper": False},
                    {"meal": "Comida", "free": False, "dish_id": "L1", "dish": "Lentejas con pollo", "tupper": True,
                     "eve": ["Remojar las lentejas"] if i == 0 else []},
                    {"meal": "Cena", "free": i == 2, "dish_id": None if i == 2 else "C1",
                     "dish": "" if i == 2 else "Merluza al horno", "tupper": False,
                     **({"free_budget_kcal": 650.0} if i == 2 else {"prep": ["Precalentar el horno a 200 °C"]})},
                ],
                "totals": {"kcal": 2400.0, "protein_g": 150.0, "carbs_g": 250.0, "fat_g": 80.0, "fibre_g": 30.0},
            }
            for i, d in enumerate(dates)
        ],
        "dishes": {
            "D1": {"name": "Avena con yogur", "source": None, "batch_servings": None,
                   "steps": ["Mezclar"], "seasoning": ["canela"],
                   "ingredients": [{"food": "copos de avena", "grams": 60.0}, {"food": "yogur griego desnatado", "grams": 250.0}]},
            "L1": {"name": "Lentejas con pollo", "source": "https://example.org/lentejas", "batch_servings": days,
                   "steps": ["Guisar"], "steps_day": ["Recalentar tapado hasta que humee"],
                   "steps_batch": [{"step": "Picar la verdura", "min": 10, "where": "manos libres"},
                                   {"step": "Guisar las lentejas", "min": 40, "where": "olla exprés"}],
                   "storage": {"fridge_days": 2, "freezer": True, "note": "Congelar desde el miércoles"},
                   "seasoning": ["pimentón"],
                   "ingredients": [{"food": "lentejas, cocidas", "grams": 220.0}, {"food": "pechuga de pollo, cruda", "grams": 130.0},
                                   {"food": "zanahoria", "grams": 80.0}]},
            "C1": {"name": "Merluza al horno", "source": None, "batch_servings": None,
                   "steps": ["Hornear 15 min"], "seasoning": ["limón"],
                   "ingredients": [{"food": "merluza, cruda", "grams": 250.0}, {"food": "patata, cruda", "grams": 200.0}]},
        },
        "batch_sessions": [
            {"date": session, "dishes": ["L1"], "eve": ["Comprar lo de la lista"],
             "timeline": [{"min": 0, "until": 10, "where": "manos libres", "step": "Picar la verdura", "dish": "L1"},
                          {"min": 10, "until": 50, "where": "olla exprés", "step": "Guisar las lentejas", "dish": "L1"}]},
        ],
        "shopping": {
            "items": [
                {"name": "lentejas, cocidas", "grams": 1100.0, "grams_two": 2200.0, "section": "Legumbres",
                 "pack": "bote de lentejas cocidas 400 g", "when": "both", "dishes": ["L1"], "batches": 1, "chain": None},
                {"name": "pechuga de pollo, cruda", "grams": 650.0, "section": "Carnicería", "pack": "filetes de pechuga",
                 "when": 1, "dishes": ["L1"]},
                {"name": "merluza, cruda", "grams": 1000.0, "section": "Pescadería", "pack": "lomos de merluza congelados",
                 "when": [1, 2]},
            ],
            "note": "Cantidades para una persona.",
            "batches": [{"dish": "Lentejas con pollo", "servings": days, "dates": [d.isoformat() for d in dates], "left_over": 0}],
        },
    }
    data.update(extra)
    return data


def schema1_bytes(**kwargs) -> bytes:
    return json.dumps(schema1(**kwargs), ensure_ascii=False).encode("utf-8")


COACH_YAML = """saved_on: 2026-11-01
targets:
  kcal: 2500
days:
- date: 2026-11-09
  meals:
  - meal: breakfast
    dishes:
    - dish: Avena con yogur
      items: [copos de avena=60, yogur griego desnatado=250]
  - meal: lunch
    tupper: true
    dishes:
    - dish: Lentejas con pollo
      servings: 2
      steps: [Guisar]
      items: ["lentejas, cocidas=220", "pechuga de pollo, cruda=130"]
  totals: {kcal: 1200}
  ok: true
- date: 2026-11-10
  meals:
  - meal: breakfast
    dishes:
    - dish: Tostada con tomate
      items: [pan integral=80, tomate=100]
  - meal: lunch
    tupper: true
    dishes:
    - dish: Lentejas con pollo
      servings: 2
      steps: [Guisar]
      items: ["lentejas, cocidas=220", "pechuga de pollo, cruda=130"]
"""
