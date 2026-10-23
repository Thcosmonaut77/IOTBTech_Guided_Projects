import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('bank_accounts')
export class BankAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  accountName: string;

  @Column({ unique: true })
  accountNumber: string;

  @Column({ nullable: true })
  bankName: string;

  @Column({ nullable: true })
  branch: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  currentBalance: number;

  @Column({ type: 'varchar', nullable: true })
  currency: string;

  @Column({ default: true })
  isActive: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

@Entity('cash_transactions')
export class CashTransaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  bankAccountId: string;

  @Column({ type: 'date' })
  transactionDate: Date;

  @Column()
  type: 'inflow' | 'outflow';

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  amount: number;

  @Column({ nullable: true })
  category: string;

  @Column({ nullable: true })
  referenceNumber: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @CreateDateColumn()
  createdAt: Date;
}

@Entity('bank_reconciliation')
export class BankReconciliation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  bankAccountId: string;

  @Column({ type: 'date' })
  statementDate: Date;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  statementBalance: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  systemBalance: number;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  difference: number;

  @Column({ type: 'jsonb', nullable: true })
  reconcilingItems: any;

  @Column({ default: false })
  isReconciled: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
