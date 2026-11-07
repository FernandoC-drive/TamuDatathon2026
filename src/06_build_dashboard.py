"""Collect dashboard data and optionally rebuild the legacy HTML edition."""

import argparse
import base64
import hashlib
import json
import struct
import zlib
from pathlib import Path

from pipeline_io import ON_FLOOR, OUTPUT, ROOT, connect, json_default, records


def collect_dashboard_data():
    with connect("prepared_daily_view", "machine_day", "calendar_day", "game_math") as connection:
        for name in ("q1_machines", "q1_placements", "q2_demand", "q2_zones", "q3_downtime",
                     "q4_players", "q4_guest_days", "q5_comps", "q5_tiers", "model_results"):
            connection.read_parquet(str(OUTPUT / f"{name}.parquet")).create_view(name)
        data = {
            "dates": [row[0].isoformat() for row in connection.execute(
                "SELECT gaming_date FROM calendar_day ORDER BY gaming_date").fetchall()],
            "zones": records(connection, "SELECT DISTINCT zone_id, zone_name FROM q2_zones ORDER BY zone_name"),
            "machine": records(connection, """
                SELECT machine_id, gm_rank, theme, manufacturer, primary_diagnosis,
                       payout_inspection, low_local_demand, short_exposure, high_downtime,
                       weak_location, payout_z, zone_same_config_theo_index, bank_theo_index
                FROM q1_machines ORDER BY machine_id
            """),
            "placement": records(connection, """
                SELECT machine_id, location_id, bank_id, zone_name, config_id,
                       first_gaming_date, last_gaming_date, theo_per_available_hour,
                       floor_same_config_theo_index FROM q1_placements
                ORDER BY machine_id, first_gaming_date
            """),
            "demand": records(connection, "SELECT gaming_date, event_names FROM q2_demand ORDER BY gaming_date"),
            "zoneDaily": records(connection, """
                SELECT gaming_date, zone_id, observed_entries, valid_counter_hours,
                       reported_counter_slots FROM q2_zones ORDER BY gaming_date, zone_id
            """),
            "downtime": records(connection, """
                SELECT gaming_date, machine_id, zone_id, bank_id, manufacturer, local_weekday,
                       shift, techs, event_type, phase, round(downtime_seconds, 4) AS seconds,
                       round(estimated_lost_coin_in_usd, 5) AS coin,
                       round(estimated_lost_theo_usd, 5) AS theo
                FROM q3_downtime
            """),
            "guests": records(connection, """
                SELECT gaming_date, tier, age_band, home_region, round(coin_in_usd, 2) AS coin,
                       round(payout_usd, 2) AS payout, round(house_win_usd, 2) AS win,
                       round(theo_usd, 4) AS theo, session_segments AS segments
                FROM q4_players
            """),
            "carded": records(connection, f"""
                SELECT gaming_date, sum(coin_in_cents)/100 AS all_coin,
                       sum(payout_cents)/100 AS all_payout, sum(house_win_cents)/100 AS all_win,
                       sum(theo_cents)/100 AS all_theo, sum(carded_coin_in_cents)/100 AS coin,
                       sum(carded_payout_cents)/100 AS payout,
                       sum(carded_coin_in_cents-carded_payout_cents)/100 AS win,
                       sum(carded_theo_cents)/100 AS theo
                FROM machine_day WHERE {ON_FLOOR} GROUP BY gaming_date
            """),
            "comps": records(connection, """
                SELECT gaming_date, comp_cost_usd, carded_coin_in_usd, carded_theo_usd,
                       points_earned, points_redeemed, redemptions FROM q5_comps ORDER BY gaming_date
            """),
            "compTiers": records(connection, "SELECT * FROM q5_tiers ORDER BY gaming_date, tier"),
            "forecast": records(connection, "SELECT * FROM model_results ORDER BY gaming_date"),
        }
        data["banks"] = [row[0] for row in connection.execute(f"""
            SELECT DISTINCT bank_id FROM prepared_daily_view WHERE {ON_FLOOR} ORDER BY bank_id
        """).fetchall()]
        # Index repeated dimension strings, and keep money and time as integers in transport.
        # Row order: day, machine, zone, bank, handle cents, win cents, theo USD*10,000,
        # available seconds, scheduled seconds, payout variance USD².
        data["floor"] = connection.execute(f"""
            WITH dates AS (SELECT *, row_number() OVER (ORDER BY gaming_date)-1 AS day FROM calendar_day),
            assets AS (SELECT machine_id, row_number() OVER (ORDER BY machine_id)-1 AS machine
                FROM q1_machines),
            zones AS (SELECT *, row_number() OVER (ORDER BY zone_name)-1 AS zone FROM (
                SELECT DISTINCT zone_id, zone_name FROM q2_zones)),
            banks AS (SELECT *, row_number() OVER (ORDER BY bank_id)-1 AS bank FROM (
                SELECT DISTINCT bank_id FROM prepared_daily_view WHERE {ON_FLOOR}))
            SELECT c.day, a.machine, z.zone, b.bank, m.coin_in_cents, m.house_win_cents,
                   cast(d.theo_usd * 10000 AS BIGINT), m.available_seconds, c.scheduled_seconds,
                   round(g.payout_multiplier_variance * m.sum_bet_squared / 10000, 6)
            FROM (SELECT * FROM prepared_daily_view WHERE {ON_FLOOR}) d
            JOIN (SELECT * FROM machine_day WHERE {ON_FLOOR}) m
                USING (gaming_date, machine_id, location_id, config_id)
            JOIN dates c USING (gaming_date) JOIN assets a USING (machine_id)
            JOIN zones z USING (zone_id) JOIN banks b USING (bank_id)
            JOIN game_math g USING (config_id) ORDER BY c.day, a.machine
        """).fetchall()
        if len(data["floor"]) != connection.execute(
            "SELECT sum(active_days) FROM q1_machines"
        ).fetchone()[0]:
            raise ValueError("Dashboard floor rows do not reconcile to Q1")
        data["guestSegments"] = connection.execute("""
            SELECT DISTINCT tier, age_band, home_region FROM q4_guest_days ORDER BY 1, 2, 3
        """).fetchall()
        segment_index = {segment: i for i, segment in enumerate(data["guestSegments"])}
        day_index = {day: i for i, day in enumerate(data["dates"])}
        # Anonymous guest-day balances for exact range-filtered concentration.
        # Each 14-byte row holds the date index, segment index, guest key and two cents totals.
        pack = struct.Struct("<BBIii").pack
        guest_days = connection.execute("""
            SELECT gaming_date, tier, age_band, home_region, guest_index, coin_cents, win_cents
            FROM q4_guest_days ORDER BY gaming_date, guest_index
        """).fetchall()
        packed = b"".join(pack(day_index[day.isoformat()], segment_index[tier, age, region],
                              guest, coin, win) for day, tier, age, region, guest, coin, win in guest_days)
        data["guestDays"] = base64.b64encode(zlib.compress(packed, level=6)).decode("ascii")
    for name in ("q2_evidence", "q3_evidence", "q4_evidence", "q5_evidence",
                 "model_evidence", "q6_budget_plan"):
        data[name] = json.loads((OUTPUT / f"{name}.json").read_text(encoding="utf-8"))
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=ROOT / "legacy_dashboard")
    args = parser.parse_args()
    data = collect_dashboard_data()

    template_path = ROOT / "src" / "dashboard_template.html"
    vendor_path = template_path.parent / "vendor" / "chart.umd.js"
    library = vendor_path.read_bytes()
    digest = base64.b64encode(hashlib.sha384(library).digest()).decode("ascii")
    payload = json.dumps(data, separators=(",", ":"), default=json_default, allow_nan=False)
    html = (
        template_path.read_text(encoding="utf-8")
        .replace("__CHART_INTEGRITY__", f"sha384-{digest}")
        .replace("/*__CHART_LICENSE__*/", "/*\n" + vendor_path.with_name("LICENSE.md").read_text(
            encoding="utf-8") + "*/")
        .replace("/*__CHART_FALLBACK__*/", library.decode("utf-8"))
        .replace("/*__DASHBOARD_DATA__*/", payload.replace("<", "\\u003c"))
        .replace("/*__DASHBOARD_APP__*/", template_path.with_name("dashboard.js").read_text(encoding="utf-8"))
    )
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for filename in ("dashboard.html", "index.html"):
        (args.output_dir / filename).write_text(html, encoding="utf-8", newline="\n")
    print(f"Built legacy HTML in {args.output_dir} with {len(data['floor']):,} embedded machine-days.")


if __name__ == "__main__":
    main()
