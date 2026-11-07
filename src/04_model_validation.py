"""Evaluate a frozen calendar forecast and produce the July staffing signal."""

from datetime import date, timedelta

import numpy as np

from pipeline_io import connect, parquet, records, write_json


START = date(2025, 1, 1)
HOLDOUT = date(2025, 5, 1)
JULY = date(2025, 7, 1)
EVENT_TYPES = ("convention", "sports_viewing", "festival", "property_promotion")
WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
VALIDATION_FOLDS = (date(2025, 2, 1), date(2025, 3, 1), date(2025, 4, 1), HOLDOUT)
CANDIDATES = ((0.5, False), (2.0, False), (8.0, False), (2.0, True), (8.0, True))


def calendar_features(rows, events, origin, trend):
    # The frozen forecast knows only calendar inputs and events announced before origin.
    known = [event for event in events if event["announced_date"] < origin]
    features = []
    for row in rows:
        day = row["gaming_date"]
        active_types = {
            event["event_type"] for event in known
            if event["announced_date"] < day and event["start_date"] <= day <= event["end_date"]
        }
        values = [1.0, *(day.weekday() == i for i in range(7)),
                  *(kind in active_types for kind in EVENT_TYPES)]
        if trend:
            values.append((day - START).days / 30)
        features.append(values)
    return np.asarray(features, dtype=float)


def forecast(training, targets, events, origin, alpha, trend):
    x = calendar_features(training, events, origin, trend)
    y = np.array([float(row["coin_in_usd"]) * 86400 / row["scheduled_seconds"] for row in training])
    regularization = np.eye(x.shape[1]) * alpha
    regularization[0, 0] = 0
    coefficients = np.linalg.solve(x.T @ x + regularization, x.T @ y)
    days = calendar_features(targets, events, origin, trend)
    return (days @ coefficients) * np.array([row["scheduled_seconds"] / 86400 for row in targets])


def errors(actual, predicted):
    residual = np.asarray(actual) - np.asarray(predicted)
    return {"mae_usd": float(np.mean(abs(residual))), "rmse_usd": float(np.sqrt(np.mean(residual**2)))}


def score_candidates(training, events):
    candidates = []
    for alpha, trend in CANDIDATES:
        actual, predictions = [], []
        for origin, end in zip(VALIDATION_FOLDS, VALIDATION_FOLDS[1:]):
            past = [row for row in training if row["gaming_date"] < origin]
            forward = [row for row in training if origin <= row["gaming_date"] < end]
            actual.extend(float(row["coin_in_usd"]) for row in forward)
            predictions.extend(forecast(past, forward, events, origin, alpha, trend))
        candidates.append({"alpha": alpha, "trend": trend, **errors(actual, predictions)})
    return candidates


def main():
    with connect("property_day", "calendar_day", "events") as connection:
        history = records(connection, """
            SELECT gaming_date, scheduled_seconds, coin_in_usd
            FROM property_day JOIN calendar_day USING (gaming_date)
            ORDER BY gaming_date
        """)
        events = records(connection, "SELECT * FROM events")
        training = [row for row in history if START <= row["gaming_date"] < HOLDOUT]
        holdout = [row for row in history if HOLDOUT <= row["gaming_date"] < JULY]
        if len(training) != 120 or len(holdout) != 61:
            raise ValueError("Training or holdout dates are incomplete")
        candidates = score_candidates(training, events)
        choice = min(candidates, key=lambda candidate: candidate["mae_usd"])
        mean = sum(float(row["coin_in_usd"]) for row in training) / len(training)
        weekday = {}
        for index in range(7):
            values = [float(row["coin_in_usd"]) for row in training
                      if row["gaming_date"].weekday() == index]
            weekday[index] = sum(values) / len(values)
        july_rows = [{"gaming_date": JULY + timedelta(days=i), "scheduled_seconds": 86400}
                     for i in range(30)]
        predictions = forecast(
            training, history + july_rows, events, HOLDOUT, choice["alpha"], choice["trend"]
        )
        actual = [float(row["coin_in_usd"]) for row in holdout]
        results = {
            "constant_baseline": errors(actual, [mean] * len(holdout)),
            "weekday_baseline": errors(actual, [weekday[row["gaming_date"].weekday()] for row in holdout]),
            "model": errors(actual, predictions[len(training):len(history)]),
        }
        connection.execute("""
            CREATE TEMP TABLE model (
                gaming_date DATE, split VARCHAR, actual_usd DOUBLE, constant_baseline_usd DOUBLE,
                weekday_baseline_usd DOUBLE, forecast_usd DOUBLE
            )
        """)
        connection.executemany("INSERT INTO model VALUES (?, ?, ?, ?, ?, ?)", [
            (row["gaming_date"], "Training fit" if i < len(training) else
             "Holdout" if i < len(history) else "July forecast",
             float(row["coin_in_usd"]) if i < len(history) else None,
             mean, weekday[row["gaming_date"].weekday()], float(predictions[i]))
            for i, row in enumerate(history + july_rows)
        ])
        july_weekdays = records(connection, """
            SELECT dayname(gaming_date) AS weekday, count(*) AS dates,
                   sum(forecast_usd)/count(*) AS forecast_usd_per_day,
                   sum(weekday_baseline_usd)/count(*) AS weekday_baseline_usd_per_day
            FROM model WHERE split = 'July forecast' GROUP BY ALL ORDER BY forecast_usd_per_day DESC
        """)
        # Include the simple weekday baseline in the deployment gate.
        deployment = min(results, key=lambda name: results[name]["mae_usd"])
        parquet(connection, "model_results", "SELECT * FROM model ORDER BY gaming_date")
        write_json("model_evidence", {
            "training_days": len(training), "holdout_days": len(holdout), "metrics": results,
            "candidate_scores": candidates, "selected": choice, "deployment": deployment,
            "july_weekdays": july_weekdays, "event_types": EVENT_TYPES,
            "excluded_holdout_events": [event["name"] for event in events
                                        if event["announced_date"] >= HOLDOUT],
        })
        print("Model forward-only training folds:", candidates)
        print("May-June holdout:", results, "July deployment:", deployment)
        print("July weekday staffing forecast:", july_weekdays)


if __name__ == "__main__":
    main()
