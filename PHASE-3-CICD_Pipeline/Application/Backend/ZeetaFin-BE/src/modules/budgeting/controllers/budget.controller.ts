import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BudgetService } from '../services/budget.service';
import { CreateBudgetDto } from '../dto/budget.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';

@ApiTags('Budgeting')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('budgeting')
export class BudgetController {
  constructor(private budgetService: BudgetService) {}

  @Get('budgets')
  findAll() {
    return this.budgetService.findAll();
  }

  @Get('budgets/:id')
  findOne(@Param('id') id: string) {
    return this.budgetService.findOne(id);
  }

  @Post('budgets')
  @Roles(UserRole.FINANCE_ADMIN, UserRole.FINANCIAL_CONTROLLER)
  create(@Body() dto: CreateBudgetDto) {
    return this.budgetService.create(dto);
  }

  @Post('budgets/:id/approve')
  @Roles(UserRole.FINANCIAL_CONTROLLER, UserRole.FINANCE_ADMIN)
  approve(@Param('id') id: string, @Req() req: any) {
    return this.budgetService.approve(id, req.user.id);
  }

  @Get('variance/:budgetId')
  getVarianceReport(@Param('budgetId') budgetId: string) {
    return this.budgetService.getVarianceReport(budgetId);
  }
}
