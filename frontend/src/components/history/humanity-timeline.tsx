import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { t } from "../../i18n/index.js";
import { counted } from "../../lib/arabic-years.js";
import { ButtonLink } from "../ui/button.js";
import { EXPEDITIONS, HUMANITY, PHASES, TIMELINE } from "./humanity-data.js";
import { HumanityDiagram, Verse } from "./humanity-diagram.js";
import { humanityDictionary, localiseHumanity } from "./humanity-i18n.js";
import {
  TODAY,
  descendantCount,
  detailSections,
  parsePath,
  resolvePath,
  type HistoryNode,
  type TimelineDetail,
  type TimelineMarker,
  type TimelineSpan,
} from "./humanity-model.js";
import { TodayInTheAssociation } from "./humanity-today.js";

/** R209 — the content in this page's language (Arabic when none is loaded). */
const LOCAL = localiseHumanity(
  { root: HUMANITY, timeline: TIMELINE, phases: PHASES, expeditions: EXPEDITIONS },
  humanityDictionary(),
);

/** `?node=` read as an address: a node of the tree, or «اليوم» (R205). */
function readPath(root: HistoryNode, raw: string | null): string[] {
  return raw === TODAY ? [TODAY] : parsePath(root, raw);
}

/**
 * **SRS Revision 203 — «نظرة شاملة»** (the Owner, 2026-10-07; «مسيرة
 * البشرية» until R204): the whole path of humanity, from Adam عليه السلام to
 * today, read from the general to the particular.
 *
 * - On top, the timeline: the three eras as bands, then each station with its
 *   Gregorian and Hijri year (the platform's two calendar colours, named once
 *   at the start of the line). A station opens its node.
 * - Under it, the three eras as cards — no title between them, so the line
 *   and the cards are read in one view (R204); a card opens its era, every
 *   node opens its children in one row of compact cards, and so on down to a
 *   prophet, a Surah, an imam — each with its text read as sections, and a
 *   Surah with its axes drawn as diagrams. A Surah opens «حسب السورة» on
 *   itself.
 * - Where the reader is lives in the address (`?view=history&node=a/b`), so
 *   the browser's back button walks back up and a link opens the same node.
 */
