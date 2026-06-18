import { Module } from '@nestjs/common';
import { ExportController } from './export.controller';
import { SessionModule } from '../session/session.module';

@Module({
  imports: [SessionModule],
  controllers: [ExportController],
})
export class ExportModule {}
