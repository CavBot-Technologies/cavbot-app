import "server-only";
import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const MAIL_FROM = process.env.CAVBOT_MAIL_FROM || "CavBot Security <no-reply@cavbot.io>";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

export async function sendInviteEmail(opts: {
  to: string;
  role: "ADMIN" | "MEMBER";
  inviteToken: string;
  origin: string;
}) {
  if (!resend) {
    throw new Error("RESEND_NOT_CONFIGURED");
  }

  const acceptUrl = `${opts.origin}/accept-invite?token=${encodeURIComponent(opts.inviteToken)}`;

  const subject = "You're invited to CavBot";

  const html = `
  <div style="font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, Helvetica, Arial; line-height:1.4; color:#0b1220;">
    <h2 style="margin:0 0 10px 0;">CavBot invitation</h2>
    <p style="margin:0 0 14px 0;">
      You’ve been invited to join a CavBot workspace as <b>${opts.role}</b>.
    </p>

    <a href="${acceptUrl}"
      style="display:inline-block; padding:12px 16px; border-radius:12px; background:#1f6feb; color:white; text-decoration:none; font-weight:600;">
      Accept invite
    </a>

    <p style="margin:14px 0 0 0; font-size:13px; color:#4b5563;">
      This link can only be used once and may expire.
    </p>

    <p style="margin:10px 0 0 0; font-size:12px; color:#6b7280;">
      If you didn’t expect this invite, you can ignore this email.
    </p>
  </div>
  `;

  await resend.emails.send({
    from: MAIL_FROM,
    to: [opts.to],
    subject,
    html,
  });
}

