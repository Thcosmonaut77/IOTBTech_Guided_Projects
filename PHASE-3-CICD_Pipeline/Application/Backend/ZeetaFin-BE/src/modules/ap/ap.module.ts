import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vendor } from './entities/vendor.entity';
import { APInvoice } from './entities/ap-invoice.entity';
import { APPayment } from './entities/ap-payment.entity';
import { APService } from './services/ap.service';
import { APController } from './controllers/ap.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Vendor, APInvoice, APPayment])],
  controllers: [APController],
  providers: [APService],
  exports: [APService],
})
export class APModule {}
