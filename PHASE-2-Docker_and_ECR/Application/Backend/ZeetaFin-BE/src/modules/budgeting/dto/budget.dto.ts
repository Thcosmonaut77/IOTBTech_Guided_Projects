import { IsString, IsNumber, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class BudgetLineDto {
  @IsString()
  accountId: string;

  @IsNumber()
  plannedAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateBudgetDto {
  @IsString()
  name: string;

  @IsNumber()
  fiscalYear: number;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines: BudgetLineDto[];
}

export class BudgetRevisionDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetLineDto)
  lines: BudgetLineDto[];
}
