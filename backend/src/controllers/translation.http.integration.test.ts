import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { loadConfig } from '../lib/config.js';
import { createPrismaClient, TEST_CONNECTION_LIMIT } from '../lib/prisma.js';

/** `GET /translations` (SRS Revision 224 §4) over real HTTP: public, one language, cached. */
const config = loadConfig();
const prisma = createPrismaClient(config.DATABASE_URL, TEST_CONNECTION_LIMIT);
const BASE = `${config.PUBLIC_BASE_URL}/api/v1`;
const TAG = '[http-translation-test]';

beforeAll(async () => {
  await prisma.textTranslation.deleteMany({ where: { source: { startsWith: TAG } } });
  await prisma.textTranslation.createMany({
    data: [
      { source: `${TAG} وميض الأمل`, locale: 'en', text: 'Glimmer of Hope' },
      { source: `${TAG} وميض الأمل`, locale: 'fr', text: "Lueur de l'espoir" },
    ],
  });
});

afterAll(async () => {
  await prisma.textTranslation.deleteMany({ where: { source: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe('R224 §4 — the stored texts in one language', () => {
  it('answers anonymously with that language only, cached', async () => {
    const res = await fetch(`${BASE}/translations?locale=en`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toContain('max-age=300');
    const body = (await res.json()) as { data: Record<string, string> };
    expect(body.data[`${TAG} وميض الأمل`]).toBe('Glimmer of Hope');
    const fr = (await (await fetch(`${BASE}/translations?locale=fr`)).json()) as { data: Record<string, string> };
    expect(fr.data[`${TAG} وميض الأمل`]).toBe("Lueur de l'espoir");
  });

  it('refuses a language the menu does not offer, Arabic included (it is the source)', async () => {
    for (const locale of ['ar', 'xx', '']) {
      expect((await fetch(`${BASE}/translations?locale=${locale}`)).status).toBe(400);
    }
  });

  it('the database refuses an unknown language and an empty text', async () => {
    await expect(
      prisma.textTranslation.create({ data: { source: `${TAG} x`, locale: 'it', text: 'x' } }),
    ).rejects.toThrow();
    await expect(
      prisma.textTranslation.create({ data: { source: `${TAG} y`, locale: 'en', text: '' } }),
    ).rejects.toThrow();
  });
});
