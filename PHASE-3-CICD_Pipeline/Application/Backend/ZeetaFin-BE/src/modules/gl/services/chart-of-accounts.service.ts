import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChartOfAccount } from '../entities/chart-of-account.entity';
import { CreateAccountDto, UpdateAccountDto } from '../dto/chart-of-account.dto';

@Injectable()
export class ChartOfAccountsService {
  constructor(
    @InjectRepository(ChartOfAccount)
    private accountRepository: Repository<ChartOfAccount>,
  ) {}

  async findAll(): Promise<ChartOfAccount[]> {
    return this.accountRepository.find({ order: { code: 'ASC' } });
  }

  async findOne(id: string): Promise<ChartOfAccount> {
    const account = await this.accountRepository.findOne({ where: { id } });
    if (!account) throw new NotFoundException('Account not found');
    return account;
  }

  async create(dto: CreateAccountDto): Promise<ChartOfAccount> {
    const existing = await this.accountRepository.findOne({ where: { code: dto.code } });
    if (existing) throw new BadRequestException('Account code already exists');
    const account = this.accountRepository.create(dto);
    return this.accountRepository.save(account);
  }

  async update(id: string, dto: UpdateAccountDto): Promise<ChartOfAccount> {
    const account = await this.findOne(id);
    Object.assign(account, dto);
    return this.accountRepository.save(account);
  }

  async remove(id: string): Promise<void> {
    const account = await this.findOne(id);
    await this.accountRepository.remove(account);
  }

  async getTrialBalance() {
    const accounts = await this.accountRepository.find({
      where: { isActive: true },
      order: { code: 'ASC' },
    });
    const totalDebit = accounts.reduce((sum, a) => sum + (a.balance > 0 ? Number(a.balance) : 0), 0);
    const totalCredit = accounts.reduce((sum, a) => sum + (a.balance < 0 ? Math.abs(Number(a.balance)) : 0), 0);
    return { accounts, totalDebit, totalCredit };
  }

  async getBalanceSheet() {
    const accounts = await this.accountRepository.find({
      where: { isActive: true },
      order: { code: 'ASC' },
    });
    const assets = accounts.filter(a => a.type === 'asset');
    const liabilities = accounts.filter(a => a.type === 'liability');
    const equity = accounts.filter(a => a.type === 'equity');
    const totalAssets = assets.reduce((s, a) => s + Number(a.balance), 0);
    const totalLiabilities = liabilities.reduce((s, a) => s + Number(a.balance), 0);
    const totalEquity = equity.reduce((s, a) => s + Number(a.balance), 0);
    return {
      assets: { accounts: assets, total: totalAssets },
      liabilities: { accounts: liabilities, total: totalLiabilities },
      equity: { accounts: equity, total: totalEquity },
      totalLiabilitiesAndEquity: totalLiabilities + totalEquity,
    };
  }

  async getProfitAndLoss(from?: string, to?: string) {
    const accounts = await this.accountRepository.find({
      where: { isActive: true },
      order: { code: 'ASC' },
    });
    const revenue = accounts.filter(a => a.type === 'revenue');
    const expenses = accounts.filter(a => a.type === 'expense');
    const totalRevenue = revenue.reduce((s, a) => s + Number(a.balance), 0);
    const totalExpenses = expenses.reduce((s, a) => s + Number(a.balance), 0);
    return {
      revenue: { accounts: revenue, total: totalRevenue },
      expenses: { accounts: expenses, total: totalExpenses },
      netIncome: totalRevenue - totalExpenses,
    };
  }
}
