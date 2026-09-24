# migrations

Empty on purpose. Add ordered SQL files here (`0001_*.sql`, then `0002_*.sql`, and so on).

The Compose server entrypoint runs `bun run db:migrate` before the API listens when `DATABASE_URL` is set. That runs the Drizzle migrator against this folder.
