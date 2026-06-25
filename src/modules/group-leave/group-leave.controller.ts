import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiConsumes } from '@nestjs/swagger';
import { GroupLeaveService } from './group-leave.service';
import type { UploadedAudioFile } from './group-leave.service';
import {
  CreateGroupLeaveRuleDto,
  UpdateGroupLeaveRuleDto,
  GroupLeaveRuleResponseDto,
  AudioUploadResponseDto,
} from './dto';
import { GroupLeaveRule } from './entities/group-leave-rule.entity';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

// 16 MB — WhatsApp's audio message size limit.
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;

@ApiTags('group-leave')
@Controller('group-leave-rules')
export class GroupLeaveController {
  constructor(private readonly service: GroupLeaveService) {}

  @Get()
  @ApiOperation({ summary: 'List all group-leave audio rules' })
  @ApiResponse({ status: 200, description: 'List of rules', type: [GroupLeaveRuleResponseDto] })
  async findAll(): Promise<GroupLeaveRule[]> {
    return this.service.findAll();
  }

  @Post()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Create a group-leave audio rule' })
  @ApiResponse({ status: 201, description: 'Rule created', type: GroupLeaveRuleResponseDto })
  async create(@Body() dto: CreateGroupLeaveRuleDto): Promise<GroupLeaveRule> {
    return this.service.create(dto);
  }

  @Post('upload-audio')
  @RequireRole(ApiKeyRole.OPERATOR)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_AUDIO_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an audio file for a group-leave rule' })
  @ApiResponse({ status: 201, description: 'Stored audio descriptor', type: AudioUploadResponseDto })
  async uploadAudio(@UploadedFile() file: UploadedAudioFile): Promise<AudioUploadResponseDto> {
    return this.service.uploadAudio(file);
  }

  @Put(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Update a group-leave audio rule' })
  @ApiParam({ name: 'id', description: 'Rule ID' })
  @ApiResponse({ status: 200, description: 'Rule updated', type: GroupLeaveRuleResponseDto })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateGroupLeaveRuleDto): Promise<GroupLeaveRule> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.OPERATOR)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a group-leave audio rule' })
  @ApiParam({ name: 'id', description: 'Rule ID' })
  @ApiResponse({ status: 204, description: 'Rule deleted' })
  @ApiResponse({ status: 404, description: 'Rule not found' })
  async delete(@Param('id') id: string): Promise<void> {
    return this.service.delete(id);
  }
}
