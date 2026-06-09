import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Flow } from './entities/flow.entity';
import { FlowExecutionState } from './entities/flow-execution-state.entity';
import { FlowService } from './flow.service';
import { FlowEngineService } from './flow-engine.service';
import { FlowController } from './flow.controller';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [TypeOrmModule.forFeature([Flow, FlowExecutionState], 'data'), forwardRef(() => SessionModule)],
  controllers: [FlowController],
  providers: [FlowService, FlowEngineService],
  exports: [FlowService, FlowEngineService],
})
export class FlowModule {}
