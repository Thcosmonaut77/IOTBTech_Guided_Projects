import { Controller, Get, Post, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ChartOfAccountsService } from '../services/chart-of-accounts.service';
import { JournalEntriesService } from '../services/journal-entries.service';
import { CreateAccountDto, UpdateAccountDto } from '../dto/chart-of-account.dto';
import { CreateJournalEntryDto } from '../dto/journal-entry.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';

@ApiTags('General Ledger')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('gl')
export class GLController {
  constructor(
    private accountsService: ChartOfAccountsService,
    private journalService: JournalEntriesService,
  ) {}

  @Get('chart-of-accounts')
  findAllAccounts() {
    return this.accountsService.findAll();
  }

  @Get('chart-of-accounts/:id')
  findOneAccount(@Param('id') id: string) {
    return this.accountsService.findOne(id);
  }

  @Post('chart-of-accounts')
  @Roles(UserRole.FINANCE_ADMIN, UserRole.ACCOUNTANT)
  createAccount(@Body() dto: CreateAccountDto) {
    return this.accountsService.create(dto);
  }

  @Post('chart-of-accounts/:id')
  @Roles(UserRole.FINANCE_ADMIN, UserRole.ACCOUNTANT)
  updateAccount(@Param('id') id: string, @Body() dto: UpdateAccountDto) {
    return this.accountsService.update(id, dto);
  }

  @Get('journal-entries')
  findAllJournals(@Query('status') status?: string) {
    return this.journalService.findAll(status);
  }

  @Get('journal-entries/:id')
  findOneJournal(@Param('id') id: string) {
    return this.journalService.findOne(id);
  }

  @Post('journal-entries')
  @Roles(UserRole.FINANCE_ADMIN, UserRole.ACCOUNTANT)
  createJournal(@Body() dto: CreateJournalEntryDto, @Req() req: any) {
    return this.journalService.create(dto, req.user.id);
  }

  @Post('journal-entries/:id/approve')
  @Roles(UserRole.FINANCIAL_CONTROLLER, UserRole.FINANCE_ADMIN)
  approveJournal(@Param('id') id: string, @Req() req: any) {
    return this.journalService.approve(id, req.user.id);
  }

  @Post('journal-entries/:id/post')
  @Roles(UserRole.FINANCE_ADMIN)
  postJournal(@Param('id') id: string) {
    return this.journalService.post(id);
  }

  @Get('trial-balance')
  getTrialBalance() {
    return this.accountsService.getTrialBalance();
  }

  @Get('balance-sheet')
  getBalanceSheet() {
    return this.accountsService.getBalanceSheet();
  }

  @Get('profit-and-loss')
  getProfitAndLoss(@Query('from') from?: string, @Query('to') to?: string) {
    return this.accountsService.getProfitAndLoss(from, to);
  }
}
