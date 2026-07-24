// Boot entry. TD-13 fail-fast env validation is the first thing this process
// executes — nothing else may initialize before it. The Express app, middleware
// stack, and pg-boss runner land with M1 (SRS §8 week 1, docs/TASKS.md).
import { loadConfig } from './lib/config.js';

export const config = loadConfig();
