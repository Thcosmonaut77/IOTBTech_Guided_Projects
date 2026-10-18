import { IsString, IsNumber, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { DepreciationMethod } from '../entities/fixed-asset.entity';

export class CreateFixedAssetDto {
  @IsString()
  assetCode: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsDateString()
  purchaseDate: string;

  @IsNumber()
  purchaseCost: number;

  @IsOptional()
  @IsNumber()
  usefulLifeYears?: number;

  @IsOptional()
  @IsEnum(DepreciationMethod)
  depreciationMethod?: DepreciationMethod;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class AssetTransferDto {
  @IsString()
  location: string;
}

export class AssetDisposalDto {
  @IsDateString()
  disposedAt: string;

  @IsNumber()
  disposalProceeds: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
