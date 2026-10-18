import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Budget, BudgetLine } from './entities/budget.entity';
import { ChartOfAccount } from '../gl/entities/chart-of-account.entity';
import { BudgetService } from './services/budget.service';
import { BudgetController } from './controllers/budget.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Budget, BudgetLine, ChartOfAccount])],
  controllers: [BudgetController],
  providers: [BudgetService],
  exports: [BudgetService],
})
export class BudgetingModule {}
