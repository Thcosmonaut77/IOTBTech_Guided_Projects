import { config as dotenvConfig } from 'dotenv';
dotenvConfig();

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseOptions } from './database/database.config';
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/users/user.module';
import { GLModule } from './modules/gl/gl.module';
import { APModule } from './modules/ap/ap.module';
import { ARModule } from './modules/ar/ar.module';
import { CashManagementModule } from './modules/cash-management/cash-management.module';
import { BudgetingModule } from './modules/budgeting/budgeting.module';
import { FixedAssetModule } from './modules/fixed-asset/fixed-asset.module';

@Module({
  imports: [
    TypeOrmModule.forRoot(databaseOptions()),
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
