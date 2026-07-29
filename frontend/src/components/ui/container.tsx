import type { ReactNode } from 'react';

/** Page gutter and max measure, so no section invents its own (§14.3). */
export function Container({
  children,
  narrow = false,
  className = '',
}: {
  children: ReactNode;
  narrow?: boolean;
  className?: string;
}): ReactNode {
  return (
    <div className={['container', narrow ? 'container--narrow' : '', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  );
}

/**
 * A titled page section. `id` is what the in-page navigation anchors to, and the
 * heading is bound to the section by `aria-labelledby` so the landmark is
 * announced with its name rather than as an anonymous region.
 */
export function Section({
  id,
  eyebrow,
  title,
  lede,
  tint = false,
  children,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  lede?: string;
  tint?: boolean;
  children?: ReactNode;
}): ReactNode {
  const headingId = `${id}-title`;
  return (
    <section id={id} className={tint ? 'section section--tint' : 'section'} aria-labelledby={headingId}>
      <Container>
        <div className="section__head">
          {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
          <h2 id={headingId} className="section__title">
            {title}
          </h2>
          {lede ? <p className="lede">{lede}</p> : null}
        </div>
        {children}
      </Container>
    </section>
  );
}
