"""Price two July interventions and separate evidence from scenario assumptions."""

import json
from datetime import date, timedelta

from pipeline_io import ON_FLOOR, OUTPUT, connect, parquet, records, write_json


BUDGET_USD = 100_000
HORIZON = 30
JULY_START = date(2025, 7, 1)
SCENARIOS = ("low", "base", "high")


def main():
    with connect("action_catalog", "cost_rules", "prepared_daily_view") as connection:
        catalog = {row["action_type_id"]: row for row in records(connection, "SELECT * FROM action_catalog")}
        rules = {row["cost_rule_id"]: row for row in records(connection, "SELECT * FROM cost_rules")}
        connection.read_parquet(str(OUTPUT / "q1_machines.parquet")).create_view("diagnostics")
        inspection_z = connection.execute("""
            SELECT payout_z FROM diagnostics WHERE machine_id = 'M-1158' AND payout_inspection
        """).fetchone()
        if not inspection_z:
            raise ValueError("M-1158 did not meet the payout inspection screen")
        revenue_share = float(rules["CR-LEASE-SHARE"]["rate"])
        june_zone = records(connection, f"""
            SELECT count(DISTINCT gaming_date) AS days, sum(available_hours) AS hours,
                   sum(coin_in_usd) AS coin_in_usd, sum(theo_usd) AS theo_usd,
                   sum(theo_usd) FILTER (WHERE lease_class = 'leased_revenue_share') AS share_theo_usd
            FROM prepared_daily_view WHERE {ON_FLOOR} AND zone_id = 'Z-B40' AND month = '2025-06'
        """)[0]
        june_machine = records(connection, f"""
            SELECT count(*) AS days, sum(available_hours) AS hours,
                   sum(theo_usd) AS theo_usd, sum(theo_usd-house_win_usd) AS gap_usd,
                   count_if(lease_class <> 'owned') AS not_owned_days
            FROM prepared_daily_view WHERE {ON_FLOOR} AND machine_id = 'M-1158' AND month = '2025-06'
        """)[0]
        if june_machine["not_owned_days"]:
            raise ValueError("Recalculate inspection benefits for the machine's lease terms")
        q2 = json.loads((OUTPUT / "q2_evidence.json").read_text(encoding="utf-8"))
        pre_rate = next(row["coin_in_per_available_hour"] for row in q2["closure"]
                        if row["area"] == "Back Forty" and row["phase"] == "Before")
        june_rate = float(june_zone["coin_in_usd"]) / june_zone["hours"]
        june_adjusted_theo = float(june_zone["theo_usd"]) - revenue_share * float(june_zone["share_theo_usd"])
        zone_daily_headroom = (
            max(0, pre_rate - june_rate) * june_zone["hours"] / june_zone["days"]
            * june_adjusted_theo / float(june_zone["coin_in_usd"])
        )
        inspection_gap_per_day = max(0, float(june_machine["gap_usd"]) / june_machine["days"])
        inspection_downtime = (catalog["A-INSPECT"]["downtime_minutes"] / 60
                               * float(june_machine["theo_usd"]) / june_machine["hours"])
        selected = [
            {
                "action_type_id": "A-INSPECT", "target": "M-1158 · B-31 · Back Forty",
                "quantity": 1, "evidence_link": "inspection",
                "evidence": f"June shortfall of {june_machine['gap_usd']:,.2f} USD over "
                            f"{june_machine['days']} active days. Full-window z = {inspection_z[0]:.3f}.",
                "assumptions": "Use June's observed gap as a daily proxy. Assume a 0% / 50% / 80% chance "
                               "of verifying a correctable issue and restoring the full gap in-package. "
                               "Deduct two hours of expected theo in each case. This prices the inspection package.",
                "measurement": "Verify the configured paytable, denomination and meter reconciliation "
                               "before any adjustment. If an authorized correction is made, track daily "
                               "hold minus configured hold, bet-weighted payout z and availability for "
                               "29 days against comparable G-STD90 machines. Record the inspection outcome.",
                "gross": lambda days: [
                    days * inspection_gap_per_day * probability - inspection_downtime
                    for probability in (0.0, 0.50, 0.80)
                ],
            },
            {
                "action_type_id": "A-WAYFINDING", "target": "Back Forty · Main Entrance approach",
                "quantity": 1, "evidence_link": "wayfinding",
                "evidence": f"Back Forty took {pre_rate:.2f} USD per available hour pre-closure and "
                            f"{june_rate:.2f} in June. June availability and game mix set the scale.",
                "assumptions": "Recover 10% / 40% / 65% of the hourly gap. Retain 50% / 65% / 80% "
                               "after displacement. Convert handle to theo at June game mix and deduct "
                               "the 20% lease share on the revenue-share mix as a contribution proxy.",
                "measurement": "Install at the Main Entrance approach. Compare Back Forty with the "
                               "other zones on matching weekdays before and after activation. Track "
                               "entries per valid sensor hour, wagers per available machine-hour and "
                               "floor-wide theo after lease share. Flag displaced play and competing events.",
                "gross": lambda days: [
                    days * zone_daily_headroom * recovery * retained
                    for recovery, retained in ((0.10, 0.50), (0.40, 0.65), (0.65, 0.80))
                ],
            },
        ]
        plan, groups = [], set()
        for action in selected:
            item = catalog[action["action_type_id"]]
            quantity = action["quantity"]
            group = item["incompatibility_group"]
            if not 0 < quantity <= item["quantity_limit"] or (group and group in groups):
                raise ValueError(f"Ineligible action: {item['action_type_id']}")
            if group:
                groups.add(group)
            lead = item["lead_days"]
            active = max(0, HORIZON - lead)
            cost_cents = quantity * (item["unit_cost_cents"] + item["recurring_cost_cents_per_day"] * active)
            item_result = {key: value for key, value in action.items() if key != "gross"}
            item_result.update({
                "name": item["name"], "unit_cost_cents": item["unit_cost_cents"],
                "recurring_cost_cents_per_day": item["recurring_cost_cents_per_day"],
                "quantity_limit": item["quantity_limit"], "lead_days": lead,
                "active_days": active, "activation_date": JULY_START + timedelta(days=lead),
                "downtime_minutes": item["downtime_minutes"], "cost_usd": cost_cents / 100,
            })
            for scenario, gross in zip(SCENARIOS, action["gross"](active)):
                net = gross - cost_cents / 100
                item_result[f"gross_{scenario}_usd"] = gross
                item_result[f"net_{scenario}_usd"] = net
                item_result[f"roi_{scenario}"] = net / (cost_cents / 100)
            plan.append(item_result)
        spent = sum(action["cost_usd"] for action in plan)
        if len(plan) > 3 or spent > BUDGET_USD:
            raise ValueError("Budget or action limit exceeded")
        summary = {
            "budget_usd": BUDGET_USD, "spent_usd": spent, "retained_usd": BUDGET_USD - spent,
            **{f"net_{scenario}_usd": sum(action[f"net_{scenario}_usd"] for action in plan)
               for scenario in SCENARIOS},
            "window": "July 1–30, 2025",
            "actions": plan,
        }
        write_json("q6_budget_plan", summary)
        connection.read_json(str(OUTPUT / "q6_budget_plan.json")).create_view("budget")
        parquet(connection, "q6_budget_plan", "SELECT unnest(actions, recursive := true) FROM budget")
        print("Q6 priced portfolio:", json.dumps(summary, default=str, ensure_ascii=True))


if __name__ == "__main__":
    main()
