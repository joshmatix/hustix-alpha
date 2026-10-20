from engine.distribution import run_distribution


def test_var_99_is_the_deeper_tail():
    result = run_distribution(100_000, 400, 1, "normal", 0)
    metrics = result["metrics"]
    assert metrics["p1"] <= metrics["p5"]
    assert metrics["var_99"] == result["starting_value"] - metrics["p1"]
    assert metrics["var_99"] >= metrics["var_95"]
