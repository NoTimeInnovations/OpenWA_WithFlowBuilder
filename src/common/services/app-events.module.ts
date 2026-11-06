import { Global, Module } from '@nestjs/common';
import { AppEventsService } from './app-events.service';

/** Global so the session core (producer) and our feature modules (consumers) share one bus. */
@Global()
@Module({
  providers: [AppEventsService],
  exports: [AppEventsService],
})
export class AppEventsModule {}
