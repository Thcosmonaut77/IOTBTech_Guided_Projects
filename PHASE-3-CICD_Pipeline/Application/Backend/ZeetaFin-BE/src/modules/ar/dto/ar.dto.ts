import { IsString, IsOptional, IsEmail, IsNumber } from 'class-validator';

export class CreateCustomerDto {
  @IsString()
  customerCode: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  contactPerson?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class CreateARInvoiceDto {
  @IsString()
  invoiceNumber: string;

  @IsString()
  customerId: string;

  @IsString()
  invoiceDate: string;

  @IsString()
  dueDate: string;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateReceiptDto {
  @IsString()
  invoiceId: string;

  @IsString()
  receiptDate: string;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateCreditNoteDto {
  @IsString()
  invoiceId: string;

  @IsString()
  creditNoteDate: string;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
