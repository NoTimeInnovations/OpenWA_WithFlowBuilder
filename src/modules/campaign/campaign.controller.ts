import { Controller, Get, Post, Delete, Param, Body, Query, Res, HttpCode, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { CampaignService } from './campaign.service';
import { CreateCampaignDto } from './dto';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('campaigns')
@Controller('campaigns')
export class CampaignController {
  constructor(private readonly campaignService: CampaignService) {}

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Create and start a campaign run for a customer list' })
  create(@Body() dto: CreateCampaignDto) {
    return this.campaignService.create(dto);
  }

  @Get()
  @ApiQuery({ name: 'listId', required: false, description: 'Filter by customer list id' })
  @ApiOperation({ summary: 'List campaign runs (optionally filtered by list)' })
  findAll(@Query('listId') listId?: string) {
    return this.campaignService.findAll(listId);
  }

  @Get(':id')
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiOperation({ summary: 'Get a campaign with per-recipient status' })
  findOne(@Param('id') id: string) {
    return this.campaignService.findOne(id);
  }

  @Post(':id/pause')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiOperation({ summary: 'Pause a running campaign' })
  pause(@Param('id') id: string) {
    return this.campaignService.pause(id);
  }

  @Post(':id/resume')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiOperation({ summary: 'Resume a paused campaign' })
  resume(@Param('id') id: string) {
    return this.campaignService.resume(id);
  }

  @Post(':id/cancel')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiOperation({ summary: 'Cancel a campaign' })
  cancel(@Param('id') id: string) {
    return this.campaignService.cancel(id);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiOperation({ summary: 'Delete a campaign run' })
  remove(@Param('id') id: string) {
    return this.campaignService.remove(id);
  }

  @Get(':id/export')
  @ApiParam({ name: 'id', description: 'Campaign id' })
  @ApiOperation({ summary: 'Download per-recipient status as CSV' })
  async export(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { filename, csv } = await this.campaignService.exportCsv(id);
    res.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(csv);
  }
}
