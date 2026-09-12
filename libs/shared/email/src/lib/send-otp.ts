import { emailFrom, resend } from './client.js';
import {
  otpEmailHtml,
  otpEmailText,
  subjectFor,
  type OtpPurpose,
} from './template.js';

export interface SendOtpEmailInput {
  to: string;
  code: string;
  purpose: OtpPurpose;
}

/**
 * Logs a failure, and in development also the code itself.
 *
 * Callers deliberately cannot recover from a failed send — the OTP is already in Redis
 * and the caller has already decided to answer 200 — so this log is the only trace. It
 * is a console.error rather than a warn for exactly that reason.
 *
 * The code is included only outside production, and only when the send failed: that is
 * precisely when a local developer has no other way to obtain it (a missing key, or the
 * 403 that onboarding@resend.dev returns for any recipient other than the account
 * owner). A successful send never logs it, and production never logs it at all.
 */
function reportFailure(
  { to, code, purpose }: SendOtpEmailInput,
  reason: unknown
): void {
  console.error(
    `[email] Could not send the ${purpose} OTP email to ${to} —`,
    reason
  );

  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[email] Development fallback: the code for ${to} is ${code}`);
  }
}

/**
 * Sends a one-time code, and **never throws**.
 *
 * Registration must not fail or stall because mail is down: the code is already stored,
 * so a failed send costs the user a resend, while a thrown error would cost them the
 * account. Callers therefore fire this without awaiting it.
 *
 * There are three separate failure shapes to absorb, which is why the whole body is
 * guarded rather than just the send:
 *   - RESEND_API_KEY or EMAIL_FROM unset — requireEnv throws synchronously;
 *   - network or DNS failure — the SDK's fetch rejects;
 *   - a rejected request (bad key, 403 to an unverified recipient, malformed payload) —
 *     the SDK resolves with { error } instead of throwing.
 *
 * @returns whether the provider accepted the message.
 */
export async function sendOtpEmail(input: SendOtpEmailInput): Promise<boolean> {
  const { to, code, purpose } = input;

  try {
    const { error } = await resend().emails.send({
      from: emailFrom(),
      to,
      subject: subjectFor(purpose),
      html: otpEmailHtml({ code, purpose }),
      text: otpEmailText({ code, purpose }),
    });

    if (error) {
      reportFailure(input, error);
      return false;
    }

    return true;
  } catch (err) {
    reportFailure(input, err);
    return false;
  }
}
