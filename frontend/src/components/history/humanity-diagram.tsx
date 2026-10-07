import { useState, type ReactNode } from "react";

import { t } from "../../i18n/index.js";
import {
  branchKeys,
  diagramSize,
  initiallyOpen,
  verseRuns,
  type DiagramNode,
  type DiagramTone,
  type HistoryDiagram,
} from "./humanity-model.js";

/**
 * **SRS Revision 204 — a Surah's axes as a diagram** (the Owner, 2026-10-07:
 * «المحاور الكبرى للسورة» replaced by diagrams, easier to scan; al-Fatiha's
 * whole chart drawn). A tree read from the start side: on a laptop each level
 * is a column, the branches flowing to the left like the Owner's drawings; on
 * a phone the same tree is an indented outline. A box with branches opens and
 * closes on a click; «فتح الكل» and «طيّ الكل» do it for the whole tree.
 */
export function HumanityDiagram({
  diagram,
}: {
  diagram: HistoryDiagram;
}): ReactNode {
  const [open, setOpen] = useState<Set<string>>(() =>
    initiallyOpen(diagram.root),
  );
  const toggle = (key: string): void =>
    setOpen((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const all = branchKeys(diagram.root);
  const wide = diagramSize(diagram.root) > 8;
  return (
    <figure className={`hdiagram${wide ? " is-wide" : ""}`}>
      <figcaption className="hdiagram__head">
        <span className="hdiagram__title">{diagram.title}</span>
        {all.length > 1 ? (
          <span className="hdiagram__actions">
            <button
              type="button"
              className="hdiagram__action"
              onClick={() => setOpen(new Set(all))}
            >
              {t("content.history.diagram.openAll")}
            </button>
            <button
              type="button"
              className="hdiagram__action"
              onClick={() => setOpen(new Set())}
            >
              {t("content.history.diagram.closeAll")}
            </button>
          </span>
        ) : null}
      </figcaption>
      <div className="hdiagram__scroll">
        <ul className="hdiagram__tree">
          <Branch node={diagram.root} at="0" open={open} onToggle={toggle} />
        </ul>
      </div>
    </figure>
  );
}

const TONE_CLASS: Record<DiagramTone, string> = {
  gold: "tone-prophets",
  violet: "tone-seal",
  blue: "tone-ummah",
  orange: "tone-makki",
  green: "tone-madani",
};

function Branch({
  node,
  at,
  open,
  onToggle,
}: {
  node: DiagramNode;
  at: string;
  open: Set<string>;
  onToggle: (key: string) => void;
}): ReactNode {
  const branches = node.children ?? [];
  const isOpen = open.has(at);
  const body = (
    <>
      <span className="hdiagram__label">
        <Verse text={node.label} />
      </span>
      {node.text ? (
        <span className="hdiagram__text">
          <Verse text={node.text} />
        </span>
      ) : null}
    </>
  );
  return (
    <li className={node.tone ? TONE_CLASS[node.tone] : undefined}>
      {branches.length > 0 ? (
        <button
          type="button"
          className={`hdiagram__box is-branch${isOpen ? " is-open" : ""}`}
          aria-expanded={isOpen}
          onClick={() => onToggle(at)}
        >
          {body}
          <span className="hdiagram__more" aria-hidden="true">
            {isOpen ? "−" : `+${String(branches.length)}`}
          </span>
        </button>
      ) : (
        <div className="hdiagram__box">{body}</div>
      )}
      {branches.length > 0 && isOpen ? (
        <ul>
          {branches.map((child, i) => (
            <Branch
              key={i}
              node={child}
              at={`${at}/${String(i)}`}
              open={open}
              onToggle={onToggle}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

/** A sentence with its Quranic quotations ﴿…﴾ drawn as one. */
export function Verse({ text }: { text: string }): ReactNode {
  return (
    <>
      {verseRuns(text).map((run, i) =>
        run.verse ? (
          <span key={i} className="humanity__verse">
            {run.text}
          </span>
        ) : (
          <span key={i}>{run.text}</span>
        ),
      )}
    </>
  );
}
