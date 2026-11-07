"""Reconcile carded play and identify loyalty pricing changes from redemptions."""

from pipeline_io import ON_FLOOR, connect, parquet, records, write_json


GUEST_SQL = """
CREATE TEMP TABLE guest_daily AS
SELECT s.gaming_date, p.opening_tier AS tier, coalesce(p.age_band, 'Unknown') AS age_band,
       p.home_region, sum(s.coin_in_cents)::DECIMAL(20,2)/100 AS coin_in_usd,
       sum(s.payout_cents)::DECIMAL(20,2)/100 AS payout_usd,
       sum(s.coin_in_cents-s.payout_cents)::DECIMAL(20,2)/100 AS house_win_usd,
       sum(s.theo_cents)/100 AS theo_usd, count(*) AS session_segments
FROM sessions s JOIN players p USING (player_id) GROUP BY ALL;

CREATE TEMP TABLE guest_totals AS
SELECT player_id, sum(tracked_coin_in_usd) AS wager, sum(tracked_payout_usd) AS payout,
       -sum(tracked_net_usd) AS house_win, sum(theo_usd) AS theo
FROM player_period GROUP BY player_id HAVING sum(tracked_coin_in_usd) > 0;

CREATE TEMP TABLE guest_day_outcomes AS
WITH days AS (
    SELECT gaming_date, player_id, sum(coin_in_cents)::BIGINT AS coin_cents,
           sum(coin_in_cents-payout_cents)::BIGINT AS win_cents
    FROM sessions GROUP BY ALL HAVING sum(coin_in_cents) > 0
)
SELECT d.gaming_date, dense_rank() OVER (ORDER BY d.player_id)-1 AS guest_index,
       p.opening_tier AS tier, coalesce(p.age_band, 'Unknown') AS age_band,
       p.home_region, d.coin_cents, d.win_cents
FROM days d JOIN players p USING (player_id);

CREATE TEMP TABLE guest_rank AS
SELECT *, row_number() OVER (ORDER BY wager DESC, player_id) AS wager_rank,
       row_number() OVER (ORDER BY house_win DESC, player_id) AS loss_rank,
       count(*) OVER () AS n,
       sum(wager) OVER () AS total_wager, sum(house_win) OVER () AS total_house_win,
       sum(greatest(house_win, 0)) OVER () AS total_positive_loss
FROM guest_totals;
"""


COMP_SQL = f"""
CREATE TEMP TABLE ledger_dated AS
SELECT *, cast(timezone('America/Los_Angeles', event_at_utc AT TIME ZONE 'UTC') -
               INTERVAL '6 hours' AS DATE) AS gaming_date
FROM loyalty_ledger;

CREATE TEMP TABLE tier_redemptions AS
SELECT gaming_date, tier_before AS tier, count(*) AS redemptions,
       -sum(points_delta) AS points_spent, sum(face_value_cents)/100 AS face_usd,
       sum(economic_cost_cents)/100 AS comp_cost_usd
FROM ledger_dated WHERE event_type = 'redeem' GROUP BY ALL;

CREATE TEMP TABLE comps AS
WITH ledger AS (
    SELECT gaming_date,
           sum(points_delta) FILTER (WHERE event_type = 'award') AS points_earned,
           -sum(points_delta) FILTER (WHERE event_type = 'redeem') AS points_redeemed,
           count(*) FILTER (WHERE event_type = 'redeem') AS redemptions,
           sum(economic_cost_cents) FILTER (WHERE event_type = 'redeem') AS comp_cents
    FROM ledger_dated GROUP BY gaming_date
), pos AS (
    SELECT cast(event_at_local - INTERVAL '6 hours' AS DATE) AS gaming_date,
           sum(cogs_cents) FILTER (WHERE nullif(comp_id, '') IS NOT NULL) AS comp_cents,
           sum(cogs_cents) AS pos_cogs_cents
    FROM fnb_transactions GROUP BY gaming_date
), meter AS (
    SELECT gaming_date, sum(carded_coin_in_cents)/100 AS carded_coin_in_usd,
           sum(carded_theo_cents)/100 AS carded_theo_usd
    FROM machine_day WHERE {ON_FLOOR} GROUP BY gaming_date
)
SELECT p.gaming_date, c.month, p.comp_cost_usd, p.comp_face_value_usd, p.pos_cogs_usd,
       p.pos_cash_usd, m.carded_coin_in_usd, m.carded_theo_usd, l.points_earned,
       l.points_redeemed, l.redemptions, l.comp_cents AS ledger_comp_cents,
       pos.comp_cents AS pos_comp_cents, pos.pos_cogs_cents
FROM property_day p JOIN calendar_day c USING (gaming_date)
JOIN meter m USING (gaming_date) JOIN ledger l USING (gaming_date) JOIN pos USING (gaming_date);
"""


