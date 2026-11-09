"""Perfil de cocina (fase 12): el menaje y los comensales que rellena el usuario.

Nada de esto va escrito en el código para una persona: el menaje (`KitchenProfile.equipment`) y
los comensales con sus restricciones por comida (`Diner`) los guarda cada usuario.

- **Menaje** (`EQUIPMENT`): ollas, ollas exprés, wok, sartenes, air fryer (con su modelo en texto
  libre), horno, microondas y fuegos grandes y pequeños. `capacity` dice cuántos pasos de cada
  aparato pueden ir a la vez en una sesión de batch (`coaching.batch`).
- **Comensales**: cada uno con restricciones por comida, p. ej. "cena sin pescado salvo gambas"
  = `{"meals": ["dinner"], "exclude": ["pescado"], "allow": ["gambas"]}`. `diner_flags` marca los
  platos que chocan y bloquean el día, como una alergia en `mealplan.taste_flags`.

Las restricciones se comparan por nombre con `coach.tastes.matches` (palabras enteras, sin
sinónimos). Como el motor no sabe qué alimentos son pescado o carne, `CATEGORIES` amplía unas pocas
palabras de categoría a los alimentos que nombran. convention (FightLab): esa lista es una ayuda de
la app, no un dato de nutrición, y no es completa: lo que no nombra no se marca.
"""
from __future__ import annotations

from coach.tastes import matches
from coach.text import fold
from django.db import transaction

from .models import Diner, KitchenProfile

MEALS = ("breakfast", "lunch", "dinner", "snack")

# Clave → (tipo, mínimo, máximo). Los enteros son cuántos hay; los booleanos, si hay.
EQUIPMENT = {
    "pots": ("int", 0, 10),
    "pressure_cookers": ("int", 0, 4),
    "wok": ("bool",),
    "frying_pans": ("int", 0, 10),
    "air_fryer": ("bool",),
    "air_fryer_model": ("text", 0, 80),
    "oven": ("bool",),
    "microwave": ("bool",),
    "burners_large": ("int", 0, 8),
    "burners_small": ("int", 0, 8),
}
# Los aparatos de un paso del cronograma (`where`). `hands` es trabajo sin aparato (picar,
# repartir, etiquetar): una persona, un paso a la vez.
APPLIANCES = ("pressure_cooker", "pot", "wok", "frying_pan", "air_fryer", "oven", "microwave", "hands")
HOB = ("pressure_cooker", "pot", "wok", "frying_pan")  # van en un fuego
# Cómo se escribe cada aparato en los menús importados (en minúsculas y sin tildes).
ALIASES = {
    "pressure_cooker": ("olla expres", "olla a presion", "pressure cooker", "olla rapida", "expres"),
    "pot": ("olla", "cazuela", "cacerola", "pot", "saucepan", "fuego", "fuegos", "hob", "stove", "vitro", "vitroceramica", "induccion"),
    "wok": ("wok",),
    "frying_pan": ("sarten", "plancha", "frying pan", "pan", "skillet"),
    "air_fryer": ("air fryer", "airfryer", "freidora de aire", "freidora"),
    "oven": ("horno", "oven"),
    "microwave": ("microondas", "microwave"),
    "hands": ("manos libres", "manos", "encimera", "tabla", "hands", "prep", "nevera", "fridge", "congelador", "freezer"),
}
MAX_DINERS = 8
MAX_RESTRICTIONS = 10
MAX_WORDS = 10
WORD_MAX = 60
NAME_MAX = Diner._meta.get_field("name").max_length

