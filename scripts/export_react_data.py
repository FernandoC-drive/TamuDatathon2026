"""Export the standalone dashboard dataset for the Vite application."""

import argparse
import json
import math
import re
import runpy
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "client" / "src" / "data" / "dashboardData.json"
CONSOLE_DESTINATION = DESTINATION.with_name("consoleData.json")


def sanitize(value):
    if isinstance(value, dict):
        return {key: sanitize(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [sanitize(item) for item in value]
    if isinstance(value, date):
        return value.isoformat()[:10]
    if isinstance(value, (float, Decimal)):
        return float(value) if math.isfinite(value) else None
    return value


def export_console_data():
    from pipeline_io import connect, records

    q1 = runpy.run_path(str(ROOT / "src" / "01_q1_machine_evaluation.py"))
    with connect("floor_locations", "floor_walkways", "operations") as connection:
        for name, relative_path in q1["SOURCES"].items():
            path = ROOT / "data" / f"{relative_path}.parquet"
            connection.read_parquet(str(path)).create_view(name)
        connection.execute(q1["DAILY_SQL"])
        connection.execute(q1["PEER_SQL"])
        console = {
            "zones": records(connection, """
                SELECT zone_id, x_m, y_m FROM floor_locations
                WHERE node_type = 'zone' ORDER BY zone_id
            """),
            "walkways": records(connection, """
                SELECT walkway_id, zone_a, zone_b, length_m,
                       start_day.gaming_date AS closure_start,
                       CAST(end_day.gaming_date - 1 AS DATE) AS closure_end
                FROM floor_walkways
                LEFT JOIN calendar start_day ON closed_from_utc = start_day.gaming_day_start_utc
                LEFT JOIN calendar end_day ON closed_to_utc = end_day.gaming_day_start_utc
                ORDER BY walkway_id
            """),
            "placementPeers": records(connection, """
                SELECT machine_id, location_id, MIN(gaming_date) AS first_gaming_date,
                       ROUND(SUM(theo_usd) FILTER (WHERE zone_same_config_theo IS NOT NULL)
                             / NULLIF(SUM(zone_same_config_theo), 0), 6) AS zone_peer_index
                FROM daily_peers GROUP BY machine_id, location_id, placement_id
                ORDER BY machine_id, first_gaming_date, location_id
            """),
            "faults": records(connection, """
                SELECT machine_id, operation_id, location_id,
                       strftime(opened_at_local, '%Y-%m-%d %H:%M') AS opened_local,
                       date_diff('second', opened_at_utc, available_at_utc) AS seconds
                FROM operations WHERE event_type = 'fault_repair'
                ORDER BY machine_id, opened_at_utc, operation_id
            """),
        }
    CONSOLE_DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    CONSOLE_DESTINATION.write_text(
        json.dumps(sanitize(console), separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(f"Exported {len(console['zones'])} zone centers and {len(console['faults']):,} fault tickets.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-html", type=Path, help="Import a legacy HTML dashboard snapshot")
    parser.add_argument("--console-only", action="store_true", help="Refresh only the map and dossier data")
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT / "src"))
    if args.console_only:
        export_console_data()
        return
    if args.from_html:
        match = re.search(r"^\s*const DASHBOARD_DATA = (\{[^\r\n]*\});$", args.from_html.read_text(
            encoding="utf-8"), re.MULTILINE)
        if not match:
            parser.error("The input does not contain a legacy DASHBOARD_DATA assignment")
        data = json.loads(match[1])
    else:
        pipeline = runpy.run_path(str(ROOT / "src" / "06_build_dashboard.py"))
        data = pipeline["collect_dashboard_data"]()
    data = sanitize(data)
    if not all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", day) for day in data["dates"]):
        raise ValueError("Dashboard gaming dates must use YYYY-MM-DD")
    DESTINATION.parent.mkdir(parents=True, exist_ok=True)
    DESTINATION.write_text(json.dumps(data, separators=(",", ":"), allow_nan=False) + "\n", encoding="utf-8")
    print(f"Exported {len(data['floor']):,} machine-days and {len(data['dates'])} gaming dates.")
    if not args.from_html:
        export_console_data()


if __name__ == "__main__":
    main()
