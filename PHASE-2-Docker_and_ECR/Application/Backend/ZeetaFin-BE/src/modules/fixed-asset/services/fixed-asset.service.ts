import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FixedAsset, AssetStatus, DepreciationMethod } from '../entities/fixed-asset.entity';
import { CreateFixedAssetDto, AssetTransferDto, AssetDisposalDto } from '../dto/fixed-asset.dto';

@Injectable()
export class FixedAssetService {
  constructor(
    @InjectRepository(FixedAsset)
    private assetRepository: Repository<FixedAsset>,
  ) {}

  async findAll(): Promise<FixedAsset[]> {
    return this.assetRepository.find({ order: { name: 'ASC' } });
  }

  async findOne(id: string): Promise<FixedAsset> {
    const asset = await this.assetRepository.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('Asset not found');
    return asset;
  }

  async create(dto: CreateFixedAssetDto): Promise<FixedAsset> {
    const asset = this.assetRepository.create({
      ...dto,
      purchaseDate: dto.purchaseDate as unknown as Date,
      accumulatedDepreciation: 0,
      netBookValue: dto.purchaseCost,
    });
    return this.assetRepository.save(asset);
  }

  async transfer(id: string, dto: AssetTransferDto): Promise<FixedAsset> {
    const asset = await this.findOne(id);
    asset.location = dto.location;
    return this.assetRepository.save(asset);
  }

  async dispose(id: string, dto: AssetDisposalDto): Promise<FixedAsset> {
    const asset = await this.findOne(id);
    if (asset.status === AssetStatus.DISPOSED) {
      throw new BadRequestException('Asset is already disposed');
    }
    asset.status = AssetStatus.DISPOSED;
    asset.disposedAt = dto.disposedAt as unknown as Date;
    asset.disposalProceeds = dto.disposalProceeds;
    asset.notes = dto.notes || asset.notes;
    return this.assetRepository.save(asset);
  }

  async calculateDepreciation(id: string): Promise<FixedAsset> {
    const asset = await this.findOne(id);
    if (asset.status !== AssetStatus.ACTIVE) {
      throw new BadRequestException('Only active assets can be depreciated');
    }
    if (!asset.usefulLifeYears || asset.usefulLifeYears <= 0) {
      throw new BadRequestException('Asset must have a useful life');
    }

    let annualDepreciation: number;
    if (asset.depreciationMethod === DepreciationMethod.STRAIGHT_LINE) {
      annualDepreciation = Number(asset.purchaseCost) / asset.usefulLifeYears;
    } else {
      const rate = 2 / asset.usefulLifeYears;
      annualDepreciation = (Number(asset.purchaseCost) - Number(asset.accumulatedDepreciation)) * rate;
    }

    const newAccumulated = Number(asset.accumulatedDepreciation) + annualDepreciation;
    asset.accumulatedDepreciation = newAccumulated;
    asset.netBookValue = Math.max(0, Number(asset.purchaseCost) - newAccumulated);

    return this.assetRepository.save(asset);
  }

  async getAssetRegister() {
    const assets = await this.findAll();
    const totalCost = assets.reduce((s, a) => s + Number(a.purchaseCost), 0);
    const totalDepreciation = assets.reduce((s, a) => s + Number(a.accumulatedDepreciation), 0);
    const totalNetBookValue = assets.reduce((s, a) => s + Number(a.netBookValue), 0);

    return {
      assets,
      summary: {
        totalCost,
        totalDepreciation,
        totalNetBookValue,
        assetCount: assets.length,
      },
    };
  }

  async getDepreciationSchedule() {
    const assets = await this.assetRepository.find({
      where: { status: AssetStatus.ACTIVE },
    });

    return assets.map(a => ({
      asset: { code: a.assetCode, name: a.name, category: a.category },
      purchaseCost: a.purchaseCost,
      usefulLife: a.usefulLifeYears,
      method: a.depreciationMethod,
      accumulatedDepreciation: a.accumulatedDepreciation,
      netBookValue: a.netBookValue,
      annualDepreciation: a.usefulLifeYears
        ? Number(a.purchaseCost) / a.usefulLifeYears
        : 0,
    }));
  }
}