# convention (FightLab): palabras de categoría y los alimentos que nombran, en es y en.
CATEGORIES = {
    "pescado": (
        "merluza", "lubina", "dorada", "bacalao", "atun", "bonito", "salmon", "sardina", "boqueron",
        "caballa", "trucha", "rape", "emperador", "pez espada", "lenguado", "rodaballo", "abadejo",
        "panga", "perca", "palometa", "jurel", "mero", "pescado", "pescadilla", "anchoa",
        "hake", "sea bass", "sea bream", "cod", "tuna", "salmon", "sardine", "anchovy", "mackerel",
        "trout", "monkfish", "swordfish", "sole", "haddock", "pollock", "fish",
    ),
    "marisco": (
        "gamba", "langostino", "mejillon", "almeja", "calamar", "sepia", "choco", "pulpo", "cangrejo",
        "berberecho", "vieira", "chipiron", "marisco", "cigala", "bogavante",
        "prawn", "shrimp", "mussel", "clam", "squid", "cuttlefish", "octopus", "crab", "scallop", "shellfish",
    ),
    "carne": (
        "pollo", "pavo", "ternera", "cerdo", "cordero", "conejo", "vaca", "buey", "carne", "jamon",
        "lomo", "chorizo", "salchicha", "hamburguesa", "contramuslo", "bacon", "beicon", "panceta",
        "chicken", "turkey", "beef", "pork", "lamb", "rabbit", "meat", "ham", "sausage", "burger",
    ),
    "cerdo": (
        "cerdo", "jamon", "lomo", "chorizo", "bacon", "beicon", "panceta", "salchichon", "morcilla",
        "carrillera", "pork", "ham", "bacon", "chorizo",
    ),
    "lacteos": (
        "leche", "yogur", "queso", "nata", "mantequilla", "kefir", "requeson", "cottage",
        "milk", "yoghurt", "yogurt", "cheese", "cream", "butter", "dairy",
    ),
}
CATEGORY_NAMES = {
    "pescado": "pescado", "pescados": "pescado", "fish": "pescado",
    "marisco": "marisco", "mariscos": "marisco", "shellfish": "marisco", "seafood": "marisco",
    "carne": "carne", "carnes": "carne", "meat": "carne",
    "cerdo": "cerdo", "pork": "cerdo",
    "lacteos": "lacteos", "lacteo": "lacteos", "dairy": "lacteos",
}


class KitchenInvalid(ValueError):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(code)
        self.code = code
        self.detail = detail


# ---------------------------------------------------------------- menaje


def equipment_of(profile) -> dict:
    row = KitchenProfile.objects.filter(profile=profile).first()
    return dict(row.equipment) if row else {}


def clean_equipment(values: dict) -> dict:
    if not isinstance(values, dict):
        raise KitchenInvalid("kitchen_invalid", "equipment")
    out = {}
    for name, value in values.items():
        spec = EQUIPMENT.get(name)
        if spec is None:
            raise KitchenInvalid("kitchen_invalid", name)
        kind = spec[0]
        if kind == "bool" and isinstance(value, bool):
            out[name] = value
        elif kind == "int" and isinstance(value, int) and not isinstance(value, bool) and spec[1] <= value <= spec[2]:
            out[name] = value
        elif kind == "text" and isinstance(value, str) and len(value.strip()) <= spec[2]:
            out[name] = " ".join(value.split())
        else:
            raise KitchenInvalid("kitchen_invalid", name)
    return out


def capacity(equipment: dict) -> dict[str, int]:
    """Cuántos pasos de cada aparato pueden ir a la vez. Un menaje vacío no limita nada (no se
    ha rellenado). Los de fuego comparten además los fuegos (`burners`)."""
    e = equipment
    return {
        "pressure_cooker": e.get("pressure_cookers", 0),
        "pot": e.get("pots", 0),
        "wok": 1 if e.get("wok") else 0,
        "frying_pan": e.get("frying_pans", 0),
        "air_fryer": 1 if e.get("air_fryer") else 0,
        "oven": 1 if e.get("oven") else 0,
        "microwave": 1 if e.get("microwave") else 0,
        "hands": 1,
        "burners": e.get("burners_large", 0) + e.get("burners_small", 0),
    }


def owned(equipment: dict) -> set[str]:
    cap = capacity(equipment)
    has = {a for a in APPLIANCES if cap[a] > 0}
    if cap["burners"] == 0:
        has -= set(HOB)
    return has


def appliance(text) -> str | None:
    """`where` de un menú importado → aparato de `APPLIANCES`, o `None` si no se reconoce."""
    if not isinstance(text, str):
        return None
    key = fold(text).strip()
    if key in APPLIANCES:
        return key
    for name, words in ALIASES.items():
        if key in words:
            return name
    for name, words in ALIASES.items():  # "fuego 1", "horno a 200 °C": por la primera palabra
        if any(key.startswith(w + " ") for w in words):
            return name
    return None


# ---------------------------------------------------------------- comensales


