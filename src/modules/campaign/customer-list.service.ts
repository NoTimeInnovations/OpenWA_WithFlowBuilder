import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CustomerList, CustomerListRecipient } from './entities/customer-list.entity';
import { CreateCustomerListDto, UpdateCustomerListDto } from './dto';
import { normalizePhone } from './utils/phone.util';

/** List row without the (potentially large) recipients array, for table views. */
export type CustomerListSummary = Omit<CustomerList, 'recipients'>;

export interface ImportResult {
  list: CustomerList;
  summary: {
    received: number; // rows in the upload
    imported: number; // unique, valid recipients stored
    duplicates: number; // dropped as duplicate phone
    invalid: number; // dropped as unparseable phone
  };
}

@Injectable()
export class CustomerListService {
  private readonly logger = new Logger(CustomerListService.name);

  constructor(
    @InjectRepository(CustomerList, 'data')
    private readonly listRepository: Repository<CustomerList>,
  ) {}

  async import(dto: CreateCustomerListDto): Promise<ImportResult> {
    const countryCode = (dto.defaultCountryCode ?? '').replace(/\D/g, '') || null;

    const seen = new Set<string>();
    const recipients: CustomerListRecipient[] = [];
    let duplicates = 0;
    let invalid = 0;

    for (const row of dto.recipients) {
      const normalized = normalizePhone(row.phone, countryCode);
      if (!normalized.valid) {
        invalid++;
        continue;
      }
      if (seen.has(normalized.jid)) {
        duplicates++;
        continue;
      }
      seen.add(normalized.jid);
      recipients.push({
        name: (row.name ?? '').trim() || normalized.digits,
        phone: normalized.digits,
        jid: normalized.jid,
        raw: normalized.raw,
      });
    }

    if (recipients.length === 0) {
      throw new BadRequestException('No valid phone numbers found in the upload');
    }

    const name = (dto.name ?? '').trim() || this.defaultName();

    const list = this.listRepository.create({
      name,
      description: dto.description?.trim() || null,
      defaultCountryCode: countryCode,
      source: 'json-upload',
      recipients,
      recipientCount: recipients.length,
      lastCampaignAt: null,
    });

    const saved = await this.listRepository.save(list);
    this.logger.log(
      `Imported list "${saved.name}" (${saved.id}): ${recipients.length} imported, ${duplicates} dup, ${invalid} invalid`,
    );

    return {
      list: saved,
      summary: {
        received: dto.recipients.length,
        imported: recipients.length,
        duplicates,
        invalid,
      },
    };
  }

  async findAll(): Promise<CustomerListSummary[]> {
    const lists = await this.listRepository.find({ order: { createdAt: 'DESC' } });
    return lists.map(l => this.toSummary(l));
  }

  async findOne(id: string): Promise<CustomerList> {
    const list = await this.listRepository.findOne({ where: { id } });
    if (!list) {
      throw new NotFoundException(`Customer list '${id}' not found`);
    }
    return list;
  }

  async update(id: string, dto: UpdateCustomerListDto): Promise<CustomerList> {
    const list = await this.findOne(id);
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) throw new BadRequestException('name cannot be empty');
      list.name = trimmed;
    }
    if (dto.description !== undefined) {
      list.description = dto.description.trim() || null;
    }
    return this.listRepository.save(list);
  }

  async remove(id: string): Promise<void> {
    const result = await this.listRepository.delete({ id });
    if (!result.affected) {
      throw new NotFoundException(`Customer list '${id}' not found`);
    }
  }

  /** Stamp the list as recently used (called when a campaign starts). */
  async touchLastCampaign(id: string): Promise<void> {
    await this.listRepository.update({ id }, { lastCampaignAt: new Date() });
  }

  private toSummary(list: CustomerList): CustomerListSummary {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { recipients, ...summary } = list;
    return summary;
  }

  private defaultName(): string {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `List ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(
      now.getMinutes(),
    )}`;
  }
}
