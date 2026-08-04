/**
 * Phone-number normalization for WhatsApp sending.
 *
 * WhatsApp addresses personal chats as `<international-number>@c.us` with no
 * leading `+` and no separators. Customer lists are uploaded by humans in many
 * shapes (`+91 98470 12345`, `098470-12345`, `9847012345`, `0091...`), so we
 * normalize to bare international digits and derive the JID.
 */

export interface NormalizedPhone {
  /** Original value as supplied. */
  raw: string;
  /** Bare international digits (no `+`, no separators), or '' if invalid. */
  digits: string;
  /** WhatsApp chat id `<digits>@c.us`, or '' if invalid. */
  jid: string;
  valid: boolean;
}

/**
 * Normalize a raw phone string.
 *
 * @param raw            The phone number as uploaded.
 * @param defaultCountryCode  Digits only (e.g. `'91'`). Used to promote local
 *   numbers (leading `0` or short national numbers) to international form.
 */
export function normalizePhone(raw: string, defaultCountryCode?: string | null): NormalizedPhone {
  const original = (raw ?? '').toString().trim();
  const cc = (defaultCountryCode ?? '').replace(/\D/g, '');

  // Preserve whether the user explicitly gave international form.
  const hadPlus = original.trimStart().startsWith('+');
  let digits = original.replace(/\D/g, '');

  if (!digits) {
    return { raw: original, digits: '', jid: '', valid: false };
  }

  if (digits.startsWith('00')) {
    // International prefix (e.g. 0091...) -> strip it, already has country code.
    digits = digits.slice(2);
  } else if (hadPlus) {
    // Already E.164; keep as-is.
  } else if (digits.startsWith('0')) {
    // National trunk prefix -> replace leading 0 with the country code.
    digits = cc ? cc + digits.slice(1) : digits.slice(1);
  } else if (cc && digits.length <= 10) {
    // Bare national number (<=10 digits, e.g. an Indian mobile) -> prepend the
    // country code. We key off length rather than a startsWith(cc) check so a
    // genuine national number that happens to begin with the country-code
    // digits (e.g. a mobile starting "91") is still promoted correctly.
    digits = cc + digits;
  }

  // E.164 allows up to 15 digits. Require at least 10 total (country code +
  // national number) so truncated/fragment inputs aren't imported as real
  // recipients — most markets this targets (e.g. +91 => 12 digits) exceed this.
  const valid = digits.length >= 10 && digits.length <= 15;

  return {
    raw: original,
    digits: valid ? digits : '',
    jid: valid ? `${digits}@c.us` : '',
    valid,
  };
}
