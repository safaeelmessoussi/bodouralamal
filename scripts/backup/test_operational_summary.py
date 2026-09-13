import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location("summary", pathlib.Path(__file__).with_name("operational-summary.py"))
summary = importlib.util.module_from_spec(spec)
spec.loader.exec_module(summary)


class OperationalSummaryTest(unittest.TestCase):
    def setUp(self):
        self.health = dict(status="ok", components={key: "ok" for key in ["database", "storage", "queue", "jobs"]},
                           details=dict(jobs=dict(state="ok", expected_workers=9, registered_workers=9, active_workers=9)))
        self.backlog = {key: 0 for key in ["retirements_pending", "retirements_failed", "retirements_late",
                                         "copy_unknown", "failed_jobs", "late_jobs"]}

    def test_healthy_platform(self):
        self.assertEqual(summary.problems(self.health, self.backlog), [])

    def test_green_workers_cannot_hide_retirement_failure(self):
        self.backlog["retirements_failed"] = 1
        self.assertEqual(summary.problems(self.health, self.backlog), ["RETIREMENT_FAILURE"])

    def test_missing_worker(self):
        self.health["details"]["jobs"]["active_workers"] = 8
        self.assertIn("WORKERS_DOWN", summary.problems(self.health, self.backlog))

    def test_unknown_copy_and_overdue_work(self):
        for field in ["copy_unknown", "retirements_late", "failed_jobs", "late_jobs"]:
            self.backlog[field] = 1
        self.assertEqual(summary.problems(self.health, self.backlog),
                         ["TERMINAL_JOBS", "QUEUE_LAG", "RETIREMENT_OVERDUE", "COPY_OUTCOME_UNKNOWN"])

    def test_missing_aggregate_fails_closed(self):
        del self.backlog["late_jobs"]
        with self.assertRaises(ValueError):
            summary.problems(self.health, self.backlog)

    def test_nonoverdue_pending_work_reported_without_false_failure(self):
        self.backlog["retirements_pending"] = 1
        self.assertEqual(summary.problems(self.health, self.backlog), [])


if __name__ == "__main__":
    unittest.main()
