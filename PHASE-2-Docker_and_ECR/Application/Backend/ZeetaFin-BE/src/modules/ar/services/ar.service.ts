import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../entities/customer.entity';
import { ARInvoice, ARInvoiceStatus, ARReceipt, ARCreditNote } from '../entities/ar-invoice.entity';
import { CreateCustomerDto, CreateARInvoiceDto, CreateReceiptDto, CreateCreditNoteDto } from '../dto/ar.dto';

@Injectable()
export class ARService {
  constructor(
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(ARInvoice)
    private invoiceRepository: Repository<ARInvoice>,
    @InjectRepository(ARReceipt)
    private receiptRepository: Repository<ARReceipt>,
    @InjectRepository(ARCreditNote)
    private creditNoteRepository: Repository<ARCreditNote>,
  ) {}

  async findAllCustomers(): Promise<Customer[]> {
    return this.customerRepository.find({ order: { name: 'ASC' } });
  }

  async findCustomer(id: string): Promise<Customer> {
    const customer = await this.customerRepository.findOne({ where: { id } });
    if (!customer) throw new NotFoundException('Customer not found');
    return customer;
  }

  async createCustomer(dto: CreateCustomerDto): Promise<Customer> {
    const customer = this.customerRepository.create(dto);
    return this.customerRepository.save(customer);
  }

  async findAllInvoices(status?: string): Promise<ARInvoice[]> {
    const where: any = {};
    if (status) where.status = status;
    return this.invoiceRepository.find({
      where,
      relations: ['customer'],
      order: { createdAt: 'DESC' },
    });
  }

  async findInvoice(id: string): Promise<ARInvoice> {
    const invoice = await this.invoiceRepository.findOne({
      where: { id },
      relations: ['customer'],
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    return invoice;
  }

  async createInvoice(dto: CreateARInvoiceDto): Promise<ARInvoice> {
    const invoice = this.invoiceRepository.create({
      ...dto,
      invoiceDate: dto.invoiceDate as unknown as Date,
      dueDate: dto.dueDate as unknown as Date,
      outstandingAmount: dto.amount,
      status: ARInvoiceStatus.SENT,
    });
    const saved = await this.invoiceRepository.save(invoice);
    await this.customerRepository.update(dto.customerId, {
      outstandingBalance: () => `outstanding_balance + ${dto.amount}`,
    });
    return this.findInvoice(saved.id);
  }

  async createReceipt(dto: CreateReceiptDto): Promise<ARReceipt> {
    const invoice = await this.findInvoice(dto.invoiceId);
    if (invoice.status === ARInvoiceStatus.PAID) {
      throw new BadRequestException('Invoice is already paid');
    }
    if (dto.amount > invoice.outstandingAmount) {
      throw new BadRequestException('Receipt amount exceeds outstanding balance');
    }

    const receipt = this.receiptRepository.create({
      ...dto,
      receiptDate: dto.receiptDate as unknown as Date,
    });
    await this.receiptRepository.save(receipt);

    const newPaid = Number(invoice.paidAmount) + dto.amount;
    const newOutstanding = Number(invoice.outstandingAmount) - dto.amount;
    const newStatus = newOutstanding <= 0 ? ARInvoiceStatus.PAID : ARInvoiceStatus.PARTIAL;

    await this.invoiceRepository.update(dto.invoiceId, {
      paidAmount: newPaid,
      outstandingAmount: newOutstanding,
      status: newStatus,
    });

    await this.customerRepository.update(invoice.customerId, {
      outstandingBalance: () => `outstanding_balance - ${dto.amount}`,
    });

    return receipt;
  }

  async createCreditNote(dto: CreateCreditNoteDto): Promise<ARCreditNote> {
    const invoice = await this.findInvoice(dto.invoiceId);
    const count = await this.creditNoteRepository.count();
    const creditNote = this.creditNoteRepository.create({
      ...dto,
      creditNoteNumber: `CN-${String(count + 1).padStart(6, '0')}`,
      creditNoteDate: dto.creditNoteDate as unknown as Date,
    });
    await this.creditNoteRepository.save(creditNote);

    const newOutstanding = Number(invoice.outstandingAmount) - dto.amount;
    const newStatus = newOutstanding <= 0 ? ARInvoiceStatus.PAID : invoice.status;

    await this.invoiceRepository.update(dto.invoiceId, {
      outstandingAmount: newOutstanding,
      status: newStatus,
    });

    await this.customerRepository.update(invoice.customerId, {
      outstandingBalance: () => `outstanding_balance - ${dto.amount}`,
    });

    return creditNote;
  }

  async getAgingReport() {
    const invoices = await this.invoiceRepository.find({
      where: [
        { status: ARInvoiceStatus.SENT },
        { status: ARInvoiceStatus.PARTIAL },
        { status: ARInvoiceStatus.OVERDUE },
      ],
      relations: ['customer'],
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
