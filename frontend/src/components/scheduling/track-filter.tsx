import type { ReactNode } from 'react';

import type { ScopeOptions } from '../../hooks/use-scope-options.js';
import { t } from '../../i18n/index.js';
import { MultiSelectField } from '../ui/multi-select.js';

export type Track = 'younger' | 'older';

/** What «المسار» offers and reads as chosen, from the Levels on offer. */
export function trackChoices(
  offered: readonly string[],
  levelTracks: Readonly<Record<string, Track>>,
  levelIds: readonly string[],
): { tracks: Track[]; selected: Track[]; membersOf: (track: Track) => string[] } {
  const membersOf = (track: Track): string[] => offered.filter((id) => levelTracks[id] === track);
  const tracks = (['younger', 'older'] as const).filter((track) => membersOf(track).length > 0);
  // A track reads as chosen while every one of its Levels is.
  const selected = tracks.filter((track) => membersOf(track).every((id) => levelIds.includes(id)));
  return { tracks, selected, membersOf };
}

/** The Levels after «المسار» changes: a track added brings all its Levels, a
 *  track removed takes its Levels away, every other choice stays. */
export function levelsAfterTracks(
  offered: readonly string[],
  levelTracks: Readonly<Record<string, Track>>,
  levelIds: readonly string[],
  next: readonly string[],
): string[] {
  const { tracks, selected, membersOf } = trackChoices(offered, levelTracks, levelIds);
  const kept = levelIds.filter((id) => {
    const track = levelTracks[id];
    return !track || next.includes(track) || !selected.includes(track);
  });
  const added = tracks.filter((track) => next.includes(track) && !selected.includes(track)).flatMap(membersOf);
  return [...new Set([...kept, ...added])];
}

/**
 * **R235 — «المسار»: a Category's «صغار» or «كبار» line, as a way to choose
 * Levels.** Not stored: choosing a track selects every Level of it (within the
 * Categories chosen), and the class names those Levels — fixed when it is
 * saved, as «الكل» is (R169 §7). Offered only where some Level has a track.
 */
export function TrackFilter({
  scope,
  categoryIds,
  levelIds,
  setLevelIds,
}: {
  scope: Pick<ScopeOptions, 'levelTracks' | 'levelCategoryIds' | 'options'>;
  categoryIds: readonly string[];
  levelIds: readonly string[];
  setLevelIds: (next: string[]) => void;
}): ReactNode {
  const levelTracks = scope.levelTracks ?? {};
  const offered = scope.options.levelId
    .map((o) => o.value)
    .filter((id) => categoryIds.length === 0 || categoryIds.includes(scope.levelCategoryIds[id] ?? ''));
  const { tracks, selected } = trackChoices(offered, levelTracks, levelIds);
  if (tracks.length === 0) return null;
  return (
    <MultiSelectField
      label={t('scope.trackLabel')}
      selected={selected}
      onChange={(next) => setLevelIds(levelsAfterTracks(offered, levelTracks, levelIds, next))}
      options={tracks.map((track) => ({ value: track, label: t(`scope.track.${track}`) }))}
      emptyLabel={t('common.all')}
      hint={t('scope.trackHint')}
    />
  );
}
