"""Rebuild the GM ranking and diagnose active machines using the Q1 Parquets."""

from pathlib import Path
from statistics import NormalDist

import duckdb


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "processed_data"
SOURCES = {
    "prepared": "1_prepared_views/prepared_daily_view",
    "meters": "2_machine_decision/machine_day",
    "machines": "2_machine_decision/machines",
    "game_math": "2_machine_decision/game_math",
    "placements": "2_machine_decision/placements",
    "calendar": "2_machine_decision/calendar_day",
}
ON_FLOOR = "active IS TRUE AND NULLIF(TRIM(location_id), '') IS NOT NULL"
PAYOUT_FAMILY_ALPHA = 0.05
LOW_RATE_INDEX = 0.85
MIN_MATCHED_DAYS = 30
MIN_MATCHED_HOUR_SHARE = 0.80
SHORT_EXPOSURE_SHARE = 0.75
LOW_AVAILABILITY = 0.98


DAILY_SQL = f"""
CREATE TEMP TABLE daily AS
WITH active_days AS (SELECT * FROM prepared WHERE {ON_FLOOR}),
     active_meters AS (SELECT * FROM meters WHERE {ON_FLOOR})
SELECT d.machine_id, d.gaming_date, d.location_id, d.bank_id, d.zone_id,
       d.zone_name, d.config_id, p.placement_id, p.effective_from_utc, p.effective_to_utc,
       g.volatility_class, c.scheduled_seconds, m.available_seconds, d.available_hours, d.paid_spins,
       d.coin_in_usd, d.payout_usd, d.house_win_usd, d.theo_usd,
       d.contribution_after_supplied_costs_usd,
       d.coin_in_usd * (1 - g.configured_rtp) AS config_theo_usd,
       -- Payout/bet variance times the actual sum of squared bets; cents^2 to USD^2.
       g.payout_multiplier_variance * m.sum_bet_squared / 10000.0 AS payout_variance_usd2
FROM active_days d
JOIN active_meters m USING (machine_id, gaming_date, location_id, config_id)
JOIN calendar c USING (gaming_date)
JOIN game_math g USING (config_id)
JOIN placements p ON p.machine_id = d.machine_id
                 AND p.location_id = d.location_id AND p.config_id = d.config_id
                 AND c.gaming_day_start_utc >= p.effective_from_utc
                 AND (c.gaming_day_start_utc < p.effective_to_utc OR p.effective_to_utc IS NULL)
"""


PEER_SQL = """
CREATE TEMP TABLE daily_peers AS
SELECT *,
       -- Multiply each leave-one-out peer rate by this machine's available time.
       -- Summing these expected amounts gives peers the same date/placement mix.
       available_seconds * (sum(coin_in_usd) OVER bank - coin_in_usd)
           / nullif(sum(available_seconds) OVER bank - available_seconds, 0) AS bank_coin,
       available_seconds * (sum(theo_usd) OVER bank - theo_usd)
           / nullif(sum(available_seconds) OVER bank - available_seconds, 0) AS bank_theo,
       available_seconds * (sum(coin_in_usd) OVER zone - coin_in_usd)
           / nullif(sum(available_seconds) OVER zone - available_seconds, 0) AS zone_coin,
       available_seconds * (sum(theo_usd) OVER zone - theo_usd)
           / nullif(sum(available_seconds) OVER zone - available_seconds, 0) AS zone_theo,
       available_seconds * (sum(theo_usd) OVER zone_config - theo_usd)
           / nullif(sum(available_seconds) OVER zone_config - available_seconds, 0)
           AS zone_same_config_theo,
       available_seconds * (sum(theo_usd) OVER floor_config - sum(theo_usd) OVER zone_config)
           / nullif(sum(available_seconds) OVER floor_config -
                    sum(available_seconds) OVER zone_config, 0) AS outside_zone_same_config_theo,
       available_seconds * (sum(theo_usd) OVER floor_config - theo_usd)
           / nullif(sum(available_seconds) OVER floor_config - available_seconds, 0)
           AS floor_same_config_theo
FROM daily
WINDOW bank AS (PARTITION BY gaming_date, zone_id, bank_id),
       zone AS (PARTITION BY gaming_date, zone_id),
       zone_config AS (PARTITION BY gaming_date, zone_id, config_id),
       floor_config AS (PARTITION BY gaming_date, config_id)
"""


