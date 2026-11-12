import { api } from '../lib/api.js';

/** R240 — one of the 114, as `GET /quran-surahs` says it (public). */
export interface PublicSurah {
  surah_id: number;
  /** Arabic; the public pages translate it as a Surah's name (`surah:` keys). */
  surah_name: string;
  revelation: 'makki' | 'madani';
  /** R265 — a Surah taught in parts (البقرة): each part's one name; absent from an older server. */
  parts?: SurahPartLabel[];
}

/** R265 — «الجزء الأول (الحزب الأول و الثاني)», named by the server. */
export interface SurahPartLabel {
  part: 1 | 2;
  label: string;
}

export async function listPublicSurahs(): Promise<PublicSurah[]> {
  return (await api<{ data: PublicSurah[] }>('/quran-surahs')).data;
}
