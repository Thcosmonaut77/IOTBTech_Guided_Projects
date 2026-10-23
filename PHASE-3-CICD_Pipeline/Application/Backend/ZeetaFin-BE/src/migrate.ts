import { AppDataSource } from './database/data-source';

async function migrate() {
  await AppDataSource.initialize();
  try {
    const applied = await AppDataSource.runMigrations();
    if (applied.length === 0) {
      console.log('Database schema is up to date');
    } else {
      console.log(`Applied migrations: ${applied.map((m) => m.name).join(', ')}`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
