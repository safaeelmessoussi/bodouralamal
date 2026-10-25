import { api } from '../lib/api.js';

/** R240 — one of the 114, as `GET /quran-surahs` says it (public). */
export interface PublicSurah {
  surah_id: number;
  /** Arabic; the public pages translate it as a Surah's name (`surah:` keys). */
  surah_name: string;
  revelation: 'makki' | 'madani';
}

export async function listPublicSurahs(): Promise<PublicSurah[]> {
  return (await api<{ data: PublicSurah[] }>('/quran-surahs')).data;
}
