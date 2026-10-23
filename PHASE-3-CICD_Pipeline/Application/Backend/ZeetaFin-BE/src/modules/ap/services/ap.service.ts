import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vendor } from '../entities/vendor.entity';
import { APInvoice, InvoiceStatus } from '../entities/ap-invoice.entity';
import { APPayment } from '../entities/ap-payment.entity';
import { CreateVendorDto, CreateAPInvoiceDto, CreateAPPaymentDto } from '../dto/ap.dto';

@Injectable()
export class APService {
  constructor(
    @InjectRepository(Vendor)
    private vendorRepository: Repository<Vendor>,
    @InjectRepository(APInvoice)
    private invoiceRepository: Repository<APInvoice>,
    @InjectRepository(APPayment)
    private paymentRepository: Repository<APPayment>,
  ) {}

  // Vendors
  async findAllVendors(): Promise<Vendor[]> {
    return this.vendorRepository.find({ order: { name: 'ASC' } });
  }

  async findVendor(id: string): Promise<Vendor> {
    const vendor = await this.vendorRepository.findOne({ where: { id } });
    if (!vendor) throw new NotFoundException('Vendor not found');
    return vendor;
  }

  async createVendor(dto: CreateVendorDto): Promise<Vendor> {
    const vendor = this.vendorRepository.create(dto);
    return this.vendorRepository.save(vendor);
  }

  // Invoices
  async findAllInvoices(status?: string): Promise<APInvoice[]> {
    const where: any = {};
    if (status) where.status = status;
    return this.invoiceRepository.find({
      where,
      relations: ['vendor'],
      order: { createdAt: 'DESC' },
    });
  }

  async findInvoice(id: string): Promise<APInvoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id },
      relations: ['vendor'],
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async createInvoice(dto: CreateAPInvoiceDto): Promise<APInvoice> {
    const invoice = this.invoiceRepository.create({
      ...dto,
      invoiceDate: dto.invoiceDate as unknown as Date,
      dueDate: dto.dueDate as unknown as Date,
      outstandingAmount: dto.amount,
      status: InvoiceStatus.PENDING,
    });
    const saved = await this.invoiceRepository.save(invoice);
    await this.vendorRepository.update(dto.vendorId, {
      outstandingBalance: () => `outstanding_balance + ${dto.amount}`,
    });
    return this.findInvoice(saved.id);
  }

  async approveInvoice(id: string, userId: string): Promise<APInvoice> {
    const invoice = await this.findInvoice(id);
    if (invoice.status !== InvoiceStatus.PENDING) {
      throw new BadRequestException('Only pending invoices can be approved');
    }
    invoice.status = InvoiceStatus.APPROVED;
    invoice.approvedById = userId;
    invoice.approvedAt = new Date();
    return this.invoiceRepository.save(invoice);
  }

  // Payments
  async createPayment(dto: CreateAPPaymentDto): Promise<APPayment> {
    const invoice = await this.findInvoice(dto.invoiceId);
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already paid');
    }
    if (dto.amount > invoice.outstandingAmount) {
      throw new BadRequestException('Payment amount exceeds outstanding balance');
    }

    const payment = this.paymentRepository.create({
      ...dto,
      paymentDate: dto.paymentDate as unknown as Date,
    });
    await this.paymentRepository.save(payment);

    const newPaid = Number(invoice.paidAmount) + dto.amount;
    const newOutstanding = Number(invoice.outstandingAmount) - dto.amount;
    const newStatus = newOutstanding <= 0 ? InvoiceStatus.PAID : invoice.status;

    await this.invoiceRepository.update(dto.invoiceId, {
      paidAmount: newPaid,
      outstandingAmount: newOutstanding,
      status: newStatus,
    });

    await this.vendorRepository.update(invoice.vendorId, {
      outstandingBalance: () => `outstanding_balance - ${dto.amount}`,
    });

    return payment;
  }

  async getAgingReport() {
    const invoices = await this.invoiceRepository.find({
      where: { status: InvoiceStatus.APPROVED },
      relations: ['vendor'],
    });
    const now = new Date();
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const details: any[] = [];

    for (const inv of invoices) {
      const diffDays = Math.floor((now.getTime() - new Date(inv.dueDate).getTime()) / (1000 * 3600 * 24));
      let bucket: string;
      if (diffDays <= 30) bucket = '0-30';
      else if (diffDays <= 60) bucket = '31-60';
      else if (diffDays <= 90) bucket = '61-90';
      else bucket = '90+';

      buckets[bucket as keyof typeof buckets] += Number(inv.outstandingAmount);
      details.push({ invoice: inv, daysOverdue: diffDays, bucket });
    }

    return { buckets, details, totalOutstanding: invoices.reduce((s, i) => s + Number(i.outstandingAmount), 0) };
  }
}
