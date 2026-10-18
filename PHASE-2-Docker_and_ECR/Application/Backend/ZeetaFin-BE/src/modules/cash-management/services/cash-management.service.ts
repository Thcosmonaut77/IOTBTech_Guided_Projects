import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankAccount, CashTransaction, BankReconciliation } from '../entities/cash-management.entity';
import { CreateBankAccountDto, CreateCashTransactionDto, CreateReconciliationDto } from '../dto/cash-management.dto';

@Injectable()
export class CashManagementService {
  constructor(
    @InjectRepository(BankAccount)
    private bankAccountRepository: Repository<BankAccount>,
    @InjectRepository(CashTransaction)
    private transactionRepository: Repository<CashTransaction>,
    @InjectRepository(BankReconciliation)
    private reconciliationRepository: Repository<BankReconciliation>,
  ) {}

  async findAllBankAccounts(): Promise<BankAccount[]> {
    return this.bankAccountRepository.find({ order: { accountName: 'ASC' } });
  }

  async findBankAccount(id: string): Promise<BankAccount> {
    const account = await this.bankAccountRepository.findOne({ where: { id } });
    if (!account) throw new NotFoundException('Bank account not found');
    return account;
  }

  async createBankAccount(dto: CreateBankAccountDto): Promise<BankAccount> {
    const account = this.bankAccountRepository.create(dto);
    return this.bankAccountRepository.save(account);
  }

  async getCashPosition() {
    const accounts = await this.findAllBankAccounts();
    const totalBalance = accounts.reduce((s, a) => s + Number(a.currentBalance), 0);
    return { accounts, totalBalance, reportDate: new Date() };
  }

  async recordTransaction(dto: CreateCashTransactionDto): Promise<CashTransaction> {
    const account = await this.findBankAccount(dto.bankAccountId);
    const transaction = this.transactionRepository.create({
      ...dto,
      transactionDate: dto.transactionDate as unknown as Date,
    });
    await this.transactionRepository.save(transaction);

    const balanceChange = dto.type === 'inflow' ? dto.amount : -dto.amount;
    await this.bankAccountRepository.update(dto.bankAccountId, {
      currentBalance: () => `current_balance + ${balanceChange}`,
    });

    return transaction;
  }

  async getTransactions(accountId?: string) {
    const where: any = {};
    if (accountId) where.bankAccountId = accountId;
    return this.transactionRepository.find({
      where,
      order: { transactionDate: 'DESC' },
    });
  }

  async reconcile(dto: CreateReconciliationDto): Promise<BankReconciliation> {
    const account = await this.findBankAccount(dto.bankAccountId);
    const difference = dto.statementBalance - Number(account.currentBalance);

    const reconciliation = this.reconciliationRepository.create({
      bankAccountId: dto.bankAccountId,
      statementDate: dto.statementDate as unknown as Date,
      statementBalance: dto.statementBalance,
      systemBalance: Number(account.currentBalance),
      difference,
      reconcilingItems: dto.reconcilingItems || [],
      isReconciled: Math.abs(difference) < 0.01,
    });

    return this.reconciliationRepository.save(reconciliation);
  }
}
