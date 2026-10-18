import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum AccountType {
  ASSET = 'asset',
  LIABILITY = 'liability',
  EQUITY = 'equity',
  REVENUE = 'revenue',
  EXPENSE = 'expense',
}

export enum AccountSubType {
  CURRENT_ASSET = 'current_asset',
  NON_CURRENT_ASSET = 'non_current_asset',
  CURRENT_LIABILITY = 'current_liability',
  NON_CURRENT_LIABILITY = 'non_current_liability',
  SHAREHOLDERS_EQUITY = 'shareholders_equity',
  OPERATING_REVENUE = 'operating_revenue',
  OPERATING_EXPENSE = 'operating_expense',
  OTHER_INCOME = 'other_income',
  OTHER_EXPENSE = 'other_expense',
}

@Entity('chart_of_accounts')
export class ChartOfAccount {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  code: string;

  @Column()
  name: string;

  @Column({ type: 'enum', enum: AccountType })
  type: AccountType;

  @Column({ type: 'enum', enum: AccountSubType, nullable: true })
  subType: AccountSubType;

  @Column({ nullable: true })
  parentId: string;

  @Column({ default: true })
  isActive: boolean;

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  balance: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
