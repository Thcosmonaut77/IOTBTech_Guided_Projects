import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChartOfAccount } from './entities/chart-of-account.entity';
import { JournalEntry, JournalEntryLine } from './entities/journal-entry.entity';
import { AuditLog } from './entities/audit-log.entity';
import { ChartOfAccountsService } from './services/chart-of-accounts.service';
import { JournalEntriesService } from './services/journal-entries.service';
import { GLController } from './controllers/gl.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ChartOfAccount, JournalEntry, JournalEntryLine, AuditLog])],
  controllers: [GLController],
  providers: [ChartOfAccountsService, JournalEntriesService],
  exports: [ChartOfAccountsService, JournalEntriesService],
})
export class GLModule {}
