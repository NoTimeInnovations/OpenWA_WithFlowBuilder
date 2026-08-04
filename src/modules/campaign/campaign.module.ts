import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomerList } from './entities/customer-list.entity';
import { Campaign } from './entities/campaign.entity';
import { CustomerListService } from './customer-list.service';
import { CampaignService } from './campaign.service';
import { CustomerListController } from './customer-list.controller';
import { CampaignController } from './campaign.controller';
import { SessionModule } from '../session/session.module';

/**
 * Customer Lists + Campaigns: upload a JSON list of customers, then send a
 * personalized, interval-spaced WhatsApp broadcast to it from a chosen session,
 * with per-recipient status tracking. MessageAckService is provided globally.
 */
@Module({
  imports: [TypeOrmModule.forFeature([CustomerList, Campaign], 'data'), SessionModule],
  controllers: [CustomerListController, CampaignController],
  providers: [CustomerListService, CampaignService],
  exports: [CustomerListService, CampaignService],
})
export class CampaignModule {}
