"""Valoración de un producto del súper (fase 13): Nutri-Score 2023 + semáforo FSA del Reino Unido.

Es la lógica de `puntuacion.md` del Entrenador IA, sin sus datos: aquí no hay ningún producto. Se
aplica igual a los productos de cadena que importa cada usuario (`ChainProduct`) y a los de Open
Food Facts del proxy de F8 (`CatalogueProduct`).

1. **Nutri-Score de A a E**: el que da el archivo o Open Food Facts (algoritmo de 2023, calculado
   por OFF). FightLab no lo recalcula: le faltan la fruta y verdura y la categoría exacta.
2. **Semáforo** de azúcar, grasa saturada, sal y grasa con los límites de la etiqueta frontal del
   Reino Unido (`FSA_2016`), por 100 g en alimentos y por 100 ml en bebidas.
3. **Valoración** (convención de FightLab sobre esas dos escalas):
   - `bueno`: Nutri-Score A o B y ningún rojo en azúcar, saturada ni sal. Sin Nutri-Score, solo
     si se conocen los tres y ninguno está en rojo.
   - `evitar`: Nutri-Score D o E, rojo en azúcar o en saturada, o dos rojos.
   - `regular`: lo demás (Nutri-Score C, solo la sal en rojo, fruta en almíbar...).
   - `sin datos`: sin Nutri-Score y falta el azúcar, la saturada o la sal.
   - `no aplica`: alcohol, refrescos, café e infusiones, comida infantil, chuches, edulcorantes
     y condimentos: no son comida para el plan.
4. Excepciones: aceites, frutos secos y semillas se valoran solo por el Nutri-Score (su grasa es
   sobre todo insaturada y el Nutri-Score de 2023 los trata aparte), y el azúcar de la fruta
   fresca o desecada no cuenta, salvo que el nombre diga azúcar, almíbar, chocolate o miel.
5. `check = "revisar"` (salvo en los `no aplica`) si las kcal se apartan más de un 15 % de 4P + 4C + 9G + 2·fibra (factores
   del Reglamento UE 1169/2011; el margen es convención). No cambia la valoración: avisa.

Cada umbral lleva su fuente en `THRESHOLDS` (`fsa_2016`, `nutriscore_2023`, `eu_1169_2011`) o la
etiqueta `convention`. La regla con sus fuentes está en el anexo de evidencia
(`knowledge_fightlab/food-products.md`, `RATING_RULE`).
"""
from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field

from .keys import rule_key

RATING_VERSION = 1  # súbelo si cambia la lógica: los productos guardados se recalculan al leerlos

GOOD, FAIR, AVOID, NO_DATA, NOT_FOOD = "bueno", "regular", "evitar", "sin datos", "no aplica"
RATINGS = (GOOD, FAIR, AVOID, NO_DATA, NOT_FOOD)
RATING_ORDER = {GOOD: 0, FAIR: 1, NO_DATA: 2, AVOID: 3, NOT_FOOD: 4}
REVIEW = "revisar"

ANNEX_FILE = "food-products.md"
RATING_RULE = rule_key(ANNEX_FILE, "Rate packaged products with Nutri-Score and UK traffic lights")
FATS_RULE = rule_key(ANNEX_FILE, "Rate oils, nuts and seeds by Nutri-Score alone")
ENERGY_RULE = rule_key(ANNEX_FILE, "Flag labels whose energy does not match the macros")

# Fuentes (ids estables que la app traduce; las referencias completas están en el anexo).
FSA = "fsa_2016"  # DH/FSA 2016, guía de la etiqueta frontal (front-of-pack) del Reino Unido
NUTRISCORE = "nutriscore_2023"  # Santé publique France, algoritmo actualizado (2023)
EU_LABEL = "eu_1169_2011"  # Reglamento (UE) 1169/2011, anexo XIV: factores de conversión
CONVENTION = "convention"

