from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime


@dataclass(frozen=True, slots=True)
class TokenPrice:
    input_per_million: float
    output_per_million: float
    source: str
    effective_until: date | None = None


OPENAI_PRICING_SOURCE = "https://developers.openai.com/api/docs/models"
ANTHROPIC_SONNET_5_SOURCE = "https://www.anthropic.com/news/claude-sonnet-5"
ANTHROPIC_PRICING_SOURCE = "https://docs.anthropic.com/en/docs/about-claude/pricing"


def _model_or_snapshot(normalized: str, model_id: str) -> bool:
    return normalized == model_id or normalized.startswith(f"{model_id}-20")


def price_for_model(provider: str, model: str, *, today: date | None = None) -> TokenPrice | None:
    normalized = model.strip().lower()
    current_date = today or datetime.now(UTC).date()

    if provider == "openai":
        if normalized == "gpt-5.6" or _model_or_snapshot(normalized, "gpt-5.6-sol"):
            return TokenPrice(5.0, 30.0, OPENAI_PRICING_SOURCE)
        if _model_or_snapshot(normalized, "gpt-5.6-terra"):
            return TokenPrice(2.5, 15.0, OPENAI_PRICING_SOURCE)
        if _model_or_snapshot(normalized, "gpt-5.6-luna"):
            return TokenPrice(1.0, 6.0, OPENAI_PRICING_SOURCE)
        if _model_or_snapshot(normalized, "gpt-5.4"):
            return TokenPrice(2.5, 15.0, OPENAI_PRICING_SOURCE)
        if _model_or_snapshot(normalized, "gpt-5"):
            return TokenPrice(1.25, 10.0, OPENAI_PRICING_SOURCE)

    if provider == "anthropic":
        if _model_or_snapshot(normalized, "claude-sonnet-5"):
            price = TokenPrice(
                2.0,
                10.0,
                ANTHROPIC_SONNET_5_SOURCE,
                effective_until=date(2026, 8, 31),
            )
            return price if current_date <= price.effective_until else None
        if "sonnet-4" in normalized or "sonnet-3-7" in normalized:
            return TokenPrice(3.0, 15.0, ANTHROPIC_PRICING_SOURCE)

    return None


def estimate_api_cost(
    provider: str,
    model: str,
    prompt_tokens: int,
    completion_tokens: int,
) -> dict[str, float | str | None]:
    price = price_for_model(provider, model)
    if price is None:
        return {
            "estimated_usd": None,
            "input_usd_per_million": None,
            "output_usd_per_million": None,
            "pricing_source": None,
        }
    estimated = (
        prompt_tokens * price.input_per_million + completion_tokens * price.output_per_million
    ) / 1_000_000
    return {
        "estimated_usd": round(estimated, 8),
        "input_usd_per_million": price.input_per_million,
        "output_usd_per_million": price.output_per_million,
        "pricing_source": price.source,
    }
