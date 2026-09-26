# migrations

Ordered SQL applied by `migrateDatabase` and by the HTTP server on boot when `DATABASE_URL` is set.

`drizzle-kit migrate` alone skips `sql/guards.sql` and `sql/bootstrap.sql`. Use `bun run migrate` or start the server. The Compose server entrypoint migrates before the API listens when `DATABASE_URL` is set.