# FSA 2016: (verde hasta, rojo por encima de), por 100 g en alimentos y por 100 ml en bebidas.
FOOD_LIMITS = {"fat": (3, 17.5), "saturates": (1.5, 5), "sugars": (5, 22.5), "salt": (0.3, 1.5)}
DRINK_LIMITS = {"fat": (1.5, 8.75), "saturates": (0.75, 2.5), "sugars": (2.5, 11.25), "salt": (0.3, 0.75)}
# Factores de energía del anexo XIV del Reglamento 1169/2011 (kcal por gramo).
KCAL_PER_G = {"protein_g": 4, "carbs_g": 4, "fat_g": 9, "fibre_g": 2}
# convention (FightLab, como `notas.md` del Entrenador IA): margen de la comprobación de energía y
# diferencia mínima en kcal que se da por buena aunque pase del 15 % (valores muy bajos).
ENERGY_TOLERANCE = 0.15
ENERGY_SLACK_KCAL = 8

THRESHOLDS = [
    *({"key": f"food.{k}.high", "value": hi, "unit": "g/100 g", "source": FSA} for k, (_, hi) in FOOD_LIMITS.items()),
    *({"key": f"food.{k}.low", "value": lo, "unit": "g/100 g", "source": FSA} for k, (lo, _) in FOOD_LIMITS.items()),
    *({"key": f"drink.{k}.high", "value": hi, "unit": "g/100 ml", "source": FSA} for k, (_, hi) in DRINK_LIMITS.items()),
    *({"key": f"drink.{k}.low", "value": lo, "unit": "g/100 ml", "source": FSA} for k, (lo, _) in DRINK_LIMITS.items()),
    {"key": "nutriscore.good", "value": "A-B", "unit": "", "source": NUTRISCORE},
    {"key": "nutriscore.avoid", "value": "D-E", "unit": "", "source": NUTRISCORE},
    {"key": "fats.nutriscore_only", "value": "", "unit": "", "source": NUTRISCORE},
    {"key": "energy.factors", "value": "4/4/9/2", "unit": "kcal/g", "source": EU_LABEL},
    {"key": "energy.tolerance", "value": ENERGY_TOLERANCE, "unit": "", "source": CONVENTION},
    {"key": "rating.combination", "value": "", "unit": "", "source": CONVENTION},
    {"key": "fruit.sugar_ignored", "value": "", "unit": "", "source": CONVENTION},
    {"key": "not_food.categories", "value": "", "unit": "", "source": CONVENTION},
]

# Palabras (sin tildes) que hacen de un producto una bebida, como en `score_all.py`.
DRINK_WORDS = ("bebida", "agua", "refresco", "zumo", "nectar", "batido", "leche", "kefir", "cerveza",
               "vino", "sidra", "licor", "cafe", "infusion", "isotonic", "energetica", "smoothie",
               "horchata", "gazpacho", "salmorejo")
ALCOHOL_WORDS = ("cerveza", "vino", "sidra", "licor", "ginebra", "ron ", "whisky", "vodka", "vermut",
                 "cava", "sangria", "tinto de verano", "brandy", "anis")
BABY_WORDS = ("peques", "meses", "infantil", "crecimiento", "bebe")
# convention (FightLab): categorías que no son comida para un plan. Son las del buscador
# nutricional de la cadena, sin tildes; se comparan con la categoría del archivo.
NOT_FOOD_CATEGORIES = {
    "agua sin gas", "cafe molido", "cafe soluble", "capsulas compatibles dolce gusto",
    "capsulas compatibles nespresso", "monodosis", "infusiones", "te", "tonica y bitter",
    "cola clasica", "cola zero", "gaseosa", "lima limon", "naranja", "limon",
    "otros refrescos sin gas", "energetico", "isotonico", "licores sin alcohol", "cocktails",
    "leche infantil", "papillas", "tarritos de fruta", "tarritos salados",
    "yogures y postres infantiles", "tartas infantiles", "edulcorante y otros", "chicles",
    "caramelos", "golosinas", "otras especias", "pimienta", "hierbas aromaticas", "sazonadores",
    "caldo en pastillas", "levadura y preparado reposteria", "vinagre y otros aderezos",
    "cerveza botella y botellin", "cerveza lata", "combinado de cerveza", "ginebra", "ron",
    "whisky", "sidra", "vino blanco de mesa", "vinos dulces y mosto", "tinto de verano y sangria",
    "otros licores", "cremas",
}
# Etiquetas de categoría de Open Food Facts que equivalen a lo anterior.
NOT_FOOD_OFF_TAGS = ("en:alcoholic-beverages", "en:sodas", "en:coffees", "en:teas", "en:herbal-teas",
                     "en:baby-foods", "en:sweeteners", "en:candies", "en:chewing-gum", "en:condiments",
                     "en:spices", "en:energy-drinks")
