// Boot entry. The Express app, middleware stack, and pg-boss runner land with M1
// (SRS §8 week 1, docs/TASKS.md). Boot-time TD-13 fail-fast env validation is the
// first thing this process does — nothing else may execute before it.
export {};
