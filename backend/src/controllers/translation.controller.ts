import type { Request, Response } from 'express';
import { z } from 'zod';

import type { PrismaClient } from '../generated/prisma/client.js';
import { dictionaryFor, TRANSLATED_LOCALES } from '../services/translation.service.js';
import { parse } from './parse.js';

const querySchema = z.object({ locale: z.enum(TRANSLATED_LOCALES) });

/**
 * `GET /translations?locale=` (R224 §4) — public, like the pages that read it.
 * Cached five minutes: the dictionary changes when somebody imports or
 * corrects a translation, not per request.
 */
export function read(prisma: PrismaClient) {
  return async (req: Request, res: Response): Promise<void> => {
    const q = parse(querySchema, req.query);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ data: await dictionaryFor(prisma, q.locale) });
  };
}
