import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsObject,
  IsEnum,
  IsArray,
  Min,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import type { FlowGraph, FlowScopeType } from './flow-graph.types';

export class FlowScopeDto {
  @ApiProperty({ enum: ['session', 'sessions', 'all'], description: 'Targeting mode' })
  @IsEnum(['session', 'sessions', 'all'])
  type: FlowScopeType;

  @ApiPropertyOptional({ description: 'Session UUIDs for session/sessions scope', type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  sessionIds?: string[];
}

export class CreateFlowDto {
  @ApiProperty({ description: 'Flow name', example: 'Welcome bot' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ description: 'Optional description' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @ApiPropertyOptional({ description: 'Whether the flow is active', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiProperty({ description: 'Which session(s) this flow runs on', type: FlowScopeDto })
  @ValidateNested()
  @Type(() => FlowScopeDto)
  scope: FlowScopeDto;

  @ApiProperty({
    description: 'The node-graph document { nodes, edges, viewport? } from the builder',
    type: 'object',
    additionalProperties: true,
  })
  @IsObject()
  graph: FlowGraph;

  @ApiPropertyOptional({ description: 'Keyword that aborts an active run (e.g. "stop")' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  escapeKeyword?: string;

  @ApiPropertyOptional({ description: 'Parked-run auto-abort window (hours)', default: 24 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  runTtlHours?: number;
}

export class UpdateFlowDto {
  @ApiPropertyOptional({ description: 'Flow name' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ description: 'Description' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  description?: string;

  @ApiPropertyOptional({ description: 'Enable/disable' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ description: 'Targeting', type: FlowScopeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => FlowScopeDto)
  scope?: FlowScopeDto;

  @ApiPropertyOptional({ description: 'The node-graph document', type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  graph?: FlowGraph;

  @ApiPropertyOptional({ description: 'Escape keyword' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  escapeKeyword?: string;

  @ApiPropertyOptional({ description: 'Run TTL (hours)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  runTtlHours?: number;
}

export class ListRunsQueryDto {
  @ApiPropertyOptional({ enum: ['active', 'completed', 'aborted', 'expired'] })
  @IsOptional()
  @IsEnum(['active', 'completed', 'aborted', 'expired'])
  status?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}

export class ResetRunsDto {
  @ApiPropertyOptional({ description: 'Limit reset to a single contact jid' })
  @IsOptional()
  @IsString()
  chatId?: string;
}

export class TestFlowDto {
  @ApiProperty({ description: 'Session UUID to simulate against' })
  @IsString()
  sessionId: string;

  @ApiProperty({ description: 'Contact jid to simulate as', example: '15551234567@c.us' })
  @IsString()
  from: string;

  @ApiProperty({ description: 'Inbound message body to simulate' })
  @IsString()
  body: string;

  @ApiPropertyOptional({ description: 'Actually send to WhatsApp (default false = dry-run only)' })
  @IsOptional()
  @IsBoolean()
  send?: boolean;
}

export class FlowResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() description?: string | null;
  @ApiProperty() enabled: boolean;
  @ApiProperty({ type: 'object', additionalProperties: true }) scope: FlowScopeDto;
  @ApiProperty({ type: 'object', additionalProperties: true }) graph: FlowGraph;
  @ApiPropertyOptional() escapeKeyword?: string | null;
  @ApiProperty() runTtlHours: number;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}
