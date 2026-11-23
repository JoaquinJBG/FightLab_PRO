"""Motor de valoración de productos (fase 13): Nutri-Score + semáforo FSA, con productos inventados."""
import pytest

from coaching import product_rating as pr
from coaching.product_rating import Inputs, rate


def food(**kw):
    base = {"name": "Producto inventado", "kcal": 100, "protein_g": 10, "carbs_g": 10, "fat_g": 2,
            "saturates_g": 0.5, "sugars_g": 2, "salt_g": 0.2}
    return Inputs(**{**base, **kw})


def codes(r):
    return [x["code"] for x in r.reasons]


def test_good_with_nutriscore_a_and_no_reds():
    r = rate(food(nutriscore="a"))
    assert r.rating == pr.GOOD and r.nutriscore == "A"
    assert r.lights == {"sugars": "green", "saturates": "green", "salt": "green", "fat": "green"}
    assert r.check == "ok"


@pytest.mark.parametrize("grade", ["D", "E"])
def test_nutriscore_d_or_e_is_avoid(grade):
    assert rate(food(nutriscore=grade)).rating == pr.AVOID


def test_red_sugar_or_saturates_is_avoid_but_salt_alone_is_fair():
    assert rate(food(nutriscore="B", sugars_g=23)).rating == pr.AVOID
    assert rate(food(nutriscore="B", saturates_g=5.1, fat_g=10)).rating == pr.AVOID
    salty = rate(food(nutriscore="B", salt_g=1.6))
    assert salty.rating == pr.FAIR and "high_salt" in codes(salty)


def test_fsa_limits_are_strictly_above_the_threshold():
    assert rate(food(sugars_g=22.5)).lights["sugars"] == "amber"
    assert rate(food(sugars_g=5)).lights["sugars"] == "green"
    assert rate(food(salt_g=1.5)).lights["salt"] == "amber"


def test_nutriscore_c_is_fair():
    assert rate(food(nutriscore="C")).rating == pr.FAIR


def test_without_nutriscore_good_only_with_the_three_values():
    assert rate(food()).rating == pr.GOOD
    missing = rate(food(saturates_g=None))
    assert missing.rating == pr.NO_DATA and "no_data" in codes(missing)


def test_drinks_use_lower_limits():
    drink = rate(food(name="Bebida inventada de avena", sugars_g=12, kcal=55, protein_g=1, carbs_g=12, fat_g=0.5))
    assert drink.drink and drink.lights["sugars"] == "red" and drink.rating == pr.AVOID
    solid = rate(food(name="Galleta inventada", sugars_g=12))
    assert not solid.drink and solid.lights["sugars"] == "amber"
    assert rate(food(name="Algo", drink=True, salt_g=0.8)).lights["salt"] == "red"


def test_oils_nuts_and_seeds_only_count_nutriscore():
    oil = rate(food(name="Aceite inventado", category="Aceite de oliva", kcal=820, protein_g=0, carbs_g=0, fat_g=91,
                    saturates_g=14, nutriscore="B"))
    assert oil.rating == pr.GOOD
    assert "fats_nutriscore_only" in codes(oil) and oil.rule_key == pr.FATS_RULE
    # Sin categoría, por el nombre; y sin Nutri-Score, sin datos.
    nuts = rate(food(name="Almendra natural inventada", kcal=600, protein_g=21, carbs_g=6, fat_g=53, saturates_g=4))
    assert nuts.rating == pr.NO_DATA


def test_fruit_sugar_does_not_count_unless_added():
    dried = rate(food(name="Uvas pasas inventadas", category="Fruta desecada", sugars_g=60, kcal=300,
                      protein_g=3, carbs_g=70, fat_g=0.5, nutriscore="C"))
    assert dried.rating == pr.FAIR and "fruit_sugar" in codes(dried)
    candied = rate(food(name="Fruta con chocolate inventada", category="Fruta desecada", sugars_g=60, nutriscore="C"))
    assert candied.rating == pr.AVOID


def test_fruit_in_syrup_is_fair():
    r = rate(food(name="Melocotón en almíbar inventado", sugars_g=15, nutriscore="B"))
    assert r.rating == pr.FAIR and "syrup" in codes(r)


@pytest.mark.parametrize("kw, code", [
    ({"name": "Cerveza inventada"}, "alcohol"),
    ({"name": "Papilla inventada 6 meses"}, "baby_food"),
    ({"name": "Té inventado", "category": "Infusiones"}, "not_for_plan"),
    ({"name": "Producto OFF", "off_tags": ("en:sodas",)}, "not_for_plan"),
])
def test_not_food(kw, code):
    r = rate(food(**kw))
    assert r.rating == pr.NOT_FOOD and codes(r) == [code]


def test_energy_check_flags_labels_off_by_more_than_15_percent():
    assert rate(food(kcal=98)).check == "ok"  # 4·10 + 4·10 + 9·2 = 98
    assert rate(food(kcal=130)).check == pr.REVIEW
    assert "energy_mismatch" in codes(rate(food(kcal=130)))
    assert rate(food(kcal=112)).check == "ok"  # 14 kcal, dentro del 15 %
    assert rate(food(kcal=5, protein_g=0, carbs_g=0, fat_g=0)).check == "ok"  # menos de 8 kcal
    assert rate(food(protein_g=None)).check == ""
    # La fibra cuenta 2 kcal/g.
    assert rate(food(kcal=160, fibre_g=30)).check == "ok"


def test_every_threshold_names_its_source():
    allowed = {pr.FSA, pr.NUTRISCORE, pr.EU_LABEL, pr.CONVENTION}
    assert {t["source"] for t in pr.THRESHOLDS} <= allowed
    highs = {t["key"]: t["value"] for t in pr.THRESHOLDS if t["key"].endswith(".high")}
    assert highs["food.sugars.high"] == 22.5 and highs["food.saturates.high"] == 5 and highs["food.salt.high"] == 1.5
    assert highs["drink.sugars.high"] == 11.25


def test_file_ratings_are_normalised():
    assert pr.normalise_file_rating("Bueno") == pr.GOOD
    assert pr.normalise_file_rating("sin datos") == pr.NO_DATA
    assert pr.normalise_file_rating("No aplica") == pr.NOT_FOOD
    assert pr.normalise_file_rating("otra cosa") == ""
