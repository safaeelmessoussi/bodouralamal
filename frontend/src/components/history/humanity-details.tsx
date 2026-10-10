import type { ReactNode } from "react";

import { Verse } from "./humanity-diagram.js";
import { detailSections } from "./humanity-model.js";

/**
 * A node's text read as sections (R203): a line «عنوان: نص» is a labelled
 * pair, a line ending in «:» heads the lines after it. «نظرة شاملة»'s nodes
 * and, since R212, a Surah's page in both views («نوع السورة»، «المحاور
 * الأساس»…).
 */
export function Details({ lines }: { lines: string[] }): ReactNode {
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
