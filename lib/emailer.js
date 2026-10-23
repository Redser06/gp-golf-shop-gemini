/**
 * Native macOS Mail transport for delivering Global Payments payment links.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function buildEmailBody({ shopName, items, amountDisplay, linkUrl, linkId, orderRef }) {
  return `Hi Conor,

Thank you for your order with ${shopName}.

Your custom single-use payment link is ready:

  Items:    ${items}
  Total:    ${amountDisplay}
  Link ID:  ${linkId}
  Order:    ${orderRef}

Complete your checkout securely via Global Payments:
${linkUrl}

This link is single-use and will automatically transition to CAPTURED once paid.

Warm regards,
The Concierge Team
${shopName}`;
}

export async function sendViaMacMail({ to, subject, body, from = 'conor.a.redmond@gmail.com' }) {
  const script = `
tell application "Mail"
  set newMsg to make new outgoing message with properties {subject:${JSON.stringify(subject)}, content:${JSON.stringify(body & "\n\n")}, visible:false}
  tell newMsg
    make new to recipient at end of to recipients with properties {address:${JSON.stringify(to)}}
    try
      set sender to ${JSON.stringify(from)}
    end try
    send
  end tell
end tell
`;

  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 15000 });
    return { ok: true, transport: `macOS Mail (${from})`, detail: 'dispatched' };
  } catch (err) {
    return { ok: false, transport: 'macOS Mail', error: err.message };
  }
}
