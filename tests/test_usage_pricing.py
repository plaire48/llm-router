from datetime import date

from llm_router.usage.pricing import estimate_api_cost, price_for_model


def test_openai_sol_api_equivalent_cost():
    estimated = estimate_api_cost("openai", "gpt-5.6-sol", 1_000_000, 1_000_000)
    assert estimated["estimated_usd"] == 35.0
    assert estimated["input_usd_per_million"] == 5.0
    assert estimated["output_usd_per_million"] == 30.0


def test_openai_family_variant_is_not_mistaken_for_base_model():
    assert price_for_model("openai", "gpt-5.4-mini") is None


def test_claude_sonnet_5_introductory_price_expires_safely():
    assert price_for_model("anthropic", "claude-sonnet-5", today=date(2026, 8, 31))
    assert price_for_model("anthropic", "claude-sonnet-5", today=date(2026, 9, 1)) is None


def test_unknown_internal_model_has_no_estimated_cost():
    estimated = estimate_api_cost("fabrix", "019a-model-id", 1000, 500)
    assert estimated["estimated_usd"] is None
    assert estimated["pricing_source"] is None
