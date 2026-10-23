import { IsString, IsOptional, IsEmail, IsNumber } from 'class-validator';

export class CreateVendorDto {
  @IsString()
  vendorCode: string;

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

  @IsOptional()
  @IsString()
  taxId?: string;
}

export class CreateAPInvoiceDto {
  @IsString()
  invoiceNumber: string;

  @IsString()
  vendorId: string;

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

export class CreateAPPaymentDto {
  @IsString()
  invoiceId: string;

  @IsString()
  paymentDate: string;

  @IsNumber()
  amount: number;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
