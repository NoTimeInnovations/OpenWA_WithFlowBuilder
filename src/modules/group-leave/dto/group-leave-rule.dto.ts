import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsUUID,
  MaxLength,
  IsIn,
  IsInt,
  Min,
  Max,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const GROUP_EVENTS = ['join', 'leave'] as const;
export type GroupEvent = (typeof GROUP_EVENTS)[number];

export const MEDIA_KINDS = ['audio', 'video', 'image', 'document', 'text'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

// Max delay before sending (10 minutes). Held in-memory, so it doesn't survive a restart.
export const MAX_DELAY_SECONDS = 600;
// Max media items per rule.
export const MAX_MEDIA_ITEMS = 10;

export class RuleMediaItemDto {
  @ApiProperty({ enum: MEDIA_KINDS })
  @IsIn(MEDIA_KINDS)
  kind: MediaKind;

  @ApiPropertyOptional({ description: 'Message body (kind = text)' })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  @ApiPropertyOptional({ description: 'Public URL (provide this OR a storageKey)' })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  url?: string;

  @ApiPropertyOptional({ description: 'Storage key returned by the upload-media endpoint' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  storageKey?: string;

  @ApiPropertyOptional({ description: 'Mime type, e.g. image/jpeg' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  mimetype?: string;

  @ApiPropertyOptional({ description: 'Original file name' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  filename?: string;

  @ApiPropertyOptional({ description: 'Caption (image / video / document)' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;

  @ApiPropertyOptional({ description: 'Send audio as a voice note (PTT)' })
  @IsOptional()
  @IsBoolean()
  asVoice?: boolean;
}

export class CreateGroupLeaveRuleDto {
  @ApiProperty({ description: 'Session that owns the watched group' })
  @IsUUID()
  sessionId: string;

  @ApiPropertyOptional({ description: 'Which event triggers this rule', enum: GROUP_EVENTS, default: 'leave' })
  @IsOptional()
  @IsIn(GROUP_EVENTS)
  event?: GroupEvent;

  @ApiProperty({ description: 'Watched group chat id', example: '123456789@g.us' })
  @IsString()
  @MaxLength(255)
  groupId: string;

  @ApiPropertyOptional({ description: 'Group display name (cached for the UI)' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  groupName?: string;

  @ApiPropertyOptional({ description: 'Media items to send (audio/video/image/document)', type: [RuleMediaItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MEDIA_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => RuleMediaItemDto)
  media?: RuleMediaItemDto[];

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

  @ApiPropertyOptional({ description: `Seconds to wait before sending (0–${MAX_DELAY_SECONDS})`, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DELAY_SECONDS)
  delaySeconds?: number;

  @ApiPropertyOptional({ description: 'Enable/disable the rule', default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class UpdateGroupLeaveRuleDto {
  @ApiPropertyOptional({ description: 'Which event triggers this rule', enum: GROUP_EVENTS })
  @IsOptional()
  @IsIn(GROUP_EVENTS)
  event?: GroupEvent;

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

  @ApiPropertyOptional({ description: 'Media items to send (audio/video/image/document)', type: [RuleMediaItemDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MEDIA_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => RuleMediaItemDto)
  media?: RuleMediaItemDto[];

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

  @ApiPropertyOptional({ description: `Seconds to wait before sending (0–${MAX_DELAY_SECONDS})` })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_DELAY_SECONDS)
  delaySeconds?: number;

  @ApiPropertyOptional({ description: 'Enable/disable the rule' })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class AudioUploadResponseDto {
  @ApiProperty()
  storageKey: string;

  @ApiProperty({ enum: MEDIA_KINDS })
  kind: MediaKind;

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

  @ApiProperty({ enum: GROUP_EVENTS })
  event: GroupEvent;

  @ApiProperty()
  groupId: string;

  @ApiPropertyOptional()
  groupName?: string | null;

  @ApiPropertyOptional({ type: [RuleMediaItemDto] })
  media?: RuleMediaItemDto[] | null;

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
  delaySeconds: number;

  @ApiProperty()
  enabled: boolean;

  @ApiPropertyOptional()
  lastTriggeredAt?: Date | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}
