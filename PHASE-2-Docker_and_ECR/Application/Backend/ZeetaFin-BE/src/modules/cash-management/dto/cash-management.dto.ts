import { IsString, IsOptional, IsNumber, IsEnum, IsDateString } from 'class-validator';

export class CreateBankAccountDto {
  @IsString()
  accountName: string;

  @IsString()
  accountNumber: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  branch?: string;

  @IsOptional()
  @IsNumber()
  currentBalance?: number;

  @IsOptional()
  @IsString()
  currency?: string;
}

export class CreateCashTransactionDto {
  @IsString()
  bankAccountId: string;

  @IsDateString()
  transactionDate: string;

  @IsEnum(['inflow', 'outflow'])
  type: 'inflow' | 'outflow';

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateReconciliationDto {
  @IsString()
  bankAccountId: string;

  @IsDateString()
  statementDate: string;

  @IsNumber()
  statementBalance: number;

  @IsOptional()
  reconcilingItems?: any;
}
