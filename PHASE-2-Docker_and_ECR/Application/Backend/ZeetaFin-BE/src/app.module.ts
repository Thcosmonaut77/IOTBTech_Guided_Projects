import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/users/user.module';
import { GLModule } from './modules/gl/gl.module';
import { APModule } from './modules/ap/ap.module';
import { ARModule } from './modules/ar/ar.module';
import { CashManagementModule } from './modules/cash-management/cash-management.module';
import { BudgetingModule } from './modules/budgeting/budgeting.module';
import { FixedAssetModule } from './modules/fixed-asset/fixed-asset.module';

const dbSync = (process.env.DB_SYNC || 'true') === 'true';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME || 'postgres',
      password: process.env.DB_PASSWORD || 'postgres',
      database: process.env.DB_NAME || 'zeetafin',
      entities: [__dirname + '/**/*.entity{.ts,.js}'],
      synchronize: dbSync,
      logging: process.env.DB_LOGGING === 'true',
    }),
    AuthModule,
    UserModule,
    GLModule,
    APModule,
    ARModule,
    CashManagementModule,
    BudgetingModule,
    FixedAssetModule,
  ],
})
export class AppModule {}
