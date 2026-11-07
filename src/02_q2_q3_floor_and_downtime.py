"""Analyze demand, and reconcile hourly downtime to calendar-based daily meters."""

from pipeline_io import ON_FLOOR, connect, parquet, records, write_json


DEMAND_SQL = f"""
CREATE TEMP TABLE zone_daily AS
WITH floor AS (
    SELECT gaming_date, zone_id, any_value(zone_name) AS zone_name,
           sum(coin_in_usd) AS coin_in_usd, sum(theo_usd) AS theo_usd,
           sum(available_hours) AS available_hours
    FROM prepared_daily_view WHERE {ON_FLOOR} GROUP BY gaming_date, zone_id
), sensors AS (
    SELECT cast(hour_start_local - INTERVAL '6 hours' AS DATE) AS gaming_date, zone_id,
           sum(entries_count) FILTER (WHERE counter_status = 'ok' AND entries_count IS NOT NULL)
               AS observed_entries,
           count(*) FILTER (WHERE counter_status = 'ok' AND entries_count IS NOT NULL)
               AS valid_counter_hours,
           count(*) AS reported_counter_slots
    FROM zone_traffic_hourly GROUP BY gaming_date, zone_id
)
SELECT f.*, s.observed_entries, coalesce(s.valid_counter_hours, 0) AS valid_counter_hours,
       coalesce(s.reported_counter_slots, 0) AS reported_counter_slots,
       EXISTS (SELECT 1 FROM floor_walkways w WHERE w.walkway_id = 'W-ENT-B40'
               AND c.gaming_day_start_utc >= w.closed_from_utc
               AND c.gaming_day_start_utc < w.closed_to_utc) AS walkway_closed
FROM floor f
JOIN calendar_day c USING (gaming_date)
LEFT JOIN sensors s USING (gaming_date, zone_id);

CREATE TEMP TABLE demand AS
WITH traffic AS (
    SELECT gaming_date, sum(observed_entries) AS observed_entries,
           sum(valid_counter_hours) AS valid_counter_hours,
           sum(reported_counter_slots) AS reported_counter_slots,
           bool_or(walkway_closed) AS walkway_closed
    FROM zone_daily GROUP BY gaming_date
)
SELECT p.gaming_date, c.month, c.local_weekday, c.scheduled_seconds, p.active_machines,
       p.coin_in_usd, p.house_win_usd, p.theo_usd, p.available_machine_hours,
       p.active_machines * c.scheduled_seconds / 3600.0 AS scheduled_machine_hours,
       p.occupied_machine_hours, t.* EXCLUDE (gaming_date),
       (SELECT string_agg(e.name, ' / ' ORDER BY e.name) FROM events e
        WHERE p.gaming_date BETWEEN e.start_date AND e.end_date) AS event_names,
       w.tmax_c, w.prcp_mm
FROM property_day p JOIN calendar_day c USING (gaming_date)
JOIN traffic t USING (gaming_date)
LEFT JOIN weather_daily w ON w.source_date = p.gaming_date;
"""


