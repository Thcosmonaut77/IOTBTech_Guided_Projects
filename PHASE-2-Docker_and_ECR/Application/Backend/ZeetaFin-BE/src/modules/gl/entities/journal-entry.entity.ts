import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { ChartOfAccount } from './chart-of-account.entity';
import { User } from '../../users/user.entity';

export enum JournalEntryStatus {
  DRAFT = 'draft',
  POSTED = 'posted',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity('journal_entries')
export class JournalEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  entryNumber: string;

  @Column({ type: 'date' })
  entryDate: Date;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({
    type: 'enum',
    enum: JournalEntryStatus,
    default: JournalEntryStatus.DRAFT,
  })
  status: JournalEntryStatus;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalDebit: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  totalCredit: number;

  @Column({ nullable: true })
  approvedById: string;

  @Column({ nullable: true })
  approvedAt: Date;

  @Column()
  createdById: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('journal_entry_lines')
export class JournalEntryLine {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  journalEntryId: string;

  @ManyToOne(() => JournalEntry)
  @JoinColumn({ name: 'journalEntryId' })
  journalEntry: JournalEntry;

  @Column()
  accountId: string;

  @ManyToOne(() => ChartOfAccount)
  @JoinColumn({ name: 'accountId' })
  account: ChartOfAccount;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  debit: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  credit: number;

  @Column({ type: 'text', nullable: true })
  description: string;
}
