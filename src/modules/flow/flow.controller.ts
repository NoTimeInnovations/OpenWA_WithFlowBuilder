import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { FlowService } from './flow.service';
import { FlowEngineService, DryRunResult } from './flow-engine.service';
import { CreateFlowDto, UpdateFlowDto, FlowResponseDto, ListRunsQueryDto, ResetRunsDto, TestFlowDto } from './dto';
import { Flow } from './entities/flow.entity';
import { FlowExecutionState } from './entities/flow-execution-state.entity';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

@ApiTags('flows')
@Controller('flows')
export class FlowController {
  constructor(
    private readonly flowService: FlowService,
    private readonly flowEngine: FlowEngineService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all messaging flows' })
  @ApiResponse({ status: 200, type: [FlowResponseDto] })
  async findAll(): Promise<Flow[]> {
    return this.flowService.findAll();
  }

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Create a messaging flow' })
  @ApiResponse({ status: 201, type: FlowResponseDto })
  async create(@Body() dto: CreateFlowDto): Promise<Flow> {
    return this.flowService.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a flow by ID (including full graph)' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  @ApiResponse({ status: 200, type: FlowResponseDto })
  @ApiResponse({ status: 404, description: 'Flow not found' })
  async findOne(@Param('id') id: string): Promise<Flow> {
    return this.flowService.findOne(id);
  }

  @Put(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Update a flow' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  @ApiResponse({ status: 200, type: FlowResponseDto })
  async update(@Param('id') id: string, @Body() dto: UpdateFlowDto): Promise<Flow> {
    return this.flowService.update(id, dto);
  }

  @Patch(':id/enable')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Enable a flow' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  async enable(@Param('id') id: string): Promise<Flow> {
    return this.flowService.setEnabled(id, true);
  }

  @Patch(':id/disable')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Disable a flow' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  async disable(@Param('id') id: string): Promise<Flow> {
    return this.flowService.setEnabled(id, false);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a flow' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  @ApiResponse({ status: 204, description: 'Flow deleted' })
  async delete(@Param('id') id: string): Promise<void> {
    return this.flowService.delete(id);
  }

  @Post(':id/test')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Dry-run a simulated inbound message against the flow (no message is sent)' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  async test(@Param('id') id: string, @Body() dto: TestFlowDto): Promise<DryRunResult> {
    const flow = await this.flowService.findOne(id);
    return this.flowEngine.dryRun(flow, dto.sessionId, dto.from, dto.body);
  }

  @Get(':id/runs')
  @ApiOperation({ summary: 'List recent execution runs for a flow' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  async listRuns(@Param('id') id: string, @Query() query: ListRunsQueryDto): Promise<FlowExecutionState[]> {
    return this.flowService.listRuns(id, query);
  }

  @Post(':id/runs/reset')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Abort active runs for a flow (optionally a single contact)' })
  @ApiParam({ name: 'id', description: 'Flow ID' })
  async resetRuns(@Param('id') id: string, @Body() dto: ResetRunsDto): Promise<{ aborted: number }> {
    const aborted = await this.flowService.resetRuns(id, dto.chatId);
    return { aborted };
  }
}