DOWNTIME_SQL = f"""
CREATE TEMP TABLE hourly AS
SELECT h.machine_id, h.gaming_date, h.hour_start_utc, h.local_hour, h.available_seconds,
       h.coin_in_cents, d.bank_id, d.zone_id, d.manufacturer, c.is_weekend,
       c.local_weekday, 1 - d.configured_rtp AS theoretical_hold
FROM (SELECT * FROM machine_hour WHERE {ON_FLOOR}) h
JOIN (SELECT * FROM prepared_daily_view WHERE {ON_FLOOR}) d
    USING (machine_id, gaming_date, location_id)
JOIN calendar_day c USING (gaming_date);

CREATE TEMP TABLE down_hours AS
WITH healthy AS (
    SELECT *, coin_in_cents / 100.0 AS coin_usd,
           coin_in_cents * theoretical_hold / 100.0 AS theo_usd
    FROM hourly WHERE available_seconds = 3600
), machine_rates AS (
    SELECT machine_id, bank_id, local_hour, is_weekend, count(*) AS samples,
           sum(coin_usd) / count(*) AS coin_usd_per_hour,
           sum(theo_usd) / count(*) AS theo_usd_per_hour
    FROM healthy GROUP BY ALL
), bank_rates AS (
    SELECT bank_id, local_hour, is_weekend,
           sum(coin_usd) / count(*) AS coin_usd_per_hour,
           sum(theo_usd) / count(*) AS theo_usd_per_hour
    FROM healthy GROUP BY ALL
), roster AS (
    SELECT gaming_date, shift, sum(actual_headcount) AS techs
    FROM shift_roster WHERE role = 'slot_tech' AND zone_id IS NULL GROUP BY ALL
), down AS (
    SELECT *, hour_start_utc + INTERVAL '1 hour' AS hour_end_utc,
           3600 - available_seconds AS down_seconds,
           CASE WHEN local_hour BETWEEN 6 AND 13 THEN 'day'
                WHEN local_hour BETWEEN 14 AND 21 THEN 'swing' ELSE 'grave' END AS shift
    FROM hourly WHERE available_seconds < 3600
)
SELECT h.*, r.techs, coalesce(m.coin_usd_per_hour, b.coin_usd_per_hour) AS baseline_coin,
       coalesce(m.theo_usd_per_hour, b.theo_usd_per_hour) AS baseline_theo,
       CASE WHEN m.samples IS NULL THEN 'bank' ELSE 'machine at bank' END AS baseline_level
FROM down h
LEFT JOIN machine_rates m USING (machine_id, bank_id, local_hour, is_weekend)
LEFT JOIN bank_rates b USING (bank_id, local_hour, is_weekend)
LEFT JOIN roster r USING (gaming_date, shift);

CREATE TEMP TABLE downtime AS
WITH tickets AS (
    SELECT h.machine_id, h.hour_start_utc, o.operation_id, o.event_type,
           greatest(h.hour_start_utc, o.opened_at_utc) AS overlap_start,
           least(h.hour_end_utc, o.available_at_utc) AS overlap_end,
           o.work_started_at_utc
    FROM down_hours h JOIN operations o ON o.machine_id = h.machine_id
     AND o.opened_at_utc < h.hour_end_utc AND o.available_at_utc > h.hour_start_utc
     AND o.available_at_utc > o.opened_at_utc
), points AS (
    SELECT machine_id, hour_start_utc, overlap_start AS edge FROM tickets
    UNION SELECT machine_id, hour_start_utc, overlap_end FROM tickets
    UNION SELECT machine_id, hour_start_utc, work_started_at_utc FROM tickets
        WHERE work_started_at_utc > overlap_start AND work_started_at_utc < overlap_end
), intervals AS (
    SELECT *, lead(edge) OVER (PARTITION BY machine_id, hour_start_utc ORDER BY edge) AS next_edge
    FROM points
), classified AS (
    SELECT i.machine_id, i.hour_start_utc, i.edge, t.event_type,
           CASE WHEN t.event_type <> 'fault_repair' THEN 'other'
                WHEN i.edge < t.work_started_at_utc THEN 'waiting for work' ELSE 'repair' END
               AS phase,
           date_diff('second', i.edge, i.next_edge) AS ticket_seconds
    FROM intervals i JOIN tickets t USING (machine_id, hour_start_utc)
    WHERE i.edge >= t.overlap_start AND i.edge < t.overlap_end AND i.next_edge IS NOT NULL
    QUALIFY row_number() OVER (PARTITION BY i.machine_id, i.hour_start_utc, i.edge
        ORDER BY (t.event_type = 'fault_repair') DESC, t.overlap_start, t.operation_id) = 1
), attributed AS (
    SELECT *, sum(ticket_seconds) OVER (PARTITION BY machine_id, hour_start_utc) AS union_seconds
    FROM classified
), measured AS (
    SELECT h.*, a.event_type, a.phase, a.union_seconds,
           a.ticket_seconds * least(1.0, h.down_seconds / a.union_seconds) AS seconds
    FROM down_hours h JOIN attributed a USING (machine_id, hour_start_utc)
    UNION ALL
    SELECT h.*, 'unattributed', 'unattributed', coalesce(a.union_seconds, 0),
           h.down_seconds - coalesce(a.union_seconds, 0) AS seconds
    FROM down_hours h
    LEFT JOIN (SELECT DISTINCT machine_id, hour_start_utc, union_seconds FROM attributed) a
         USING (machine_id, hour_start_utc)
    WHERE h.down_seconds > coalesce(a.union_seconds, 0)
)
SELECT gaming_date, machine_id, zone_id, bank_id, manufacturer, local_weekday, shift,
       techs, event_type, phase, baseline_level,
       sum(seconds) AS downtime_seconds,
       sum(seconds * baseline_coin / 3600.0) AS estimated_lost_coin_in_usd,
       sum(seconds * baseline_theo / 3600.0) AS estimated_lost_theo_usd
FROM measured GROUP BY ALL;
"""


