import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Customer } from './entities/customer.entity';
import { ARInvoice, ARReceipt, ARCreditNote } from './entities/ar-invoice.entity';
import { ARService } from './services/ar.service';
import { ARController } from './controllers/ar.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, ARInvoice, ARReceipt, ARCreditNote])],
  controllers: [ARController],
  providers: [ARService],
  exports: [ARService],
})
export class ARModule {}
