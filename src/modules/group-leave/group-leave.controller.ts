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
import type { UploadedMediaFile } from './group-leave.service';
import {
  CreateGroupLeaveRuleDto,
  UpdateGroupLeaveRuleDto,
  GroupLeaveRuleResponseDto,
  AudioUploadResponseDto,
} from './dto';
import { GroupLeaveRule } from './entities/group-leave-rule.entity';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

// 16 MB upload cap (covers WhatsApp audio/video/image; documents are larger but capped here).
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

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

  @Post('upload-media')
  @RequireRole(ApiKeyRole.OPERATOR)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload a media file (audio/video/image/document) for a rule' })
  @ApiResponse({ status: 201, description: 'Stored media descriptor', type: AudioUploadResponseDto })
  async uploadMedia(@UploadedFile() file: UploadedMediaFile): Promise<AudioUploadResponseDto> {
    return this.service.uploadMedia(file);
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
