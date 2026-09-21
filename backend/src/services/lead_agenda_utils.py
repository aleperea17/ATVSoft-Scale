"""Predicado único: una cuota automática de plazo no cuenta como agenda."""

from __future__ import annotations

from typing import Any

PLAZO_PAGADO_STATUS = "PLAZO PAGADO"


def lead_is_cuota_plazo(row: Any) -> bool:
    return bool(getattr(row, "es_cuota_plazo", False))


def lead_counts_as_agenda(row: Any) -> bool:
    """False si es cuota de plazo; si no, hay `agendo` (mismo criterio histórico de metrics/BIO)."""
    if lead_is_cuota_plazo(row):
        return False
    return getattr(row, "agendo", None) is not None
