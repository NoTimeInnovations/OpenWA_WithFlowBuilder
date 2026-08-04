import { Global, Module } from '@nestjs/common';
import { MessageAckService } from './message-ack.service';

/**
 * Global so both SessionService (producer) and CampaignService (consumer) can
 * inject MessageAckService without importing each other's module.
 */
@Global()
@Module({
  providers: [MessageAckService],
  exports: [MessageAckService],
})
export class MessageAckModule {}
