import type { ReactNode } from 'react';

import type { ScopeOptions } from '../../hooks/use-scope-options.js';
import { t } from '../../i18n/index.js';
import { MultiSelectField } from '../ui/multi-select.js';

export type Track = 'younger' | 'older';
const TRACKS: readonly Track[] = ['younger', 'older'];

/**
 * **R238 — «المسار»: a Category's «صغار» or «كبار» line, an audience choice of
 * its own** (the Owner, 2026-10-21: «do not select automatically levels as
 * levels are to be selected manually»). Choosing a track narrows the Levels
 * offered beneath it and never picks one; left at «الكل» for the Level, the
 * item reaches the track's Levels (the server resolves them on save). Offered
 * only where a Level on offer has a track.
 */
export function TrackFilter({
  scope,
  categoryIds,
  tracks,
  setTracks,
}: {
  scope: Pick<ScopeOptions, 'levelTracks' | 'levelCategoryIds' | 'options'>;
  categoryIds: readonly string[];
  tracks: readonly Track[];
  setTracks: (next: Track[]) => void;
}): ReactNode {
  const offered = tracksOffered(scope, categoryIds);
  if (offered.length === 0) return null;
  return (
    <MultiSelectField
      label={t('scope.trackLabel')}
      selected={tracks.filter((track) => offered.includes(track))}
      onChange={(next) => setTracks(TRACKS.filter((track) => next.includes(track)))}
      options={offered.map((track) => ({ value: track, label: t(`scope.track.${track}`) }))}
      emptyLabel={t('common.all')}
    />
  );
}

/** The tracks some Level of the chosen Categories (all, when none) has. */
export function tracksOffered(
  scope: Pick<ScopeOptions, 'levelTracks' | 'levelCategoryIds' | 'options'>,
  categoryIds: readonly string[],
): Track[] {
  const levelTracks = scope.levelTracks ?? {};
  const levels = scope.options.levelId
    .map((o) => o.value)
    .filter((id) => categoryIds.length === 0 || categoryIds.includes(scope.levelCategoryIds[id] ?? ''));
  return TRACKS.filter((track) => levels.some((id) => levelTracks[id] === track));
}

/** A Level the chosen tracks leave on offer: any, when none is chosen. */
export function withinTracks(
  levelTracks: Readonly<Record<string, Track>> | undefined,
  tracks: readonly Track[],
  levelId: string,
): boolean {
  if (tracks.length === 0) return true;
  const track = levelTracks?.[levelId];
  return track !== undefined && tracks.includes(track);
}
