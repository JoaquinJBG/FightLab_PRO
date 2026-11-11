"""Proveedor falso de productos de la cadena para las pruebas (el real es de la F13)."""

CALLS: list[tuple[str, float]] = []


def chain_product(user, food_key: str, grams: float) -> dict | None:
    CALLS.append((food_key, grams))
    if food_key == "lentils, cooked":
        return {"chain": "Súper", "product": "Lentejas cocidas Marca", "pack": "bote 400 g", "pack_grams": 400.0,
                "packs": 3, "section": "Conservas", "rating": "bueno", "review": False, "price": 2.85,
                "price_per_kg": 2.37}
    if food_key == "hake, raw":
        return {"chain": "Súper", "product": "Merluza", "pack": None, "pack_grams": None, "packs": 1,
                "section": None, "rating": "raro", "review": 1, "price": None, "price_per_kg": 9.5}
    return None
