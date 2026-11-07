"""Local Parquet inputs and reproducible analysis exports."""

import json
from datetime import date
from decimal import Decimal
from pathlib import Path

import duckdb


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "processed_data"
ON_FLOOR = "active IS TRUE AND NULLIF(TRIM(location_id), '') IS NOT NULL"


def connect(*tables):
    connection = duckdb.connect()
    for table in tables:
        path, = (ROOT / "data").rglob(f"{table}.parquet")
        connection.read_parquet(str(path)).create_view(table)
    return connection


def records(connection, query, parameters=None):
    result = connection.execute(query, parameters)
    columns = [column[0] for column in result.description]
    return [dict(zip(columns, row)) for row in result.fetchall()]


def parquet(connection, name, query):
    OUTPUT.mkdir(exist_ok=True)
    connection.sql(query).write_parquet(str(OUTPUT / f"{name}.parquet"))


def json_default(value):
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    raise TypeError(f"Unsupported JSON value: {type(value)}")


def write_json(name, value):
    OUTPUT.mkdir(exist_ok=True)
    (OUTPUT / f"{name}.json").write_text(
        json.dumps(value, default=json_default, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
