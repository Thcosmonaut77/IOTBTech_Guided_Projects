import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BankAccount, CashTransaction, BankReconciliation } from './entities/cash-management.entity';
import { CashManagementService } from './services/cash-management.service';
import { CashManagementController } from './controllers/cash-management.controller';

@Module({
  imports: [TypeOrmModule.forFeature([BankAccount, CashTransaction, BankReconciliation])],
  controllers: [CashManagementController],
  providers: [CashManagementService],
  exports: [CashManagementService],
})
export class CashManagementModule {}
