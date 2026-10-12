import { useEffect, useState, type ReactNode, type RefObject } from "react";

import {
  fetchCalendarBootstrap,
  fetchOccurrences,
  type Occurrence,
} from "../../adapters/calendar.js";
import { t } from "../../i18n/index.js";
import { toIsoDate } from "../../lib/dates.js";
import { occurrenceSurahs, shortSurahList } from "../../lib/surah-list.js";

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
 *
 * **R208 — the women's Category only, each item with its Level and Surahs.**
 * «المرأة» is the Category whose beneficiaries hold their own login
 * (`holds_own_login`, R170 §6) — a fact about the Category, never a match on
 * its name (§4.4b); no such Category, no items. The Surahs are the item's own,
 * else its Level's for a Subject that works by Surah, shortened past four.
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
        const chrome = await fetchCalendarBootstrap({ from: today, to: today });
        const women = chrome.categories
          .filter((category) => category.holds_own_login === true)
          .map((category) => category.id);
        const pages = await Promise.all(
          women.map((categoryId) =>
            fetchOccurrences({ from: today, to: today, token, categoryId }),
          ),
        );
        const seen = new Set<string>();
        const occurrences = pages
          .flatMap((page) => page.occurrences)
          .filter((item) => {
            const key = `${item.kind}-${item.id}-${item.date}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          })
          .sort((a, b) =>
            (a.start_time ?? "").localeCompare(b.start_time ?? ""),
          );
        if (!cancelled) setLoad({ kind: "ready", occurrences });
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
              {/* R220 — what is taught, its Surahs beside it («تفسير القرآن —
                  سورة المائدة»); then who, where — each said once (the circle
                  is no longer both in the title and below it). */}
              <span className="humanity__today-title">{titleOf(item)}</span>
              <span className="humanity__today-meta">
                {[
                  levelsOf(item),
                  item.audience_name,
                  item.branch_name,
                  // The room's name alone («1») read as a stray number.
                  item.room_name ? `${t("calendar.detailsRoom")} ${item.room_name}` : null,
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

/** The Level(s) the item is for; the Category when it names no Level. */
function levelsOf(item: Occurrence): string | null {
  const levels = item.level_names?.length
    ? item.level_names
    : item.level_name
      ? [item.level_name]
      : [];
  if (levels.length > 0) return levels.join("، ");
  return item.category_names?.join("، ") || item.category_name || null;
}

/** R208 — «سورة X», or «السور: …» shortened past four. */
function surahsOf(item: Occurrence): string | null {
  const surahs = occurrenceSurahs(item);
  if (surahs.length === 0) return null;
  return surahs.length === 1
    ? t("calendar.chipSurah").replace("{surah}", surahs[0]!)
    : t("calendar.chipSurahs").replace("{surahs}", shortSurahList(surahs));
}

/** R220 — a class: its Subject, and its Surahs when it names any; an event: its name. */
function titleOf(item: Occurrence): string {
  const surahs = surahsOf(item);
  const head = item.subject_name ?? item.title;
  return surahs ? `${head} — ${surahs}` : head;
}
