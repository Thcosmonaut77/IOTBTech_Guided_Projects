import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CashManagementService } from '../services/cash-management.service';
import { CreateBankAccountDto, CreateCashTransactionDto, CreateReconciliationDto } from '../dto/cash-management.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';

@ApiTags('Cash Management')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('cash')
export class CashManagementController {
  constructor(private cashService: CashManagementService) {}

  @Get('accounts')
  findAllAccounts() {
    return this.cashService.findAllBankAccounts();
  }

  @Get('accounts/:id')
  findAccount(@Param('id') id: string) {
    return this.cashService.findBankAccount(id);
  }

  @Post('accounts')
  @Roles(UserRole.TREASURY_OFFICER, UserRole.FINANCE_ADMIN)
  createAccount(@Body() dto: CreateBankAccountDto) {
    return this.cashService.createBankAccount(dto);
  }

  @Get('position')
  getCashPosition() {
    return this.cashService.getCashPosition();
  }

  @Post('transactions')
  @Roles(UserRole.TREASURY_OFFICER, UserRole.ACCOUNTANT)
  recordTransaction(@Body() dto: CreateCashTransactionDto) {
    return this.cashService.recordTransaction(dto);
  }

  @Get('transactions')
  getTransactions(@Query('accountId') accountId?: string) {
    return this.cashService.getTransactions(accountId);
  }

  @Post('reconciliation')
  @Roles(UserRole.TREASURY_OFFICER, UserRole.FINANCE_ADMIN)
  reconcile(@Body() dto: CreateReconciliationDto) {
    return this.cashService.reconcile(dto);
  }
}
