import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Budget, BudgetLine, BudgetStatus } from '../entities/budget.entity';
import { ChartOfAccount } from '../../gl/entities/chart-of-account.entity';
import { CreateBudgetDto } from '../dto/budget.dto';

@Injectable()
export class BudgetService {
  constructor(
    @InjectRepository(Budget)
    private budgetRepository: Repository<Budget>,
    @InjectRepository(BudgetLine)
    private budgetLineRepository: Repository<BudgetLine>,
    @InjectRepository(ChartOfAccount)
    private accountRepository: Repository<ChartOfAccount>,
  ) {}

  async findAll(): Promise<Budget[]> {
    return this.budgetRepository.find({ order: { fiscalYear: 'DESC', createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<Budget> {
    const budget = await this.budgetRepository.findOne({
      where: { id },
      relations: ['lines'],
    });
    if (!budget) throw new NotFoundException('Budget not found');
    return budget;
  }

  async create(dto: CreateBudgetDto): Promise<Budget> {
    const totalAmount = dto.lines.reduce((s, l) => s + l.plannedAmount, 0);
    const budget = this.budgetRepository.create({
      name: dto.name,
      fiscalYear: dto.fiscalYear,
      department: dto.department,
      notes: dto.notes,
      totalAmount,
    });
    const savedBudget = await this.budgetRepository.save(budget);

    for (const lineDto of dto.lines) {
      const account = await this.accountRepository.findOne({ where: { id: lineDto.accountId } });
      if (!account) throw new NotFoundException(`Account ${lineDto.accountId} not found`);

      const line = this.budgetLineRepository.create({
        budgetId: savedBudget.id,
        accountId: lineDto.accountId,
        plannedAmount: lineDto.plannedAmount,
        actualAmount: Number(account.balance),
        variance: lineDto.plannedAmount - Number(account.balance),
        notes: lineDto.notes,
      });
      await this.budgetLineRepository.save(line);
    }

    return this.findOne(savedBudget.id);
  }

  async approve(id: string, userId: string): Promise<Budget> {
    const budget = await this.findOne(id);
    if (budget.status !== BudgetStatus.DRAFT) {
      throw new BadRequestException('Only draft budgets can be approved');
    }
    budget.status = BudgetStatus.APPROVED;
    budget.approvedById = userId;
    budget.approvedAt = new Date();
    return this.budgetRepository.save(budget);
  }

  async getVarianceReport(budgetId: string) {
    const budget = await this.findOne(budgetId);
    const lines = await this.budgetLineRepository.find({
      where: { budgetId },
    });

    const totalPlanned = lines.reduce((s, l) => s + Number(l.plannedAmount), 0);
    const totalActual = lines.reduce((s, l) => s + Number(l.actualAmount), 0);
    const totalVariance = totalPlanned - totalActual;

    return {
      budget,
      lines,
      summary: {
        totalPlanned,
        totalActual,
        totalVariance,
        variancePercentage: totalPlanned > 0 ? (totalVariance / totalPlanned) * 100 : 0,
      },
    };
  }
}
