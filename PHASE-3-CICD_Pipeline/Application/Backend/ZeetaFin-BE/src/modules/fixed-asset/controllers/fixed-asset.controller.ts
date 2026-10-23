import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { FixedAssetService } from '../services/fixed-asset.service';
import { CreateFixedAssetDto, AssetTransferDto, AssetDisposalDto } from '../dto/fixed-asset.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';

@ApiTags('Fixed Assets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('fixed-assets')
export class FixedAssetController {
  constructor(private assetService: FixedAssetService) {}

  @Get()
  findAll() {
    return this.assetService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.assetService.findOne(id);
  }

  @Post()
  @Roles(UserRole.FINANCE_ADMIN, UserRole.ACCOUNTANT)
  create(@Body() dto: CreateFixedAssetDto) {
    return this.assetService.create(dto);
  }

  @Post(':id/transfer')
  @Roles(UserRole.FINANCE_ADMIN, UserRole.ACCOUNTANT)
  transfer(@Param('id') id: string, @Body() dto: AssetTransferDto) {
    return this.assetService.transfer(id, dto);
  }

  @Post(':id/dispose')
  @Roles(UserRole.FINANCE_ADMIN, UserRole.FINANCIAL_CONTROLLER)
  dispose(@Param('id') id: string, @Body() dto: AssetDisposalDto) {
    return this.assetService.dispose(id, dto);
  }

  @Post(':id/depreciate')
  @Roles(UserRole.FINANCE_ADMIN, UserRole.ACCOUNTANT)
  depreciate(@Param('id') id: string) {
    return this.assetService.calculateDepreciation(id);
  }

  @Get('reports/register')
  getRegister() {
    return this.assetService.getAssetRegister();
  }

  @Get('reports/depreciation-schedule')
  getDepreciationSchedule() {
    return this.assetService.getDepreciationSchedule();
  }
}