def main():
    with connect(
        "property_day", "prepared_daily_view", "calendar_day", "zone_traffic_hourly",
        "events", "floor_walkways", "weather_daily", "city_visitation_monthly",
        "benchmark_public", "machine_hour", "operations", "shift_roster",
    ) as connection:
        connection.execute(DEMAND_SQL)
        connection.execute(DOWNTIME_SQL)
        meter_seconds = connection.execute(f"""
            SELECT round(sum(c.scheduled_seconds / 3600.0 - d.available_hours) * 3600)
            FROM (SELECT * FROM prepared_daily_view WHERE {ON_FLOOR}) d
            JOIN calendar_day c USING (gaming_date)
        """).fetchone()[0]
        totals = records(connection, """
            SELECT sum(downtime_seconds) AS seconds, sum(downtime_seconds)/3600 AS hours,
                   sum(estimated_lost_coin_in_usd) AS lost_coin_in_usd,
                   sum(estimated_lost_theo_usd) AS lost_theo_usd
            FROM downtime
        """)[0]
        gaps = connection.execute("""
            SELECT count_if(baseline_coin IS NULL OR baseline_theo IS NULL OR techs IS NULL)
            FROM down_hours
        """).fetchone()[0]
        if abs(totals["seconds"] - meter_seconds) > 0.001 or gaps:
            raise ValueError("Downtime totals or rate/staffing coverage failed reconciliation")

        monthly = records(connection, """
            WITH floor AS (
                SELECT month, count(*) AS days, sum(coin_in_usd) AS coin_in_usd,
                       sum(coin_in_usd) / count(*) AS coin_in_per_day,
                       sum(theo_usd) AS theo_usd, sum(house_win_usd) AS house_win_usd,
                       sum(coin_in_usd)/sum(available_machine_hours) AS coin_in_per_available_hour,
                       sum(tmax_c) / count(tmax_c) AS mean_max_temp_c,
                       sum(observed_entries) / sum(valid_counter_hours) AS entries_per_valid_hour
                FROM demand GROUP BY month
            ), missouri AS (
                SELECT month, sum(handle_usd) AS mo_handle_matched_categories,
                       sum(agr_usd)/sum(handle_usd) AS mo_hold_matched_categories
                FROM benchmark_public WHERE category_kind = 'game_category'
                   AND handle_usd IS NOT NULL AND agr_usd IS NOT NULL GROUP BY month
            )
            SELECT floor.*, v.mean_visitors_per_calendar_day AS vegas_visitors_per_day,
                   mo.* EXCLUDE (month)
            FROM floor JOIN city_visitation_monthly v USING (month)
            JOIN missouri mo USING (month) ORDER BY month
        """)
        closure = records(connection, """
            SELECT CASE WHEN gaming_date < DATE '2025-03-03' THEN 'Before'
                        WHEN walkway_closed THEN 'During' ELSE 'After' END AS phase,
                   CASE WHEN zone_id = 'Z-B40' THEN 'Back Forty' ELSE 'Other zones' END AS area,
                   sum(coin_in_usd)/sum(available_hours) AS coin_in_per_available_hour,
                   sum(observed_entries)/sum(valid_counter_hours) AS entries_per_valid_hour,
                   sum(valid_counter_hours)/sum(reported_counter_slots) AS sensor_coverage
            FROM zone_daily WHERE gaming_date BETWEEN DATE '2025-01-27' AND DATE '2025-05-11'
            GROUP BY ALL ORDER BY min(gaming_date), area
        """)
        event_results = records(connection, """
            WITH matches AS (
                SELECT e.event_id, e.name, e.start_date, e.end_date, d.gaming_date,
                       d.coin_in_usd, (SELECT sum(n.coin_in_usd)/count(*) FROM demand n
                           WHERE n.month = d.month AND n.local_weekday = d.local_weekday
                           AND n.event_names IS NULL) AS comparison
                FROM events e JOIN demand d ON d.gaming_date BETWEEN e.start_date AND e.end_date
            )
            SELECT event_id, name, start_date, end_date, count(*) AS matched_days,
                   sum(coin_in_usd)/sum(comparison) - 1 AS difference
            FROM matches WHERE comparison IS NOT NULL GROUP BY ALL ORDER BY start_date
        """)
        breakdown = records(connection, """
            SELECT shift, techs, event_type, phase, sum(downtime_seconds)/3600 AS hours,
                   sum(estimated_lost_coin_in_usd) AS lost_coin_in_usd,
                   sum(estimated_lost_theo_usd) AS lost_theo_usd
            FROM downtime GROUP BY ALL ORDER BY shift, techs, hours DESC
        """)
        staffing = records(connection, """
            WITH losses AS (
                SELECT gaming_date, shift, sum(downtime_seconds)/3600 AS hours,
                       sum(estimated_lost_theo_usd) AS lost_theo_usd,
                       coalesce(sum(estimated_lost_theo_usd)
                           FILTER (WHERE phase = 'waiting for work'), 0) AS queue_theo_usd
                FROM downtime GROUP BY ALL
            )
            SELECT r.shift, r.actual_headcount AS techs, count(*) AS staffed_shifts,
                   sum(coalesce(l.hours, 0))/count(*) AS downtime_hours_per_shift,
                   sum(coalesce(l.lost_theo_usd, 0)) AS lost_theo_usd,
                   sum(coalesce(l.queue_theo_usd, 0)) AS queue_theo_usd
            FROM shift_roster r LEFT JOIN losses l USING (gaming_date, shift)
            WHERE r.role = 'slot_tech' AND r.zone_id IS NULL GROUP BY ALL ORDER BY 1, 2
        """)
        parquet(connection, "q2_demand", "SELECT * FROM demand ORDER BY gaming_date")
        parquet(connection, "q2_zones", "SELECT * FROM zone_daily ORDER BY gaming_date, zone_id")
        parquet(connection, "q3_downtime", "SELECT * FROM downtime ORDER BY gaming_date, machine_id")
        write_json("q2_evidence", {"monthly": monthly, "closure": closure, "events": event_results})
        write_json("q3_evidence", {"totals": totals, "breakdown": breakdown, "staffing": staffing})
        print("Q2 monthly:", monthly)
        print("Q2 closure:", closure)
        print("Q2 events:", event_results)
        print("Q3 observed and modeled downtime:", totals)
        print("Q3 staffing and queue:", staffing)
        for field in ("manufacturer", "event_type", "local_weekday", "shift"):
            print(f"Q3 by {field}:", records(connection, f"""
                SELECT {field}, sum(downtime_seconds)/3600 AS hours,
                       sum(estimated_lost_theo_usd) AS lost_theo_usd
                FROM downtime GROUP BY ALL ORDER BY hours DESC
            """))


if __name__ == "__main__":
    main()
