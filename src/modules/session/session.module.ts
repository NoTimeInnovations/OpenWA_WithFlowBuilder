import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Session } from './entities/session.entity';
import { SessionService } from './session.service';
import { SessionController } from './session.controller';
import { WebhookModule } from '../webhook/webhook.module';
import { FlowModule } from '../flow/flow.module';
import { GroupLeaveModule } from '../group-leave/group-leave.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Session], 'data'),
    forwardRef(() => WebhookModule),
    forwardRef(() => FlowModule),
    forwardRef(() => GroupLeaveModule),
  ],
  controllers: [SessionController],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}
