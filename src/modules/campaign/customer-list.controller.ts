import { Controller, Get, Post, Patch, Delete, Param, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { CustomerListService } from './customer-list.service';
import { CampaignService } from './campaign.service';
import { CreateCustomerListDto, UpdateCustomerListDto } from './dto';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('campaigns')
@Controller('customer-lists')
export class CustomerListController {
  constructor(
    private readonly listService: CustomerListService,
    private readonly campaignService: CampaignService,
  ) {}

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Import a customer list from JSON (deduplicated by phone)' })
  import(@Body() dto: CreateCustomerListDto) {
    return this.listService.import(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all customer lists (without recipients)' })
  findAll() {
    return this.listService.findAll();
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'Customer list id' })
  @ApiOperation({ summary: 'Get a customer list with its recipients' })
  findOne(@Param('id') id: string) {
    return this.listService.findOne(id);
  }

  @Patch(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiParam({ name: 'id', description: 'Customer list id' })
  @ApiOperation({ summary: 'Rename or update a customer list' })
  update(@Param('id') id: string, @Body() dto: UpdateCustomerListDto) {
    return this.listService.update(id, dto);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', description: 'Customer list id' })
  @ApiOperation({ summary: 'Delete a customer list' })
  remove(@Param('id') id: string) {
    return this.listService.remove(id);
  }

  @Get(':id/campaigns')
  @ApiParam({ name: 'id', description: 'Customer list id' })
  @ApiOperation({ summary: 'List the campaign runs for this list' })
  campaigns(@Param('id') id: string) {
    return this.campaignService.findAll(id);
  }
}
