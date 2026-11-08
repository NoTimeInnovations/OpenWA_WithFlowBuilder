/**
 * Strip the media model's private id from the message whatsapp-web.js builds.
 *
 * `window.WWebJS.sendMessage` builds the outgoing message with `id: newMsgKey`
 * and then spreads the media model from `processMediaData` into it. WhatsApp Web
 * builds since 2026-09-17 give that model an enumerable `__x_id`, which clobbers
 * the id: every image / video / audio / document send fails with "Data passed to
 * getter must include an id property (it's how we memoize) but got undefined"
 * while text keeps working. Same one-line fix as upstream whatsapp-web.js
 * PR #201923 (unmerged, nothing released after 1.34.7) and rmyndharis/OpenWA #1670.
 *
 * Exact and self-disabling: an unknown Utils.js shape fails the image build
 * instead of shipping without the fix; once the library carries the line itself
 * this stands down.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const UTILS = path.join(__dirname, '..', 'node_modules', 'whatsapp-web.js', 'src', 'util', 'Injected', 'Utils.js');
// The comment right after the outgoing message object in sendMessage — unique in the file.
const ANCHOR = "        // Bot's won't reply if canonicalUrl is set (linking)\n";
const FIX = '        delete message.__x_id;\n\n';

const count = (s, needle) => s.split(needle).length - 1;

const source = fs.readFileSync(UTILS, 'utf8');
const anchors = count(source, ANCHOR);
const fixes = count(source, FIX + ANCHOR);

if (anchors === 1 && fixes === 1) {
  console.log('patch-wwebjs-media-id: already applied');
} else if (anchors !== 1 || fixes !== 0) {
  console.error(`patch-wwebjs-media-id: unsupported Utils.js shape (anchors: ${anchors}, fixes: ${fixes})`);
  process.exit(1);
} else {
  fs.writeFileSync(UTILS, source.replace(ANCHOR, FIX + ANCHOR));
  console.log('patch-wwebjs-media-id: media model id stripped from outgoing messages');
}
