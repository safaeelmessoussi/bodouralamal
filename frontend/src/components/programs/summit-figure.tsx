import type { ReactNode } from 'react';

import { t } from '../../i18n/index.js';

/**
 * The highest point: the graduation attire the whole road climbs toward (R181
 * §4, the Owner's image of 2026-09-30). Since R185 §3 it stands INSIDE the
 * last Category's stage, under «إتمام الفئة», where the road ends — and the
 * full-screen show raises the same figure at every Category's graduation.
 */
export function SummitFigure({
  sizes = '(max-width: 44rem) 10rem, 12rem',
}: {
  sizes?: string;
}): ReactNode {
  return (
    <div className="journey__summit" role="group" aria-label={t('programs.journey.summit')}>
      <figure className="journey__attire">
        <img
          src="/journey/graduation-attire.jpg"
          srcSet="/journey/graduation-attire.jpg 720w, /journey/graduation-attire-2x.jpg 1200w"
          sizes={sizes}
          alt={t('programs.journey.attireAlt')}
          loading="lazy"
          decoding="async"
        />
        <figcaption className="journey__attireCaption">
          {t('programs.journey.summitQuestion')}
        </figcaption>
      </figure>
      <p className="journey__milestoneText">{t('programs.journey.summitText')}</p>
    </div>
  );
}
