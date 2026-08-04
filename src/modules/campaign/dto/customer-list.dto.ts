import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  ValidateNested,
  MaxLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

/** One row of an uploaded customer list. The frontend maps arbitrary JSON keys
 *  (Name/fullName/phone/mobile/number...) down to this shape before sending. */
export class RawRecipientDto {
  @ApiPropertyOptional({ description: 'Customer name', example: 'Ravi Kumar' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiProperty({ description: 'Phone number in any common format', example: '+91 98470 12345' })
  @IsString()
  @MaxLength(40)
  phone: string;
}

export class CreateCustomerListDto {
  @ApiPropertyOptional({ description: 'List name (auto-generated from date if omitted)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: 'Optional description / notes' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ description: 'Default country code (digits) for local numbers, e.g. 91', example: '91' })
  @IsOptional()
  @Matches(/^\+?\d{1,4}$/, { message: 'defaultCountryCode must be 1-4 digits (optionally prefixed with +)' })
  defaultCountryCode?: string;

  @ApiProperty({ description: 'Customers to import (deduplicated by phone)', type: [RawRecipientDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50000)
  @ValidateNested({ each: true })
  @Type(() => RawRecipientDto)
  recipients: RawRecipientDto[];
}

export class UpdateCustomerListDto {
  @ApiPropertyOptional({ description: 'New list name' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ description: 'New description' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
