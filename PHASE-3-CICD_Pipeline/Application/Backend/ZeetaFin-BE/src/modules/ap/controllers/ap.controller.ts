import { Controller, Get, Post, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { APService } from '../services/ap.service';
import { CreateVendorDto, CreateAPInvoiceDto, CreateAPPaymentDto } from '../dto/ap.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';

@ApiTags('Accounts Payable')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ap')
export class APController {
  constructor(private apService: APService) {}

  @Get('vendors')
  findAllVendors() {
    return this.apService.findAllVendors();
  }

  @Get('vendors/:id')
  findVendor(@Param('id') id: string) {
    return this.apService.findVendor(id);
  }

  @Post('vendors')
  @Roles(UserRole.AP_OFFICER, UserRole.FINANCE_ADMIN)
  createVendor(@Body() dto: CreateVendorDto) {
    return this.apService.createVendor(dto);
  }

  @Get('invoices')
  findAllInvoices(@Query('status') status?: string) {
    return this.apService.findAllInvoices(status);
  }

  @Get('invoices/:id')
  findInvoice(@Param('id') id: string) {
    return this.apService.findInvoice(id);
  }

  @Post('invoices')
  @Roles(UserRole.AP_OFFICER, UserRole.ACCOUNTANT)
  createInvoice(@Body() dto: CreateAPInvoiceDto) {
    return this.apService.createInvoice(dto);
  }

  @Post('invoices/:id/approve')
  @Roles(UserRole.FINANCIAL_CONTROLLER, UserRole.FINANCE_ADMIN)
  approveInvoice(@Param('id') id: string, @Req() req: any) {
    return this.apService.approveInvoice(id, req.user.id);
  }

  @Post('payments')
  @Roles(UserRole.AP_OFFICER, UserRole.TREASURY_OFFICER)
  createPayment(@Body() dto: CreateAPPaymentDto) {
    return this.apService.createPayment(dto);
  }

  @Get('aging')
  getAgingReport() {
    return this.apService.getAgingReport();
  }
}
