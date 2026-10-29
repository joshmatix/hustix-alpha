from routers.portfolios import _normalize_allocation


def test_normalize_allocation_none_when_missing():
    assert _normalize_allocation(None) is None
    assert _normalize_allocation({}) is None
    assert _normalize_allocation("bad") is None


def test_normalize_allocation_none_when_all_zero():
    assert _normalize_allocation({"equities": 0, "bonds": 0, "realAssets": 0, "cash": 0}) is None


def test_normalize_allocation_parses_buckets():
    result = _normalize_allocation({"equities": 25, "bonds": 25, "realAssets": 25, "cash": 25})
    assert result == {"equities": 25.0, "bonds": 25.0, "realAssets": 25.0, "cash": 25.0}
