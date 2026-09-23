import { migrateDatabase } from './migrate.ts';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

await migrateDatabase(databaseUrl);
console.log('Applied Botanical Postgres migrations.');
