import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { config as dotenvConfig } from 'dotenv';
import { UserRole } from './common/enums/user-role.enum';

dotenvConfig();

async function seed() {
  const config: any = {
    type: 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    username: process.env.DB_USERNAME || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    database: process.env.DB_NAME || 'zeetafin',
    entities: [__dirname + '/**/*.entity{.ts,.js}'],
    synchronize: true,
  };

  const ds = new DataSource(config);
  await ds.initialize();
  console.log('Database connected & synced');

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
