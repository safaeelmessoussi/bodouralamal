import { useEffect, useState } from 'react';

import { listPublicSurahs, type SurahPartLabel } from '../adapters/quran-surahs.js';

/**
 * **R265 — a part of a Surah, named where the server names it** (the Owner:
 * «make it in a way that if i need to change them again, the change can be
 * done in one place»): `GET /quran-surahs` carries each split Surah's parts
 * (`policies/surah-parts.ts`), read once per page and shared by every form.
 */
let loaded: Promise<ReadonlyMap<number, readonly SurahPartLabel[]>> | null = null;

function loadParts(): Promise<ReadonlyMap<number, readonly SurahPartLabel[]>> {
  loaded ??= listPublicSurahs()
    .then((surahs) => new Map(surahs.filter((s) => (s.parts ?? []).length > 0).map((s) => [s.surah_id, s.parts ?? []])))
    .catch((error: unknown) => {
      loaded = null;
      throw error;
    });
  return loaded;
}

/** The parts of `surahId` (`[]` for a Surah not taught in parts, or until they arrive). */
export function useSurahParts(surahId: number | null): readonly SurahPartLabel[] {
  const [parts, setParts] = useState<ReadonlyMap<number, readonly SurahPartLabel[]> | null>(null);
  useEffect(() => {
    let live = true;
    void loadParts()
      .then((map) => {
        if (live) setParts(map);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return surahId === null ? [] : (parts?.get(surahId) ?? []);
}

/** The label of `part` among `parts`, or `''`. */
export function partLabel(parts: readonly SurahPartLabel[], part: 1 | 2 | null): string {
  return part === null ? '' : (parts.find((p) => p.part === part)?.label ?? '');
}