PLACEMENT_SQL = """
CREATE TEMP TABLE placement_results AS
WITH rates AS (
    SELECT machine_id, placement_id, location_id, bank_id, zone_id, zone_name, config_id,
           effective_from_utc, effective_to_utc,
           min(gaming_date) AS first_gaming_date, max(gaming_date) AS last_gaming_date,
           count(*) AS active_days, sum(available_hours) AS available_hours,
           sum(coin_in_usd) AS coin_in_usd, sum(theo_usd) AS theo_usd,
           sum(theo_usd) / nullif(sum(available_hours), 0) AS theo_per_available_hour,
           sum(theo_usd) FILTER (WHERE floor_same_config_theo IS NOT NULL)
               / nullif(sum(floor_same_config_theo), 0) AS floor_same_config_theo_index
    FROM daily_peers
    GROUP BY ALL
), prior AS (
    SELECT *, lag(location_id) OVER history AS prior_location_id,
           lag(zone_id) OVER history AS prior_zone_id,
           lag(config_id) OVER history AS prior_config_id,
           lag(theo_per_available_hour) OVER history AS prior_theo_per_available_hour,
           lag(floor_same_config_theo_index) OVER history AS prior_floor_same_config_theo_index
    FROM rates
    WINDOW history AS (PARTITION BY machine_id ORDER BY effective_from_utc, placement_id)
)
SELECT *, coalesce(location_id != prior_location_id, false) AS moved_here,
       theo_per_available_hour - prior_theo_per_available_hour AS change_theo_per_available_hour,
       theo_per_available_hour / nullif(prior_theo_per_available_hour, 0) - 1 AS theo_rate_change,
       floor_same_config_theo_index - prior_floor_same_config_theo_index AS change_peer_index
FROM prior
"""


MACHINE_SQL = """
CREATE TEMP TABLE machine_results AS
WITH totals AS (
    SELECT machine_id, count(*) AS active_days, min(gaming_date) AS first_gaming_date,
           max(gaming_date) AS last_gaming_date,
           string_agg(DISTINCT zone_id, ', ' ORDER BY zone_id) AS zones,
           string_agg(DISTINCT bank_id, ', ' ORDER BY bank_id) AS banks,
           string_agg(DISTINCT config_id, ', ' ORDER BY config_id) AS configs,
           string_agg(DISTINCT volatility_class, ', ' ORDER BY volatility_class) AS volatility,
           sum(scheduled_seconds) / 3600.0 AS scheduled_hours,
           sum(available_hours) AS available_hours,
           sum(scheduled_seconds) / 3600.0 - sum(available_hours) AS downtime_hours,
           sum(available_hours) / nullif(sum(scheduled_seconds) / 3600.0, 0) AS availability,
           sum(paid_spins) AS paid_spins,
           sum(coin_in_usd) AS coin_in_usd, sum(payout_usd) AS payout_usd,
           sum(house_win_usd) AS house_win_usd, sum(theo_usd) AS theo_usd,
           sum(contribution_after_supplied_costs_usd) AS contribution_after_supplied_costs_usd,
           sum(house_win_usd - theo_usd) AS luck_residual_usd,
           sum(house_win_usd) / nullif(sum(coin_in_usd), 0) AS observed_hold,
           sum(config_theo_usd) / nullif(sum(coin_in_usd), 0) AS theoretical_hold,
           observed_hold - theoretical_hold AS hold_gap,
           sqrt(sum(payout_variance_usd2)) AS payout_sd_usd,
           luck_residual_usd / nullif(payout_sd_usd, 0) AS payout_z,
           sum(coin_in_usd) / nullif(sum(available_hours), 0) AS coin_in_per_available_hour,
           sum(theo_usd) / nullif(sum(available_hours), 0) AS theo_per_available_hour,
           sum(bank_coin) * 3600 / nullif(sum(available_seconds)
               FILTER (WHERE bank_coin IS NOT NULL), 0) AS bank_peer_coin_in_per_hour,
           sum(bank_theo) * 3600 / nullif(sum(available_seconds)
               FILTER (WHERE bank_theo IS NOT NULL), 0) AS bank_peer_theo_per_hour,
           sum(zone_coin) * 3600 / nullif(sum(available_seconds)
               FILTER (WHERE zone_coin IS NOT NULL), 0) AS zone_peer_coin_in_per_hour,
           sum(zone_theo) * 3600 / nullif(sum(available_seconds)
               FILTER (WHERE zone_theo IS NOT NULL), 0) AS zone_peer_theo_per_hour,
           sum(theo_usd) FILTER (WHERE bank_theo IS NOT NULL)
               / nullif(sum(bank_theo), 0) AS bank_theo_index,
           sum(theo_usd) FILTER (WHERE zone_same_config_theo IS NOT NULL)
               / nullif(sum(zone_same_config_theo), 0) AS zone_same_config_theo_index,
           sum(zone_same_config_theo) FILTER (WHERE outside_zone_same_config_theo IS NOT NULL)
               / nullif(sum(outside_zone_same_config_theo)
                   FILTER (WHERE zone_same_config_theo IS NOT NULL), 0) AS location_theo_index,
           count_if(available_seconds > 0 AND zone_same_config_theo IS NOT NULL)
               AS local_match_days,
           sum(available_seconds) FILTER (WHERE zone_same_config_theo IS NOT NULL)
               / nullif(sum(available_seconds), 0) AS local_match_hour_share,
           count_if(available_seconds > 0 AND zone_same_config_theo IS NOT NULL
               AND outside_zone_same_config_theo IS NOT NULL) AS location_match_days,
           sum(available_seconds) FILTER (WHERE zone_same_config_theo IS NOT NULL
               AND outside_zone_same_config_theo IS NOT NULL)
               / nullif(sum(available_seconds), 0) AS location_match_hour_share
    FROM daily_peers
    GROUP BY machine_id
), placement_counts AS (
    SELECT machine_id, count(*) AS placement_count, count_if(moved_here) AS move_count
    FROM placement_results GROUP BY machine_id
), ranked AS (
    SELECT t.*, m.manufacturer, m.theme, m.lease_class, m.install_date, m.retire_date,
           p.placement_count, p.move_count,
           row_number() OVER (ORDER BY t.house_win_usd, t.machine_id) AS gm_rank,
           t.scheduled_hours / (SELECT sum(scheduled_seconds) / 3600.0 FROM calendar)
               AS exposure_share
    FROM totals t
    JOIN machines m USING (machine_id)
    JOIN placement_counts p USING (machine_id)
), flags AS (
    SELECT *,
           gm_rank <= 10 AS gm_bottom_10,
           coalesce(abs(payout_z) >= $payout_cutoff, false) AS payout_inspection,
           exposure_share < $short_exposure AS short_exposure,
           availability < $low_availability AS high_downtime,
           coalesce(location_theo_index < $low_rate AND location_match_days >= $min_days
               AND location_match_hour_share >= $min_share, false) AS weak_location,
           coalesce(zone_same_config_theo_index < $low_rate AND bank_theo_index < $low_rate
               AND local_match_days >= $min_days AND local_match_hour_share >= $min_share,
               false) AS low_local_demand
    FROM ranked
)
SELECT *, CASE
    WHEN payout_inspection THEN 'Payout inspection'
    WHEN short_exposure THEN 'Short floor exposure'
    WHEN high_downtime THEN 'High downtime'
    WHEN low_local_demand THEN 'Low demand versus local peers'
    WHEN weak_location THEN 'Weak location benchmark'
    WHEN payout_z <= -1 THEN 'Negative payout variation'
    ELSE 'No priority signal'
END AS primary_diagnosis
FROM flags
"""