FAT_CATEGORIES = {"aceite de oliva", "otros aceites", "frutos secos"}
FAT_OFF_TAGS = ("en:vegetable-oils", "en:olive-oils", "en:nuts", "en:seeds", "en:nut-butters")
# Sin categoría (el `mercadona.csv` corto), por el nombre.
FAT_NAME_WORDS = ("aceite", "almendra", "nuez", "nueces", "cacahuete", "pistacho", "anacardo", "avellana",
                  "semillas", "pipas", "chia", "lino", "crema de cacahuete")
FRUIT_CATEGORIES = {"fruta", "fruta desecada"}
FRUIT_OFF_TAGS = ("en:fruits", "en:dried-fruits")
FRUIT_NAME_WORDS = ("datil", "pasas", "orejon", "ciruela pasa", "higo seco")
ADDED_SUGAR_WORDS = ("azucar", "almibar", "caramel", "chocolate", "confitad", "miel")


def fold(text: str | None) -> str:
    text = unicodedata.normalize("NFD", (text or "").lower())
    return " ".join("".join(c for c in text if not unicodedata.combining(c)).split())


@dataclass
class Inputs:
    """Lo que hace falta para valorar. Un valor `None` es "sin dato", nunca cero."""

    name: str
    kcal: float | None = None
    protein_g: float | None = None
    carbs_g: float | None = None
    fat_g: float | None = None
    fibre_g: float | None = None
    saturates_g: float | None = None
    sugars_g: float | None = None
    salt_g: float | None = None
    nutriscore: str = ""  # A..E o vacío
    category: str = ""  # la categoría del archivo (buscador de la cadena)
    off_tags: tuple[str, ...] = ()  # `categories_tags` de OFF
    drink: bool | None = None  # None: se deduce del nombre y la categoría


@dataclass
class Rating:
    rating: str
    check: str  # "ok", "revisar" o "" (faltan macros para comprobarlo)
    nutriscore: str
    drink: bool
    lights: dict[str, str]  # sugars/saturates/salt/fat -> green/amber/red o ""
    reasons: list[dict] = field(default_factory=list)  # [{code, params}], la app los traduce
    rule_key: str = RATING_RULE

    def as_dict(self) -> dict:
        return {"rating": self.rating, "check": self.check, "nutriscore": self.nutriscore or None,
                "drink": self.drink, "lights": self.lights, "reasons": self.reasons, "rule_key": self.rule_key}


def light(value: float | None, limits: tuple[float, float]) -> str:
    if value is None:
        return ""
    low, high = limits
    return "green" if value <= low else ("red" if value > high else "amber")


def is_drink(inputs: Inputs) -> bool:
    if inputs.drink is not None:
        return inputs.drink
    if "en:beverages" in inputs.off_tags:
        return True
    text = f" {fold(inputs.name)} {fold(inputs.category)} "
    return any(w in text for w in DRINK_WORDS) and "en polvo" not in text


def energy_check(i: Inputs) -> str:
    """`ok`, `revisar` o vacío si faltan kcal, proteína, hidratos o grasa."""
    if None in (i.kcal, i.protein_g, i.carbs_g, i.fat_g) or not i.kcal:
        return ""
    est = sum(KCAL_PER_G[n] * (getattr(i, n) or 0) for n in KCAL_PER_G)
    gap = abs(est - i.kcal)
    return "ok" if gap <= ENERGY_TOLERANCE * max(i.kcal, est) or gap < ENERGY_SLACK_KCAL else REVIEW


