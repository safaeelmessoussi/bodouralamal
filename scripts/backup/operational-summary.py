"""Operator-only aggregate health; never emit job payloads or storage locators."""
import json
import sys


def problems(health, backlog):
    result = []
    if health.get("status") != "ok" or any(health.get("components", {}).get(key) != "ok"
                                            for key in ["database", "storage", "queue", "jobs"]):
        result.append("PLATFORM_DEPENDENCY_DOWN")
    workers = health.get("details", {}).get("jobs", {})
    if (workers.get("state") != "ok" or workers.get("expected_workers", 0) < 1
            or workers.get("expected_workers") != workers.get("active_workers")
            or workers.get("expected_workers") != workers.get("registered_workers")):
        result.append("WORKERS_DOWN")
    for key, code in [("failed_jobs", "TERMINAL_JOBS"), ("late_jobs", "QUEUE_LAG"),
                      ("retirements_failed", "RETIREMENT_FAILURE"),
                      ("retirements_late", "RETIREMENT_OVERDUE"),
                      ("copy_unknown", "COPY_OUTCOME_UNKNOWN")]:
        if key not in backlog or not isinstance(backlog[key], int) or backlog[key] < 0:
            raise ValueError("missing aggregate")
        if backlog[key]:
            result.append(code)
    return result


if __name__ == "__main__":
    try:
        value = json.load(sys.stdin)
        alerts = problems(value["health"], value["backlog"])
        print("operator-check: " + (",".join(alerts) if alerts else "PLATFORM_OK"))
        print("operator-check: " + " ".join(f"{key}={value['backlog'][key]}" for key in
              ["retirements_pending", "retirements_failed", "retirements_late", "copy_unknown", "failed_jobs", "late_jobs"]))
        sys.exit(1 if alerts else 0)
    except (KeyError, ValueError, TypeError):
        sys.exit("operator-check: AGGREGATE_PROBE_FAILED")