def main():
    with connect(
        "player_period", "players", "sessions", "trips", "machine_day", "property_day",
        "calendar_day", "loyalty_ledger", "fnb_transactions",
    ) as connection:
        connection.execute(GUEST_SQL)
        connection.execute(COMP_SQL)
        outcomes = records(connection, f"""
            SELECT 'Carded' AS scope, sum(carded_coin_in_cents)/100 AS coin_in_usd,
                   sum(carded_payout_cents)/100 AS payout_usd,
                   sum(carded_coin_in_cents-carded_payout_cents)/100 AS house_win_usd,
                   sum(carded_theo_cents)/100 AS theo_usd
            FROM machine_day WHERE {ON_FLOOR}
            UNION ALL
            SELECT 'Uncarded', sum(coin_in_cents-carded_coin_in_cents)/100,
                   sum(payout_cents-carded_payout_cents)/100,
                   sum(house_win_cents-carded_coin_in_cents+carded_payout_cents)/100,
                   sum(theo_cents-carded_theo_cents)/100
            FROM machine_day WHERE {ON_FLOOR}
        """)
        tracked = records(connection, """
            SELECT count(*) AS wagering_guests, sum(wager) AS coin_in_usd,
                   sum(payout) AS payout_usd, sum(house_win) AS house_win_usd, sum(theo) AS theo_usd,
                   count_if(house_win < 0) AS guests_ahead
            FROM guest_totals
        """)[0]
        session_rollup = records(connection, """
            SELECT sum(coin_in_usd) AS coin_in_usd, sum(payout_usd) AS payout_usd,
                   sum(house_win_usd) AS house_win_usd, sum(theo_usd) AS theo_usd
            FROM guest_daily
        """)[0]
        for metric in ("coin_in_usd", "payout_usd", "house_win_usd", "theo_usd"):
            if (abs(float(tracked[metric]) - outcomes[0][metric]) > 0.01
                    or abs(session_rollup[metric] - outcomes[0][metric]) > 0.01):
                raise ValueError(f"Carded money does not reconcile for {metric}")
        visits = records(connection, """
            WITH game_visits AS (SELECT DISTINCT observed_visit_id FROM sessions)
            SELECT count(*) AS recorded_visits, count_if(NOT observation_complete) AS incomplete,
                   count(g.observed_visit_id) AS visits_with_sessions
            FROM trips LEFT JOIN game_visits g USING (observed_visit_id)
        """)[0]
        shares = records(connection, """
            SELECT cutoff, max(ceil(n*cutoff)) AS top_players,
                   sum(wager) FILTER (WHERE wager_rank <= ceil(n*cutoff))/max(total_wager)
                       AS wager_share,
                   sum(house_win) FILTER (WHERE loss_rank <= ceil(n*cutoff))/max(total_house_win)
                       AS net_house_win_share,
                   sum(house_win) FILTER (WHERE wager_rank <= ceil(n*cutoff))/max(total_house_win)
                       AS net_house_win_share_top_wagerers
            FROM guest_rank CROSS JOIN (VALUES (0.01), (0.05), (0.10), (0.20)) cut(cutoff)
            GROUP BY cutoff ORDER BY cutoff
        """)
        gini = records(connection, """
            SELECT sum((n+1-2*wager_rank)*wager)/(max(n)*max(total_wager)) AS wager_gini,
                   sum((n+1-2*loss_rank)*greatest(house_win,0))
                       /(max(n)*max(total_positive_loss)) AS positive_loss_gini
            FROM guest_rank
        """)[0]
        lorenz = records(connection, """
            WITH bins AS (
                SELECT floor((n-wager_rank)*100.0/n)::INTEGER + 1 AS bin, count(*) AS guests,
                       sum(wager) AS wager FROM guest_rank GROUP BY bin
            ), losses AS (
                SELECT floor((n-loss_rank)*100.0/n)::INTEGER + 1 AS bin,
                       sum(greatest(house_win,0)) AS loss FROM guest_rank GROUP BY bin
            )
            SELECT sum(guests) OVER (ORDER BY bin) / sum(guests) OVER () AS guest_share,
                   sum(wager) OVER (ORDER BY bin) / sum(wager) OVER () AS wager_share,
                   sum(loss) OVER (ORDER BY bin) / sum(loss) OVER () AS positive_loss_share
            FROM bins JOIN losses USING (bin) ORDER BY bin
        """)
        comp_disagreements = connection.execute("""
            SELECT count_if(abs(comp_cost_usd*100 - ledger_comp_cents) > 0.001
                         OR ledger_comp_cents IS DISTINCT FROM pos_comp_cents
                         OR abs(pos_cogs_usd*100 - pos_cogs_cents) > 0.001)
            FROM comps
        """).fetchone()[0]
        if comp_disagreements:
            raise ValueError("Property, POS and ledger comp costs do not reconcile")
        comp_periods = records(connection, """
            SELECT CASE WHEN grouping(month)=1 THEN 'All' ELSE month END AS period,
                   sum(comp_cost_usd) AS comp_cost_usd, sum(redemptions) AS redemptions,
                   sum(points_earned) AS points_earned, sum(points_redeemed) AS points_redeemed,
                   sum(comp_cost_usd)/sum(carded_theo_usd) AS cost_per_carded_theo,
                   sum(comp_cost_usd)/sum(carded_coin_in_usd) AS cost_per_carded_coin_in
            FROM comps GROUP BY GROUPING SETS ((month), ()) ORDER BY period
        """)
        comp_windows = records(connection, """
            SELECT CASE WHEN gaming_date < DATE '2025-05-01' THEN 'Jan-Apr' ELSE 'May-Jun' END AS period,
                   sum(comp_cost_usd)/count(*) AS comp_cost_per_day,
                   sum(comp_cost_usd)/sum(carded_theo_usd) AS cost_per_carded_theo,
                   sum(redemptions)/count(*) AS redemptions_per_day
            FROM comps GROUP BY ALL ORDER BY period
        """)
        pricing = records(connection, """
            SELECT tier_before AS tier, CASE WHEN gaming_date < DATE '2025-05-01'
                       THEN 'Jan-Apr' ELSE 'May-Jun' END AS period,
                   min(gaming_date) AS first_redemption, max(gaming_date) AS last_redemption,
                   count(*) AS redemptions, sum(economic_cost_cents)/100 AS cost_usd,
                   min(-points_delta*100.0/face_value_cents) AS min_points_per_face_dollar,
                   max(-points_delta*100.0/face_value_cents) AS max_points_per_face_dollar,
                   -sum(points_delta)*100.0/sum(face_value_cents) AS points_per_face_dollar
            FROM ledger_dated WHERE event_type = 'redeem' AND face_value_cents > 0
            GROUP BY ALL ORDER BY tier, period
        """)
        pricing_breaks = records(connection, """
            WITH prices AS (
                SELECT gaming_date, tier_before AS tier, -sum(points_delta)*100.0 /
                    sum(face_value_cents) AS rate
                FROM ledger_dated WHERE event_type = 'redeem' AND face_value_cents > 0
                GROUP BY ALL
            ), differences AS (
                SELECT *, rate - lag(rate) OVER (PARTITION BY tier ORDER BY gaming_date) AS change
                FROM prices
            )
            SELECT tier, gaming_date, change FROM differences WHERE change IS NOT NULL
            QUALIFY row_number() OVER (PARTITION BY tier ORDER BY change, gaming_date) = 1
            ORDER BY tier
        """)
        item_checks = records(connection, """
            WITH item_rates AS (
                SELECT tier_before, benefit_id,
                    min(-points_delta*100.0/face_value_cents)
                        FILTER (WHERE gaming_date < DATE '2025-05-01') AS pre_min,
                    max(-points_delta*100.0/face_value_cents)
                        FILTER (WHERE gaming_date >= DATE '2025-05-01') AS post_max
                FROM ledger_dated WHERE event_type = 'redeem' AND face_value_cents > 0
                GROUP BY ALL
            )
            SELECT count(*) AS matched_tier_benefits, count_if(post_max < pre_min) AS nonoverlapping
            FROM item_rates WHERE pre_min IS NOT NULL AND post_max IS NOT NULL
        """)[0]
        player_contribution = records(connection, """
            SELECT sum(comp_cost_usd) AS card_linked_comp_cost_usd,
                   sum(linked_pos_cogs_usd) AS linked_pos_cogs_usd,
                   sum(-tracked_net_usd + linked_pos_cash_usd - linked_pos_cogs_usd)
                       AS tracked_contribution_usd
            FROM player_period
        """)[0]
        if player_contribution["card_linked_comp_cost_usd"] != comp_periods[-1]["comp_cost_usd"]:
            raise ValueError("Player-period comp costs do not reconcile to the property")
        parquet(connection, "q4_players", "SELECT * FROM guest_daily ORDER BY gaming_date, tier")
        parquet(connection, "q4_guest_days", "SELECT * FROM guest_day_outcomes ORDER BY gaming_date, guest_index")
        parquet(connection, "q5_comps", "SELECT * FROM comps ORDER BY gaming_date")
        parquet(connection, "q5_tiers", "SELECT * FROM tier_redemptions ORDER BY gaming_date, tier")
        write_json("q4_evidence", {
            "tracked": tracked, "outcomes": outcomes, "visits": visits,
            "shares": shares, "gini": gini, "lorenz": lorenz,
        })
        write_json("q5_evidence", {
            "monthly": comp_periods, "windows": comp_windows,
            "pricing": pricing, "breaks": pricing_breaks, "item_checks": item_checks,
            "contribution": player_contribution,
        })
        print("Q4 tracked guests and outcomes:", tracked, outcomes, visits)
        print("Q4 concentration:", shares, gini)
        print("Q5 monthly and full window:", comp_periods)
        print("Q5 pricing break:", pricing_breaks, item_checks, pricing, comp_windows)
        print("Q5 tracked contribution:", player_contribution)


if __name__ == "__main__":
    main()
