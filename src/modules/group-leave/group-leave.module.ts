import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GroupLeaveRule } from './entities/group-leave-rule.entity';
import { GroupLeaveService } from './group-leave.service';
import { GroupLeaveController } from './group-leave.controller';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [TypeOrmModule.forFeature([GroupLeaveRule], 'data'), forwardRef(() => SessionModule)],
  controllers: [GroupLeaveController],
  providers: [GroupLeaveService],
  exports: [GroupLeaveService],
})
export class GroupLeaveModule {}
