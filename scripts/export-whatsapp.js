#!/usr/bin/env node
/**
 * Export WhatsApp chats + joined-group members to a single Excel file.
 *
 * Standalone — does NOT need the NestJS server or the database. It opens its
 * own whatsapp-web.js client (separate "export" session so it won't clash with
 * the app's sessions), shows a QR to scan once, then writes an .xlsx workbook.
 *
 *   Usage:  node scripts/export-whatsapp.js
 *
 * Output:  exports/whatsapp-export-<timestamp>.xlsx  with sheets:
 *   - Chats         : every 1:1 conversation (name + phone number)
 *   - All Contacts  : full address book (name + phone number + saved?)
 *   - Groups        : each joined group (name + member count)
 *   - Group Members : one row per member per group (group, name, number, role)
 *
 * Scan the QR with WhatsApp on your phone:
 *   WhatsApp > Settings > Linked Devices > Link a Device
 */

const path = require('path');
const fs = require('fs');
const qrcode = require('qrcode');
const XLSX = require('xlsx');
const { Client, LocalAuth } = require('whatsapp-web.js');

// Keep this session isolated from the app's ./data/sessions sessions.
const SESSION_DATA_PATH = path.resolve(__dirname, '..', 'data');
const CLIENT_ID = 'export';
const OUT_DIR = path.resolve(__dirname, '..', 'exports');

// Turn a WhatsApp id/jid into a clean phone number string (no @c.us, leading +).
function toNumber(idOrUser) {
  if (!idOrUser) return '';
  const user = String(idOrUser).split('@')[0].split(':')[0];
  return /^\d+$/.test(user) ? `+${user}` : user;
}

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(msg);
}

async function main() {
  log('Starting WhatsApp export client...');

  const client = new Client({
    authStrategy: new LocalAuth({ clientId: CLIENT_ID, dataPath: SESSION_DATA_PATH }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    },
  });

  client.on('qr', async qr => {
    log('\nScan this QR with WhatsApp > Linked Devices > Link a Device:\n');
    log(await qrcode.toString(qr, { type: 'terminal', small: true }));
    log('Waiting for scan...');
  });

  client.on('authenticated', () => log('Authenticated. Loading data...'));
  client.on('auth_failure', m => {
    log(`Auth failure: ${m}`);
    process.exit(1);
  });

  client.on('ready', async () => {
    try {
      // ---- pull everything ----
      log('Fetching contacts...');
      const contacts = await client.getContacts();

      log('Fetching chats...');
      const chats = await client.getChats();

      // name lookup by serialized id, built from the address book
      const nameById = new Map();
      for (const c of contacts) {
        const id = c.id && c.id._serialized;
        if (!id) continue;
        nameById.set(id, c.name || c.pushName || '');
      }
      const nameFor = (id, fallback = '') => nameById.get(id) || fallback;

      // ---- Sheet: All Contacts ----
      const contactRows = contacts
        .filter(c => c.id && c.id._serialized && c.id._serialized.endsWith('@c.us'))
        .filter(c => c.isWAContact !== false) // drop non-WhatsApp address-book entries
        .map(c => ({
          Name: c.name || c.pushName || '',
          Number: c.number ? `+${String(c.number)}` : toNumber(c.id._serialized),
          'Saved Contact': c.isMyContact ? 'Yes' : 'No',
          Business: c.isBusiness ? 'Yes' : 'No',
        }))
        .sort((a, b) => a.Name.localeCompare(b.Name));

      // ---- Sheet: Chats (1:1 conversations only) ----
      const chatRows = chats
        .filter(ch => !ch.isGroup && ch.id && ch.id._serialized.endsWith('@c.us'))
        .map(ch => ({
          Name: nameFor(ch.id._serialized, ch.name || ''),
          Number: toNumber(ch.id.user || ch.id._serialized),
          Unread: ch.unreadCount || 0,
        }))
        .sort((a, b) => a.Name.localeCompare(b.Name));

      // ---- Sheets: Groups + Group Members ----
      const groups = chats.filter(ch => ch.isGroup);
      const groupRows = [];
      const memberRows = [];

      for (const g of groups) {
        const participants = g.participants || [];
        groupRows.push({
          'Group Name': g.name || '',
          Members: participants.length,
          'Group ID': g.id._serialized,
        });
        for (const p of participants) {
          const pid = p.id && p.id._serialized;
          const number = toNumber((p.id && p.id.user) || pid);
          memberRows.push({
            'Group Name': g.name || '',
            'Member Name': nameFor(pid, ''),
            Number: number,
            Role: p.isSuperAdmin ? 'Owner' : p.isAdmin ? 'Admin' : 'Member',
          });
        }
      }
      groupRows.sort((a, b) => String(a['Group Name']).localeCompare(String(b['Group Name'])));

      // ---- write workbook ----
      if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const outFile = path.join(OUT_DIR, `whatsapp-export-${stamp}.xlsx`);

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(chatRows), 'Chats');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(contactRows), 'All Contacts');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(groupRows), 'Groups');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(memberRows), 'Group Members');
      XLSX.writeFile(wb, outFile);

      log('\n================ Export complete ================');
      log(`Chats (1:1):        ${chatRows.length}`);
      log(`Contacts:           ${contactRows.length}`);
      log(`Groups joined:      ${groupRows.length}`);
      log(`Group member rows:  ${memberRows.length}`);
      log(`\nSaved to: ${outFile}`);
      log('=================================================\n');
    } catch (err) {
      log(`Export failed: ${err && err.stack ? err.stack : err}`);
      process.exitCode = 1;
    } finally {
      try {
        await client.destroy();
      } catch (_) {
        /* ignore */
      }
      process.exit(process.exitCode || 0);
    }
  });

  await client.initialize();
}

main().catch(err => {
  log(`Fatal: ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