def _words(value, where: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > MAX_WORDS:
        raise KitchenInvalid("diners_invalid", where)
    out = []
    for word in value:
        if not isinstance(word, str) or not word.strip() or len(word) > WORD_MAX:
            raise KitchenInvalid("diners_invalid", where)
        out.append(" ".join(word.split()))
    return list(dict.fromkeys(out))


def clean_diners(values) -> list[dict]:
    if not isinstance(values, list) or len(values) > MAX_DINERS:
        raise KitchenInvalid("diners_invalid", "diners")
    out = []
    for diner in values:
        if not isinstance(diner, dict):
            raise KitchenInvalid("diners_invalid", "diner")
        name = " ".join(str(diner.get("name") or "").split())
        if not name or len(name) > NAME_MAX:
            raise KitchenInvalid("diners_invalid", "name")
        rules = diner.get("restrictions") or []
        if not isinstance(rules, list) or len(rules) > MAX_RESTRICTIONS:
            raise KitchenInvalid("diners_invalid", "restrictions")
        clean = []
        for rule in rules:
            if not isinstance(rule, dict):
                raise KitchenInvalid("diners_invalid", "restriction")
            meals = rule.get("meals") or []
            if not isinstance(meals, list) or set(meals) - set(MEALS):
                raise KitchenInvalid("diners_invalid", "meals")
            exclude = _words(rule.get("exclude"), "exclude")
            if not exclude:
                raise KitchenInvalid("diners_invalid", "exclude")
            clean.append({"meals": [m for m in MEALS if m in meals], "exclude": exclude, "allow": _words(rule.get("allow"), "allow")})
        out.append({"name": name, "restrictions": clean})
    return out


def diners_of(profile) -> list[dict]:
    return [{"id": d.id, "name": d.name, "restrictions": d.restrictions} for d in Diner.objects.filter(profile=profile)]


def kitchen_data(profile) -> dict:
    equipment = equipment_of(profile)
    return {
        "equipment": equipment,
        "filled": bool(equipment),
        "fields": {name: spec[0] for name, spec in EQUIPMENT.items()},
        "limits": {name: list(spec[1:]) for name, spec in EQUIPMENT.items() if spec[0] != "bool"},
        "diners": diners_of(profile),
        "meals": list(MEALS),
        "categories": sorted(CATEGORIES),
        "categories_convention": "fightlab",
    }


@transaction.atomic
def save_kitchen(profile, data: dict) -> dict:
    if not isinstance(data, dict) or set(data) - {"equipment", "diners"}:
        raise KitchenInvalid("kitchen_invalid", "body")
    if "equipment" in data:
        equipment = clean_equipment(data["equipment"])
        KitchenProfile.objects.update_or_create(profile=profile, defaults={"equipment": equipment})
    if "diners" in data:
        diners = clean_diners(data["diners"])
        Diner.objects.filter(profile=profile).delete()
        Diner.objects.bulk_create(
            Diner(profile=profile, name=d["name"], restrictions=d["restrictions"], position=i) for i, d in enumerate(diners)
        )
    return kitchen_data(profile)


# ---------------------------------------------------------------- restricciones


def expand(word: str) -> tuple[str, ...]:
    """Una palabra de restricción y, si es una categoría, los alimentos que nombra."""
    category = CATEGORY_NAMES.get(fold(word).strip())
    return (word, *CATEGORIES[category]) if category else (word,)


def restriction_hit(rule: dict, names: tuple[str, ...]) -> str | None:
    """La palabra excluida que nombra alguno de `names`, si ninguna excepción lo permite."""
    if any(matches(w, *names) for allowed in rule.get("allow") or [] for w in expand(allowed)):
        return None
    for entry in rule.get("exclude") or []:
        if any(matches(w, *names) for w in expand(entry)):
            return entry
    return None


def applies(rule: dict, meal: str) -> bool:
    return not rule.get("meals") or meal in rule["meals"]


def dish_clash(diners: list[dict], meal: str, texts: list[tuple[str, ...]]) -> dict | None:
    """El primer comensal y palabra con los que choca un plato (sus textos: nombre, condimentos e
    ingredientes en los dos idiomas)."""
    for diner in diners:
        for rule in diner["restrictions"]:
            if not applies(rule, meal):
                continue
            for names in texts:
                hit = restriction_hit(rule, names)
                if hit:
                    return {"diner": diner["name"], "entry": hit, "text": names[0]}
    return None


def diner_flags(days, diners: list[dict], table, find) -> list[dict]:
    """Cada plato de un menú (días de `mealplan.parse`) que choca con un comensal. Bloquean el día,
    como una alergia: el motor no da por bueno un plato que alguien de la mesa no come."""
    flags = []
    if not diners:
        return flags
    for day in days:
        for meal in day.meals:
            for dish in meal.dishes:
                texts = [(dish.name,), *((s,) for s in dish.seasoning)]
                for name, _ in dish.items:
                    food = find(name, table)
                    texts.append((name, food.name_en, food.name_es) if food else (name,))
                clash = dish_clash(diners, meal.name, texts)
                if clash:
                    flags.append({
                        "date": day.date, "meal": meal.name, "dish": dish.name, "kind": "diner",
                        "where": "item", "blocking": True, **clash,
                    })
    return flags