export function HumanityTimeline({
  root = LOCAL.root,
  markers = LOCAL.timeline,
  phases = LOCAL.phases,
  expeditions = LOCAL.expeditions,
  token = null,
}: {
  root?: HistoryNode;
  markers?: TimelineMarker[];
  phases?: TimelineSpan[];
  expeditions?: TimelineDetail[];
  /** The reader's token, for «اليوم»'s schedule at their visibility (R205). */
  token?: string | null;
}): ReactNode {
  const [path, setPath] = useState<string[]>(() =>
    readPath(root, new URLSearchParams(window.location.search).get("node")),
  );
  const heading = useRef<HTMLHeadingElement | null>(null);
  const moved = useRef(false);

  useEffect(() => {
    const onPop = (): void =>
      setPath(
        readPath(root, new URLSearchParams(window.location.search).get("node")),
      );
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [root]);

  const go = useCallback((next: string[]) => {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "history");
    if (next.length === 0) url.searchParams.delete("node");
    else url.searchParams.set("node", next.join("/"));
    window.history.pushState(null, "", url);
    moved.current = true;
    setPath(next);
  }, []);

  // After a move the new heading takes the focus, so a keyboard or a screen
  // reader lands where the eye does — and the stage scrolls into view.
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [path]);

  const isToday = path[0] === TODAY;
  const trail = useMemo(() => resolvePath(root, path), [root, path]);
  const node = trail[trail.length - 1] ?? root;
  const eraId = path[0] ?? null;
  const parent = trail.length > 1 ? trail[trail.length - 2] : null;
  const siblings = parent?.children ?? [];
  const at = siblings.findIndex((sibling) => sibling.id === node.id);

  return (
    <div className="humanity">
      <TimelineAxis
        markers={markers}
        phases={phases}
        expeditions={expeditions}
        path={path}
        eraId={eraId}
        onOpen={(target) => go(target.split("/"))}
      />

      {isToday ? (
        <nav
          className="humanity__trail"
          aria-label={t("content.history.trailLabel")}
        >
          <ol>
            <li>
              <button
                type="button"
                className="humanity__crumb"
                onClick={() => go([])}
              >
                {t("content.views.history")}
              </button>
            </li>
            <li>
              <span
                className="humanity__crumb is-current"
                aria-current="location"
              >
                {t("content.history.today.title")}
              </span>
            </li>
          </ol>
        </nav>
      ) : path.length > 0 ? (
        <nav
          className="humanity__trail"
          aria-label={t("content.history.trailLabel")}
        >
          <ol>
            {trail.map((step, index) => (
              <li key={step.id}>
                {index < trail.length - 1 ? (
                  <button
                    type="button"
                    className="humanity__crumb"
                    onClick={() => go(path.slice(0, index))}
                  >
                    {index === 0 ? t("content.views.history") : step.title}
                  </button>
                ) : (
                  <span
                    className="humanity__crumb is-current"
                    aria-current="location"
                  >
                    {index === 0 ? t("content.views.history") : step.title}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      ) : null}

      <section
        className={`humanity__stage tone-${node.tone}`}
        key={path.join("/") || "root"}
        aria-live="polite"
      >
        {isToday ? (
          <TodayInTheAssociation token={token} headingRef={heading} />
        ) : path.length === 0 ? (
          <EraCards
            root={root}
            headingRef={heading}
            onOpen={(id) => go([id])}
          />
        ) : (
          <>
            <NodeHero node={node} headingRef={heading} />
            {/* The children first, right under the header, so the timeline
                and the next step are read in one view (R204); the text and
                the diagrams follow. */}
            {node.children && node.children.length > 0 ? (
              <ol className="humanity__path">
                {node.children.map((child, index) => (
                  <li key={child.id}>
                    <NodeCard
                      node={child}
                      index={index}
                      onOpen={() => go([...path, child.id])}
                    />
                  </li>
                ))}
              </ol>
            ) : null}
            {node.lines && node.lines.length > 0 ? (
              <Details lines={node.lines} />
            ) : null}
            {node.diagrams && node.diagrams.length > 0 ? (
              <div className="humanity__diagrams">
                {node.diagrams.map((diagram) => (
                  <HumanityDiagram key={diagram.title} diagram={diagram} />
                ))}
              </div>
            ) : null}
            {siblings.length > 1 ? (
              <div className="humanity__steps">
                {at > 0 ? (
                  <button
                    type="button"
                    className="humanity__step"
                    onClick={() =>
                      go([...path.slice(0, -1), siblings[at - 1]!.id])
                    }
                  >
                    <span className="humanity__step-arrow" aria-hidden="true">
                      →
                    </span> {siblings[at - 1]!.title}
                  </button>
                ) : (
                  <span />
                )}
                {at < siblings.length - 1 ? (
                  <button
                    type="button"
                    className="humanity__step is-next"
                    onClick={() =>
                      go([...path.slice(0, -1), siblings[at + 1]!.id])
                    }
                  >
                    {siblings[at + 1]!.title} <span className="humanity__step-arrow" aria-hidden="true">
                      ←
                    </span>
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}

/* ── The timeline on top ────────────────────────────────────────────────── */

function TimelineAxis({
  markers,
  phases,
  expeditions,
  path,
  eraId,
  onOpen,
}: {
  markers: TimelineMarker[];
  phases: TimelineSpan[];
  expeditions: TimelineDetail[];
  path: string[];
  eraId: string | null;
  onOpen: (node: string) => void;
}): ReactNode {
  const here = path.join("/");
  // The eras' bands span the stations that belong to them, in order.
  const spans = (["prophets", "seal", "ummah"] as const).map((tone) => {
    const owned = markers
      .map((m, i) => (m.tone === tone ? i : -1))
      .filter((i) => i >= 0);
    return {
      tone,
      id: tone,
      from: owned[0] ?? 0,
      to: owned[owned.length - 1] ?? 0,
    };
  });
  return (
    <div
      className="humanity__axis-scroll"
      role="group"
      aria-label={t("content.history.timeline")}
    >
      <div
        className="humanity__axis"
        style={{ ["--stations" as string]: String(markers.length) }}
      >
        {/* The two calendars, named once at the start of the line, in the
            stations' own shape so each name sits on its row of years. */}
        <div className="humanity__legend" aria-hidden="true">
          <span className="humanity__year is-gregorian">
            {t("content.history.gregorian")}
          </span>
          <span className="humanity__dot is-blank" />
          <span className="humanity__year is-hijri">
            {t("content.history.hijri")}
          </span>
        </div>
        {markers.map((marker, index) => {
          const active =
            marker.node !== undefined &&
            (here === marker.node || here.startsWith(`${marker.node}/`));
          const body = (
            <>
              {/* A station with no year (Adam) keeps its rows, unlabelled. */}
              <span
                className={`humanity__year is-gregorian${marker.gregorian ? "" : " is-blank"}`}
              >
                {marker.gregorian || "—"}
              </span>
              <span
                className={`humanity__dot tone-${marker.tone}`}
                aria-hidden="true"
              />
              <span
                className={`humanity__year is-hijri${marker.hijri ? "" : " is-blank"}`}
              >
                {marker.hijri || "—"}
              </span>
              <span className="humanity__station-label">{marker.label}</span>
            </>
          );
          return marker.node ? (
            <button
              key={`${marker.label}-${index}`}
              type="button"
              className={`humanity__station tone-${marker.tone}${active ? " is-active" : ""}${index === markers.length - 1 ? " is-last" : ""}`}
              style={{ gridColumn: String(index + 2) }}
              onClick={() => onOpen(marker.node!)}
              aria-current={active ? "location" : undefined}
            >
              {body}
            </button>
          ) : (
            <div
              key={`${marker.label}-${index}`}
              className={`humanity__station tone-${marker.tone}${index === markers.length - 1 ? " is-last" : ""}`}
              style={{ gridColumn: String(index + 2) }}
            >
              {body}
            </div>
          );
        })}
        {spans.map((span) => (
          <button
            key={span.id}
            type="button"
            className={`humanity__band tone-${span.tone}${eraId === span.id ? " is-active" : ""}`}
            // The first band also covers the calendars' column: room for its name.
            style={{
              gridColumn: `${span.from === 0 ? 1 : span.from + 2} / ${span.to + 3}`,
            }}
            onClick={() => onOpen(span.id)}
          >
            {t(`content.history.era.${span.id}`)}
          </button>
        ))}
        {phases.map((phase) => (
          <PhaseLine
            key={phase.node}
            phase={phase}
            active={here === phase.node || here.startsWith(`${phase.node}/`)}
            onOpen={onOpen}
          />
        ))}
        <ExpeditionLine
          phase={phases.find((p) => p.node === "seal/madani")}
          expeditions={expeditions}
          stations={markers.length}
          here={here}
          onOpen={onOpen}
        />
      </div>
    </div>
  );
}

/**
 * **The second line (R205): a phase leaves the main line between its two
 * stations** — drawn from the middle of one station's column to the middle of
 * the other's, one level under the line.
 */
function PhaseLine({
  phase,
  active,
  onOpen,
}: {
  phase: TimelineSpan;
  active: boolean;
  onOpen: (node: string) => void;
}): ReactNode {
  const columns = phase.to - phase.from + 1;
  return (
    <button
      type="button"
      className={`humanity__phase tone-${phase.tone}${active ? " is-active" : ""}`}
      style={{
        gridColumn: `${String(phase.from + 2)} / ${String(phase.to + 3)}`,
        ["--span" as string]: String(columns),
      }}
      onClick={() => onOpen(phase.node)}
      title={`${phase.label} — ${phase.sub}`}
    >
      <span className="humanity__phase-label">{phase.label}</span>
    </button>
  );
}

/**
 * **The third line (R205): the expeditions, as a zoom of the Medinan phase.**
 * Ten years in one column cannot hold seven names, so the phase opens into a
 * wider strip under the stations that follow it — a wedge from the phase down
 * to the strip says it is the same ten years, drawn larger.
 */
function ExpeditionLine({
  phase,
  expeditions,
  stations,
  here,
  onOpen,
}: {
  phase: TimelineSpan | undefined;
  expeditions: TimelineDetail[];
  stations: number;
  here: string;
  onOpen: (node: string) => void;
}): ReactNode {
  if (!phase || expeditions.length === 0) return null;
  const start = phase.from + 2;
  const width = Math.min(expeditions.length, stations + 2 - start);
  const area = {
    gridColumn: `${String(start)} / ${String(start + width)}`,
    ["--n" as string]: String(width),
    ["--far" as string]: String(phase.to - phase.from + 0.5),
  };
  return (
    <>
      <span
        className={`humanity__zoom tone-${phase.tone}`}
        style={area}
        aria-hidden="true"
      />
      <ol
        className={`humanity__expeditions tone-${phase.tone}`}
        style={area}
        aria-label={t("content.history.expeditions")}
      >
        {expeditions.map((item) => {
          const active = here === item.node;
          return (
            <li key={item.node}>
              <button
                type="button"
                className={`humanity__expedition${active ? " is-active" : ""}`}
                onClick={() => onOpen(item.node)}
                aria-current={active ? "location" : undefined}
                title={`${item.gregorian} — ${item.hijri}`}
              >
                <span className="humanity__expedition-dot" aria-hidden="true" />
                <span className="humanity__expedition-label">{item.label}</span>
                <span className="humanity__expedition-year">{item.hijri}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

/* ── The three eras ─────────────────────────────────────────────────────── */

function EraCards({
  root,
  headingRef,
  onOpen,
}: {
  root: HistoryNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onOpen: (id: string) => void;
}): ReactNode {
  return (
    <>
      {/* Named for a screen reader only: on screen the timeline above says it. */}
      <h2
        className="humanity__title visually-hidden"
        ref={headingRef}
        tabIndex={-1}
      >
        {t("content.history.erasTitle")}
      </h2>
      <ol className="humanity__eras">
        {(root.children ?? []).map((era, index) => (
          <li key={era.id}>
            <button
              type="button"
              className={`humanity__era tone-${era.tone}`}
              onClick={() => onOpen(era.id)}
            >
              <span className="humanity__era-index" aria-hidden="true">
                {index + 1}
              </span>
              <span className="humanity__era-title">{era.title}</span>
              {era.subtitle ? (
                <span className="humanity__era-subtitle">{era.subtitle}</span>
              ) : null}
              <When when={era.when} />
              <span className="humanity__count">
                {counted("content.history.items", descendantCount(era))}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

/* ── One node ───────────────────────────────────────────────────────────── */

function When({ when }: { when?: HistoryNode["when"] }): ReactNode {
  if (!when || (!when.gregorian && !when.hijri)) return null;
  return (
    <span className="humanity__when">
      {when.gregorian ? (
        <span className="humanity__year is-gregorian">{when.gregorian}</span>
      ) : null}
      {when.hijri ? (
        <span className="humanity__year is-hijri">{when.hijri}</span>
      ) : null}
    </span>
  );
}

function NodeHero({
  node,
  headingRef,
}: {
  node: HistoryNode;
  headingRef: RefObject<HTMLHeadingElement | null>;
}): ReactNode {
  return (
    <header className={`humanity__hero tone-${node.tone}`}>
      {node.when?.order ? (
        <span className="humanity__order">{node.when.order}</span>
      ) : null}
      <h2 className="humanity__title" ref={headingRef} tabIndex={-1}>
        {node.title}
      </h2>
      {node.subtitle ? (
        <p className="humanity__subtitle">{node.subtitle}</p>
      ) : null}
      <span className="humanity__hero-meta">
        <When when={node.when} />
        {node.badge ? (
          <span className="humanity__badge">{node.badge}</span>
        ) : null}
      </span>
      {node.summary ? (
        <p className="humanity__summary">{node.summary}</p>
      ) : null}
      {node.surah ? (
        // R210 — the way deeper, said before the button.
        <span className="humanity__surah-lead">
          {t("content.history.openSurahLead")}
        </span>
      ) : null}
      {node.surah ? (
        <ButtonLink
          variant="primary"
          className="humanity__surah"
          href={`/resources?surah=${String(node.surah)}`}
        >
          {t("content.history.openSurah")}
        </ButtonLink>
      ) : null}
    </header>
  );
}

function NodeCard({
  node,
  index,
  onOpen,
}: {
  node: HistoryNode;
  index: number;
  onOpen: () => void;
}): ReactNode {
  const inside = descendantCount(node);
  return (
    <button
      type="button"
      className={`humanity__card tone-${node.tone}`}
      onClick={onOpen}
    >
      <span className="humanity__card-index" aria-hidden="true">
        {node.when?.order ?? index + 1}
      </span>
      <span className="humanity__card-title">{node.title}</span>
      {node.subtitle ? (
        <span className="humanity__card-subtitle">{node.subtitle}</span>
      ) : null}
      <When when={node.when} />
      <span className="humanity__card-foot">
        {node.badge ? (
          <span className="humanity__badge">{node.badge}</span>
        ) : null}
        {node.surah ? (
          <span className="humanity__badge is-surah">
            {t("content.history.surahBadge")}
          </span>
        ) : null}
        {inside > 0 ? (
          <span className="humanity__count">
            {counted("content.history.items", inside)}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function Details({ lines }: { lines: string[] }): ReactNode {
  const sections = detailSections(lines);
  return (
    <div className="humanity__details">
      {sections.map((section, index) =>
        // A heading with nothing of its own titles the sections that follow it.
        section.lines.length === 0 ? (
          <h3 key={index} className="humanity__group">
            {section.heading}
          </h3>
        ) : (
          <section key={index} className="humanity__section">
            {section.heading ? (
              <h3 className="humanity__section-title">{section.heading}</h3>
            ) : null}
            <ul>
              {section.lines.map((line, i) => (
                <li
                  key={i}
                  className={line.kind === "pair" ? "is-pair" : undefined}
                >
                  {line.kind === "pair" ? (
                    <strong className="humanity__label">{line.label}</strong>
                  ) : null}
                  <span>
                    <Verse text={line.text} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}
