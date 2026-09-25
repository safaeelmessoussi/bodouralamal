# بذور الأمل — institute management platform

Quran memorisation, Islamic sciences and literacy classes for **جمعية بذور الأمل** (Marrakesh): registration and approvals, groups and circles, a dual Gregorian/Hijri timetable, attendance, Quran-progress logging, exams and grades, a content library, an online classroom with recordings, Level certificates. Arabic, RTL, phone-first; data stays on Moroccan hosts (Law 09-08).

## Stack
React 19 / Vite · Express 5 / Prisma 7 · PostgreSQL 18 · S3 object store (SeaweedFS; MinIO in dev) · pg-boss · self-hosted LiveKit + Egress · Nginx · Docker Compose. Google OAuth only (MVP).

## Run locally
```bash
cp .env.example .env && cp infra.env.example infra.env      # fill Required values
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d db minio
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm api npx prisma migrate deploy
docker compose -f docker-compose.yml -f docker-compose.dev.yml run --rm api npm run seed:production
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
curl http://localhost/healthz                                # 200
```
Details: [getting started](docs/development/getting-started.md). Tests and CI: [testing](docs/development/testing.md) · [ci-cd](docs/development/ci-cd.md).

## Layout
`backend/` API, schema, migrations, seeds · `frontend/` client · `nginx/` routing/TLS/rate limits · `scripts/` CI guards, dev harnesses, deploy, backup · `docs/` the SRS (normative) and the handbook · `design.mmd` visual rulebook.

## Contributing
Read [`CLAUDE.md`](CLAUDE.md). Never edit `docs/SRS.md`; stop and ask when it is silent or self-contradictory. Docs ship in the same commit as code.