def print_rows(connection, heading, query):
    print(f"\n{heading}")
    result = connection.execute(query)
    print(" | ".join(column[0] for column in result.description))
    for row in result.fetchall():
        print(" | ".join("-" if value is None else str(value) for value in row))


def main():
    with duckdb.connect() as connection:
        for name, relative_path in SOURCES.items():
            path = ROOT / "data" / f"{relative_path}.parquet"
            connection.read_parquet(str(path)).create_view(name)

        connection.execute(DAILY_SQL)
        total_rows, active_rows, active_machines = connection.execute(f"""
            SELECT count(*), count_if({ON_FLOOR}),
                   count(DISTINCT machine_id) FILTER (WHERE {ON_FLOOR})
            FROM prepared
        """).fetchone()
        joined_rows, joined_keys, mismatched_theo, mismatched_hours = connection.execute("""
            SELECT count(*), count(DISTINCT (machine_id, gaming_date)),
                   count_if(abs(theo_usd - config_theo_usd) > 0.00005),
                   count_if(available_hours IS NULL OR
                            abs(available_hours * 3600 - available_seconds) > 0.000001)
            FROM daily
        """).fetchone()
        if joined_rows != active_rows or joined_keys != active_rows:
            raise ValueError("Machine-day joins changed coverage")
        if mismatched_theo or mismatched_hours:
            raise ValueError("Prepared theo or available hours disagree with their sources")

        connection.execute(PEER_SQL)
        connection.execute(PLACEMENT_SQL)
        # Two-sided normal approximation with Bonferroni control across all active machines.
        payout_cutoff = NormalDist().inv_cdf(1 - PAYOUT_FAMILY_ALPHA / (2 * active_machines))
        connection.execute(MACHINE_SQL, {
            "payout_cutoff": payout_cutoff,
            "short_exposure": SHORT_EXPOSURE_SHARE,
            "low_availability": LOW_AVAILABILITY,
            "low_rate": LOW_RATE_INDEX,
            "min_days": MIN_MATCHED_DAYS,
            "min_share": MIN_MATCHED_HOUR_SHARE,
        })
        result_count, rank_mismatches = connection.execute("""
            WITH gm AS (
                SELECT machine_id, row_number() OVER (ORDER BY sum(house_win_usd), machine_id)
                    AS gm_rank
                FROM prepared WHERE active IS TRUE
                GROUP BY machine_id
            )
            SELECT count(machine_results.machine_id),
                   count_if(gm.gm_rank IS DISTINCT FROM machine_results.gm_rank)
            FROM gm FULL JOIN machine_results USING (machine_id)
        """).fetchone()
        if result_count != active_machines or rank_mismatches:
            raise ValueError("Diagnostic rows do not reconcile with the direct GM ranking")

        print(f"Kept {active_rows:,} of {total_rows:,} machine-days across {active_machines} machines.")
        print(f"Payout inspection threshold: |z| >= {payout_cutoff:.3f} (5% family-wise).")
        print(f"Screening cutoffs: exposure below {SHORT_EXPOSURE_SHARE:.0%}; availability below "
              f"{LOW_AVAILABILITY:.0%}; demand below {LOW_RATE_INDEX:.0%} of peers with "
              f"{MIN_MATCHED_DAYS}+ matched days and {MIN_MATCHED_HOUR_SHARE:.0%}+ hour coverage.")
        print("Payout z assumes independent spins under published game math. "
              "Placement comparisons are observational.")
        print_rows(connection, "GM bottom 10 (money in USD; indices of 1.000 equal peers)", """
            SELECT gm_rank, machine_id, zones, banks, active_days,
                   round(scheduled_hours, 2) AS scheduled_h,
                   round(available_hours, 2) AS available_h,
                   round(downtime_hours, 2) AS down_h, round(100 * availability, 2) AS avail_pct,
                   house_win_usd, round(theo_usd, 2) AS theo_usd,
                   round(luck_residual_usd, 2) AS residual_usd, round(payout_z, 3) AS z,
                   round(100 * observed_hold, 2) AS observed_hold_pct,
                   round(100 * theoretical_hold, 2) AS theoretical_hold_pct,
                   round(coin_in_per_available_hour, 2) AS coin_in_per_h,
                   round(theo_per_available_hour, 2) AS theo_per_h,
                   round(bank_theo_index, 3) AS bank_idx,
                   round(zone_same_config_theo_index, 3) AS local_config_idx,
                   round(location_theo_index, 3) AS location_idx, primary_diagnosis
            FROM machine_results WHERE gm_bottom_10 ORDER BY gm_rank
        """)
        print_rows(connection, "Floor-wide screens (flags may overlap)", """
            SELECT count_if(payout_inspection) AS payout_inspection,
                   count_if(short_exposure) AS short_exposure,
                   count_if(high_downtime) AS high_downtime,
                   count_if(weak_location) AS weak_location,
                   count_if(low_local_demand) AS low_local_demand,
                   count_if(low_local_demand AND NOT (payout_inspection OR short_exposure
                       OR high_downtime)) AS demand_priority
            FROM machine_results
        """)
        print_rows(connection, "Adjusted payout inspection leads", """
            SELECT machine_id, zones, configs, paid_spins, coin_in_usd,
                   round(luck_residual_usd, 2) AS residual_usd,
                   round(payout_sd_usd, 2) AS payout_sd_usd, round(payout_z, 3) AS z
            FROM machine_results WHERE payout_inspection ORDER BY abs(payout_z) DESC
        """)
        print_rows(connection, "Low demand versus local peers, including overlapping flags", """
            SELECT machine_id, zones, active_days, round(100 * availability, 2) AS avail_pct,
                   round(theo_per_available_hour, 2) AS theo_per_h,
                   round(zone_same_config_theo_index, 3) AS local_config_idx,
                   round(bank_theo_index, 3) AS bank_idx, primary_diagnosis
            FROM machine_results WHERE low_local_demand ORDER BY gm_rank
        """)
        print_rows(connection, "Moves (theo USD per available hour, same-config floor index)", """
            SELECT machine_id, first_gaming_date AS move_date, prior_location_id, location_id,
                   prior_zone_id, zone_id, round(prior_theo_per_available_hour, 2) AS before,
                   round(theo_per_available_hour, 2) AS after,
                   round(100 * theo_rate_change, 2) AS change_pct,
                   round(prior_floor_same_config_theo_index, 3) AS before_peer_idx,
                   round(floor_same_config_theo_index, 3) AS after_peer_idx
            FROM placement_results WHERE moved_here ORDER BY move_date, machine_id
        """)

        OUTPUT.mkdir(exist_ok=True)
        connection.sql("SELECT * FROM machine_results ORDER BY gm_rank").write_parquet(
            str(OUTPUT / "q1_machines.parquet")
        )
        connection.sql("""
            SELECT * FROM placement_results ORDER BY machine_id, effective_from_utc
        """).write_parquet(str(OUTPUT / "q1_placements.parquet"))
        print("\nSaved q1_machines.parquet and q1_placements.parquet to processed_data/.")


if __name__ == "__main__":
    main()
