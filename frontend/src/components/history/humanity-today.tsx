import { useEffect, useState, type ReactNode, type RefObject } from "react";

import { fetchOccurrences, type Occurrence } from "../../adapters/calendar.js";
import { t } from "../../i18n/index.js";
import { toIsoDate } from "../../lib/dates.js";

type Load =
  | { kind: "loading" }
  | { kind: "ready"; occurrences: Occurrence[] }
  | { kind: "error" };

/**
 * **SRS Revision 205 — «اليوم»: the association's day, as the last station of
 * the path of humanity** (the Owner, 2026-10-07: «a funny way to say that the
 * events of today in the association are part of the big picture»).
 *
 * Today's schedule from the public `GET /calendar` (TD-3.4) — the same read
 * and the same visibility tier as «الجدول الزمني» for this reader, the same
 * device date that page opens on — listed by time, with a link to the whole
 * calendar.
 */
export function TodayInTheAssociation({
  token,
  headingRef,
}: {
  token: string | null;
  headingRef: RefObject<HTMLHeadingElement | null>;
}): ReactNode {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [today] = useState(() => toIsoDate(new Date()));

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    void (async () => {
      try {
        const result = await fetchOccurrences({
          from: today,
          to: today,
          token,
        });
        if (!cancelled) {
          setLoad({
            kind: "ready",
            occurrences: [...result.occurrences].sort((a, b) =>
              (a.start_time ?? "").localeCompare(b.start_time ?? ""),
            ),
          });
        }
      } catch {
        if (!cancelled) setLoad({ kind: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [today, token]);

  return (
    <>
      <header className="humanity__hero tone-root">
        <h2 className="humanity__title" ref={headingRef} tabIndex={-1}>
          {t("content.history.today.title")}
        </h2>
        <p className="humanity__summary">{t("content.history.today.lede")}</p>
      </header>
      {load.kind === "loading" ? (
        <p className="humanity__today-state" role="status">
          {t("content.history.today.loading")}
        </p>
      ) : load.kind === "error" ? (
        <p className="humanity__today-state" role="alert">
          {t("content.history.today.error")}
        </p>
      ) : load.occurrences.length === 0 ? (
        <p className="humanity__today-state">
          {t("content.history.today.empty")}
        </p>
      ) : (
        <ol className="humanity__today">
          {load.occurrences.map((item) => (
            <li key={`${item.kind}-${item.id}-${item.date}`}>
              <span className="humanity__today-time">
                {item.start_time
                  ? `${item.start_time.slice(0, 5)}${item.end_time ? ` – ${item.end_time.slice(0, 5)}` : ""}`
                  : t("content.history.today.allDay")}
              </span>
              {/* The class's subject or the event's name; the generated
                  item title repeats the date this list already says. */}
              <span className="humanity__today-title">{item.title}</span>
              <span className="humanity__today-meta">
                {[
                  item.scheduling_type_name,
                  item.audience_label,
                  item.branch_name,
                  item.room_name,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="humanity__today-more">
        <a href="/calendar">{t("content.history.today.calendar")}</a>
      </p>
    </>
  );
}