def _kind(i: Inputs) -> tuple[bool, bool]:
    """(aceite/fruto seco/semilla, fruta) por categoría del archivo, de OFF o por el nombre."""
    cat, name = fold(i.category), fold(i.name)
    if cat:
        fat, fruit = cat in FAT_CATEGORIES, cat in FRUIT_CATEGORIES
    elif i.off_tags:
        fat = any(t in i.off_tags for t in FAT_OFF_TAGS)
        fruit = any(t in i.off_tags for t in FRUIT_OFF_TAGS)
    else:
        words = f" {name} "
        fat = any(f" {w}" in words for w in FAT_NAME_WORDS)
        fruit = any(f" {w}" in words for w in FRUIT_NAME_WORDS)
    return fat, fruit


def _not_food(i: Inputs) -> str | None:
    text = f" {fold(i.name)} {fold(i.category)} "
    if any(w in text for w in ALCOHOL_WORDS) or "en:alcoholic-beverages" in i.off_tags:
        return "alcohol"
    if any(w in fold(i.name) for w in BABY_WORDS) or "en:baby-foods" in i.off_tags:
        return "baby_food"
    if fold(i.category) in NOT_FOOD_CATEGORIES or any(t in i.off_tags for t in NOT_FOOD_OFF_TAGS):
        return "not_for_plan"
    return None


def rate(i: Inputs) -> Rating:
    grade = (i.nutriscore or "").strip().upper()
    grade = grade if grade in ("A", "B", "C", "D", "E") else ""
    drink = is_drink(i)
    limits = DRINK_LIMITS if drink else FOOD_LIMITS
    lights = {
        "sugars": light(i.sugars_g, limits["sugars"]),
        "saturates": light(i.saturates_g, limits["saturates"]),
        "salt": light(i.salt_g, limits["salt"]),
        "fat": light(i.fat_g, limits["fat"]),
    }
    check = energy_check(i)
    fat_kind, fruit = _kind(i)
    reds = [k for k in ("sugars", "saturates", "salt") if lights[k] == "red"]
    reasons: list[dict] = []
    rule = RATING_RULE
    if fat_kind and "saturates" in reds:
        reds.remove("saturates")
    if fat_kind:
        reasons.append({"code": "fats_nutriscore_only", "params": {}})
        rule = FATS_RULE
    if fruit and "sugars" in reds and not any(w in fold(i.name) for w in ADDED_SUGAR_WORDS):
        reds.remove("sugars")
        reasons.append({"code": "fruit_sugar", "params": {}})
    complete = i.sugars_g is not None and i.salt_g is not None and (i.saturates_g is not None or fat_kind)

    not_food = _not_food(i)
    if not_food:
        verdict = NOT_FOOD
        reasons = [{"code": not_food, "params": {}}]
        check = ""  # no entra en el plan; y el alcohol (7 kcal/g) descuadra la cuenta a propósito
    elif grade in ("D", "E") or "sugars" in reds or "saturates" in reds or len(reds) >= 2:
        verdict = AVOID
    elif not grade and (not complete or fat_kind or fruit):
        verdict = NO_DATA
        reasons.append({"code": "no_data", "params": {}})
    elif "almibar" in fold(i.name):
        verdict = FAIR
        reasons.append({"code": "syrup", "params": {}})
    elif grade in ("A", "B", "") and not reds:
        verdict = GOOD
    else:
        verdict = FAIR
    if grade and verdict != NOT_FOOD:
        reasons.append({"code": "nutriscore", "params": {"grade": grade}})
    if verdict != NOT_FOOD:
        reasons += [{"code": f"high_{k}", "params": {}} for k in reds]
    if check == REVIEW:
        reasons.append({"code": "energy_mismatch", "params": {}})
    return Rating(verdict, check, grade, drink, lights, reasons, rule)


def normalise_file_rating(text: str | None) -> str:
    """La valoración que trae el archivo, en el vocabulario del motor (o vacío)."""
    value = fold(text)
    aliases = {"sin dato": NO_DATA, "no aplicable": NOT_FOOD, "n/a": NOT_FOOD}
    value = aliases.get(value, value)
    return value if value in RATINGS else ""
