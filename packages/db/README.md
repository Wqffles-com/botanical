# @botanical/db

Postgres schema and migrations for Botanical.

## Status

Placeholder. There is no migration runner and no tables yet. The server stub does not open a database connection.

## Local database

From the repo root:

```bash
docker compose up -d postgres
```

That starts Postgres 16 and publishes `localhost:5432`.

Default URL for a laptop (change it before any shared deploy):

```
postgres://botanical:botanical@localhost:5432/botanical
```

Set `DATABASE_URL` to that value. Names and a sample URL are in the root `.env.example`.

Inside Compose, the server service uses host `postgres` instead of `localhost`. The scaffold image still does not connect.

## Migrations

Put future SQL files in [`migrations/`](./migrations/). Nothing in that folder is applied automatically.

Name files so they sort in apply order, for example `0001_init.sql`. When a runner is chosen, it should apply those files against `DATABASE_URL`.

Do not store dumps, credentials, or generated clients in this package.
