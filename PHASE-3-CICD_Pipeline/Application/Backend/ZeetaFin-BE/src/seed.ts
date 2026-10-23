import * as bcrypt from 'bcryptjs';
import { config as dotenvConfig } from 'dotenv';
import { UserRole } from './common/enums/user-role.enum';
import { AppDataSource } from './database/data-source';

dotenvConfig();

async function seed() {
  const ds = AppDataSource;
  await ds.initialize();
  await ds.runMigrations();
  console.log('Database connected and migrated');

  const existing = await ds.query(
    `SELECT id FROM users WHERE email = $1`,
    ['admin@zeeta.com'],
  );

  if (existing.length > 0) {
    console.log('Admin user already exists');
  } else {
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await ds.query(
      `INSERT INTO users (id, email, password, "firstName", "lastName", role, "isActive")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, true)`,
      ['admin@zeeta.com', hashedPassword, 'Admin', 'User', UserRole.FINANCE_ADMIN],
    );
    console.log('Admin user created: admin@zeeta.com / admin123');
  }

  await ds.destroy();
  console.log('Setup complete');
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});
