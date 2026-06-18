import { Controller, Get, Param, Res, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import * as XLSX from 'xlsx';
import { SessionService } from '../session/session.service';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';

type Row = Record<string, string | number>;

// Turn a WhatsApp jid / raw user id into a clean phone number (leading +).
function formatNumber(raw?: string): string {
  if (!raw) return '';
  const digits = String(raw).split('@')[0].split(':')[0];
  return /^\d+$/.test(digits) ? `+${digits}` : digits;
}

@ApiTags('export')
@Controller('sessions/:sessionId/export')
export class ExportController {
  constructor(private readonly sessionService: SessionService) {}

  @Get('xlsx')
  @RequireRole(ApiKeyRole.VIEWER)
  @ApiOperation({
    summary: 'Export chats, contacts and joined-group members as an Excel (.xlsx) file',
  })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'XLSX workbook download' })
  @ApiResponse({ status: 404, description: 'Session not started' })
  async exportXlsx(
    @Param('sessionId') sessionId: string,
    @Res() res: Response,
  ): Promise<void> {
    const engine = this.sessionService.getEngine(sessionId);
    if (!engine) {
      throw new NotFoundException('Session is not started');
    }

    const [contacts, chats, groups] = await Promise.all([
      engine.getContacts().catch(() => []),
      engine.getChats().catch(() => []),
      engine.getGroups().catch(() => []),
    ]);

    // name lookup by serialized id, built from the address book
    const nameById = new Map<string, string>();
    for (const c of contacts) {
      nameById.set(c.id, c.name || c.pushName || '');
    }

    // Sheet: Chats (1:1 conversations)
    const chatRows: Row[] = chats
      .map(ch => ({
        Name: nameById.get(ch.id) || ch.name || '',
        Number: formatNumber(ch.number || ch.id),
        Unread: ch.unreadCount ?? 0,
      }))
      .sort((a, b) => String(a.Name).localeCompare(String(b.Name)));

    // Sheet: All Contacts (address book)
    const contactRows: Row[] = contacts
      .filter(c => c.id.endsWith('@c.us'))
      .map(c => ({
        Name: c.name || c.pushName || '',
        Number: formatNumber(c.number || c.id),
        Saved: c.isMyContact ? 'Yes' : 'No',
      }))
      .sort((a, b) => String(a.Name).localeCompare(String(b.Name)));

    // Sheets: Groups + Group Members
    const groupRows: Row[] = [];
    const memberRows: Row[] = [];
    for (const g of groups) {
      const info = await engine.getGroupInfo(g.id).catch(() => null);
      const participants = info?.participants ?? [];
      groupRows.push({
        'Group Name': g.name || '',
        Members: participants.length || g.participantsCount || 0,
        'Group ID': g.id,
      });
      for (const p of participants) {
        memberRows.push({
          'Group Name': g.name || '',
          'Member Name': p.name || nameById.get(p.id) || '',
          Number: formatNumber(p.number || p.id),
          Role: p.isSuperAdmin ? 'Owner' : p.isAdmin ? 'Admin' : 'Member',
        });
      }
    }
    groupRows.sort((a, b) =>
      String(a['Group Name']).localeCompare(String(b['Group Name'])),
    );

    // Build the workbook
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(chatRows), 'Chats');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRows), 'All Contacts');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(groupRows), 'Groups');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(memberRows), 'Group Members');

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `whatsapp-export-${stamp}.xlsx`;

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }
}
