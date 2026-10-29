"""El motor vendorizado (`coach`) es importable desde Django y encuentra sus datos."""


def test_engine_modules_import():
    from coach import energy, knowledge, safety  # noqa: F401


def test_knowledge_dir_and_rule_files():
    from coach import knowledge

    assert knowledge.KNOWLEDGE_DIR.is_dir()
    assert len(knowledge.rule_files()) == 4


def test_foods_base_csv_exists():
    from coach import foods

    assert (foods.ROOT / "foods" / "base.csv").is_file()


def test_unanswered_parq_requires_review_before_vigorous():
    from coach import profile, safety

    flags = safety.flags(profile.Profile())
    assert flags.review_before_vigorous is True
