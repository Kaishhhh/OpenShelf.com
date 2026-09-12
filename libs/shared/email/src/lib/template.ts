/** Which flow the code belongs to. Only the wording differs. */
export type OtpPurpose = 'user' | 'seller';

interface Copy {
  subject: string;
  heading: string;
  intro: string;
}

const COPY: Record<OtpPurpose, Copy> = {
  user: {
    subject: 'Your OpenShelf verification code',
    heading: 'Confirm your email',
    intro: 'Use this code to finish creating your OpenShelf account.',
  },
  seller: {
    subject: 'Your OpenShelf seller verification code',
    heading: 'Confirm your seller email',
    intro:
      'Use this code to finish creating your OpenShelf seller account. ' +
      'You can set up your shop once your email is confirmed.',
  },
};

export function subjectFor(purpose: OtpPurpose): string {
  return COPY[purpose].subject;
}

/**
 * Escapes the few characters that could break out of the surrounding markup.
 *
 * The code is generated server-side and is always six digits, so this is belt and
 * braces — but the template is a raw string, and nothing else stands between an
 * interpolated value and the recipient's client.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * A plain HTML email.
 *
 * Every rule is inline: Gmail and Outlook strip <style> blocks and external
 * stylesheets, so a class-based layout would arrive unstyled. The card is a table
 * rather than a flex container for the same reason — Outlook's Word rendering engine
 * does not lay out divs reliably.
 */
export function otpEmailHtml({
  code,
  purpose,
}: {
  code: string;
  purpose: OtpPurpose;
}): string {
  const { heading, intro } = COPY[purpose];
  const safeCode = escapeHtml(code);

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:#f5f6f8;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f6f8;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;background-color:#ffffff;border:1px solid #e2e5ea;border-radius:4px;">
            <tr>
              <td style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
                <p style="margin:0 0 4px 0;font-size:13px;font-weight:600;color:#0b62c4;letter-spacing:0.04em;text-transform:uppercase;">OpenShelf</p>
                <h1 style="margin:0 0 12px 0;font-size:20px;line-height:28px;font-weight:600;color:#1f2430;">${heading}</h1>
                <p style="margin:0 0 24px 0;font-size:14px;line-height:22px;color:#5b6373;">${intro}</p>
                <div style="margin:0 0 24px 0;padding:16px;background-color:#f5f6f8;border:1px solid #e2e5ea;border-radius:4px;text-align:center;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:30px;line-height:36px;font-weight:600;letter-spacing:0.28em;color:#1f2430;">${safeCode}</div>
                <p style="margin:0 0 8px 0;font-size:13px;line-height:20px;color:#5b6373;">This code expires in 5 minutes.</p>
                <p style="margin:0;font-size:13px;line-height:20px;color:#8b93a3;">If you didn't request it, you can ignore this email — nothing has been created yet.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** The plain-text alternative, for clients that refuse HTML. */
export function otpEmailText({
  code,
  purpose,
}: {
  code: string;
  purpose: OtpPurpose;
}): string {
  const { heading, intro } = COPY[purpose];
  return `${heading}

${intro}

${code}

This code expires in 5 minutes.
If you didn't request it, you can ignore this email — nothing has been created yet.`;
}
