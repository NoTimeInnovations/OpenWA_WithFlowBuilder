import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsInt,
  IsIn,
  Min,
  Max,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CampaignMediaDto {
  @ApiProperty({ description: 'Media kind', enum: ['image', 'video', 'document', 'audio'] })
  @IsIn(['image', 'video', 'document', 'audio'])
  kind: 'image' | 'video' | 'document' | 'audio';

  @ApiPropertyOptional({ description: 'Public URL of the media' })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ description: 'Base64 payload (alternative to url)' })
  @IsOptional()
  @IsString()
  base64?: string;

  @ApiPropertyOptional({ description: 'MIME type, e.g. image/jpeg' })
  @IsOptional()
  @IsString()
  mimetype?: string;

  @ApiPropertyOptional({ description: 'File name (documents)' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ description: 'Caption (supports {name}/{phone})' })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  caption?: string;
}

export class CampaignMessageDto {
  @ApiProperty({ description: 'Message text template. Supports {name} and {phone}.' })
  @IsString()
  @MaxLength(4096)
  text: string;

  @ApiPropertyOptional({ description: 'Optional media attachment', type: CampaignMediaDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignMediaDto)
  media?: CampaignMediaDto;
}

export class CampaignOptionsDto {
  @ApiPropertyOptional({ description: 'Base delay between messages in ms', default: 20000 })
  @IsOptional()
  @IsInt()
  @Min(3000)
  @Max(600000)
  delayBetweenMessages?: number;

  @ApiPropertyOptional({ description: 'Add random jitter to the delay', default: true })
  @IsOptional()
  @IsBoolean()
  randomizeDelay?: boolean;

  @ApiPropertyOptional({ description: 'Max extra random ms added to the delay', default: 15000 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300000)
  randomizeExtraMs?: number;

  @ApiPropertyOptional({ description: 'Stop the whole run on the first failure', default: false })
  @IsOptional()
  @IsBoolean()
  stopOnError?: boolean;

  @ApiPropertyOptional({ description: 'Skip recipients already sent in a previous run of this list', default: true })
  @IsOptional()
  @IsBoolean()
  skipAlreadySent?: boolean;
}

export class CreateCampaignDto {
  @ApiProperty({ description: 'Customer list id to send to' })
  @IsString()
  listId: string;

  @ApiProperty({ description: 'Session id (the sending WhatsApp number) — must be connected' })
  @IsString()
  sessionId: string;

  @ApiPropertyOptional({ description: 'Campaign/run name (auto-generated if omitted)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiProperty({ description: 'Message to send', type: CampaignMessageDto })
  @ValidateNested()
  @Type(() => CampaignMessageDto)
  message: CampaignMessageDto;

  @ApiPropertyOptional({ description: 'Send options', type: CampaignOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CampaignOptionsDto)
  options?: CampaignOptionsDto;
}
