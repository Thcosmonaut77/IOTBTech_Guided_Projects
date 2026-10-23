import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ARService } from '../services/ar.service';
import { CreateCustomerDto, CreateARInvoiceDto, CreateReceiptDto, CreateCreditNoteDto } from '../dto/ar.dto';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/user-role.enum';

@ApiTags('Accounts Receivable')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ar')
export class ARController {
  constructor(private arService: ARService) {}

  @Get('customers')
  findAllCustomers() {
    return this.arService.findAllCustomers();
  }

  @Get('customers/:id')
  findCustomer(@Param('id') id: string) {
    return this.arService.findCustomer(id);
  }

  @Post('customers')
  @Roles(UserRole.AR_OFFICER, UserRole.FINANCE_ADMIN)
  createCustomer(@Body() dto: CreateCustomerDto) {
    return this.arService.createCustomer(dto);
  }

  @Get('invoices')
  findAllInvoices(@Query('status') status?: string) {
    return this.arService.findAllInvoices(status);
  }

  @Get('invoices/:id')
  findInvoice(@Param('id') id: string) {
    return this.arService.findInvoice(id);
  }

  @Post('invoices')
  @Roles(UserRole.AR_OFFICER, UserRole.ACCOUNTANT)
  createInvoice(@Body() dto: CreateARInvoiceDto) {
    return this.arService.createInvoice(dto);
  }

  @Post('receipts')
  @Roles(UserRole.AR_OFFICER, UserRole.TREASURY_OFFICER)
  createReceipt(@Body() dto: CreateReceiptDto) {
    return this.arService.createReceipt(dto);
  }

  @Post('credit-notes')
  @Roles(UserRole.AR_OFFICER, UserRole.FINANCE_ADMIN)
  createCreditNote(@Body() dto: CreateCreditNoteDto) {
    return this.arService.createCreditNote(dto);
  }

  @Get('aging')
  getAgingReport() {
    return this.arService.getAgingReport();
  }
}
