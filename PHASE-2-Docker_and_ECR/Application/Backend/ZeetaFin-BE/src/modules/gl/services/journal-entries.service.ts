import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { JournalEntry, JournalEntryLine, JournalEntryStatus } from '../entities/journal-entry.entity';
import { ChartOfAccount } from '../entities/chart-of-account.entity';
import { CreateJournalEntryDto } from '../dto/journal-entry.dto';

@Injectable()
export class JournalEntriesService {
  constructor(
    @InjectRepository(JournalEntry)
    private journalRepository: Repository<JournalEntry>,
    @InjectRepository(JournalEntryLine)
    private lineRepository: Repository<JournalEntryLine>,
    @InjectRepository(ChartOfAccount)
    private accountRepository: Repository<ChartOfAccount>,
    private dataSource: DataSource,
  ) {}

  async findAll(status?: string): Promise<JournalEntry[]> {
    const where: any = {};
    if (status) where.status = status;
    return this.journalRepository.find({
      where,
      order: { entryDate: 'DESC', createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<JournalEntry> {
    const entry = await this.journalRepository.findOne({
      where: { id },
      relations: ['lines', 'lines.account'],
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return entry;
  }

  async create(dto: CreateJournalEntryDto, userId: string): Promise<JournalEntry> {
    const totalDebit = dto.lines.reduce((s, l) => s + l.debit, 0);
    const totalCredit = dto.lines.reduce((s, l) => s + l.credit, 0);

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new BadRequestException('Total debits must equal total credits');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const count = await this.journalRepository.count();
      const entryNumber = `JE-${String(count + 1).padStart(6, '0')}`;

      const entry = this.journalRepository.create({
        entryNumber,
        entryDate: dto.entryDate as unknown as Date,
        description: dto.description,
        totalDebit,
        totalCredit,
        status: JournalEntryStatus.DRAFT,
        createdById: userId,
      });

      const savedEntry = await queryRunner.manager.save(entry);

      for (const lineDto of dto.lines) {
        const account = await this.accountRepository.findOne({ where: { id: lineDto.accountId } });
        if (!account) throw new NotFoundException(`Account ${lineDto.accountId} not found`);

        const line = this.lineRepository.create({
          journalEntryId: savedEntry.id,
          accountId: lineDto.accountId,
          debit: lineDto.debit,
          credit: lineDto.credit,
          description: lineDto.description,
        });
        await queryRunner.manager.save(line);

        const balanceChange = lineDto.debit - lineDto.credit;
        await queryRunner.manager.update(ChartOfAccount, lineDto.accountId, {
          balance: () => `balance + ${balanceChange}`,
        });
      }

      await queryRunner.commitTransaction();
      return this.findOne(savedEntry.id);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  async approve(id: string, userId: string): Promise<JournalEntry> {
    const entry = await this.findOne(id);
    if (entry.status !== JournalEntryStatus.DRAFT) {
      throw new BadRequestException('Only draft entries can be approved');
    }
    entry.status = JournalEntryStatus.APPROVED;
    entry.approvedById = userId;
    entry.approvedAt = new Date();
    return this.journalRepository.save(entry);
  }

  async post(id: string): Promise<JournalEntry> {
    const entry = await this.findOne(id);
    if (entry.status !== JournalEntryStatus.APPROVED) {
      throw new BadRequestException('Only approved entries can be posted');
    }
    entry.status = JournalEntryStatus.POSTED;
    return this.journalRepository.save(entry);
  }
}
