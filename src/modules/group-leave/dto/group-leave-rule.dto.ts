import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, IsUUID, MaxLength } from 'class-validator';

export class CreateGroupLeaveRuleDto {
  @ApiProperty({ description: 'Session that owns the watched group' })
  @IsUUID()
  sessionId: string;

  @ApiProperty({ description: 'Watched group chat id', example: '123456789@g.us' })
  @IsString()
  @MaxLength(255)
  groupId: string;

  @ApiPropertyOptional({ description: 'Group display name (cached for the UI)' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  groupName?: string;

  @ApiPropertyOptional({ description: 'Audio file URL (provide this OR upload a file)' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  audioUrl?: string;

  @ApiPropertyOptional({ description: 'Storage key returned by the upload-audio endpoint' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  audioStorageKey?: string;

  @ApiPropertyOptional({ description: 'Audio mime type, e.g. audio/mpeg' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  audioMimetype?: string;

  @ApiPropertyOptional({ description: 'Original audio file name' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  audioFilename?: string;

  @ApiPropertyOptional({ description: 'Send the audio as a voice note (PTT)', default: true })
  @IsOptional()
  @IsBoolean()
  sendAsVoice?: boolean;

  @ApiPropertyOptional({ description: 'Enable/disable the rule', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateGroupLeaveRuleDto {
  @ApiPropertyOptional({ description: 'Watched group chat id' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  groupId?: string;

  @ApiPropertyOptional({ description: 'Group display name' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  groupName?: string;

  @ApiPropertyOptional({ description: 'Audio file URL' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  audioUrl?: string;

  @ApiPropertyOptional({ description: 'Storage key returned by the upload-audio endpoint' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  audioStorageKey?: string;

  @ApiPropertyOptional({ description: 'Audio mime type' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  audioMimetype?: string;

  @ApiPropertyOptional({ description: 'Original audio file name' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  audioFilename?: string;

  @ApiPropertyOptional({ description: 'Send the audio as a voice note (PTT)' })
  @IsOptional()
  @IsBoolean()
  sendAsVoice?: boolean;

  @ApiPropertyOptional({ description: 'Enable/disable the rule' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class AudioUploadResponseDto {
  @ApiProperty()
  storageKey: string;

  @ApiProperty()
  mimetype: string;

  @ApiProperty()
  filename: string;

  @ApiProperty()
  size: number;
}

export class GroupLeaveRuleResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  sessionId: string;

  @ApiProperty()
  groupId: string;

  @ApiPropertyOptional()
  groupName?: string | null;

  @ApiPropertyOptional()
  audioUrl?: string | null;

  @ApiPropertyOptional()
  audioStorageKey?: string | null;

  @ApiPropertyOptional()
  audioMimetype?: string | null;

  @ApiPropertyOptional()
  audioFilename?: string | null;

  @ApiProperty()
  sendAsVoice: boolean;

  @ApiProperty()
  enabled: boolean;

  @ApiPropertyOptional()
  lastTriggeredAt?: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
