// lib/email/inviteEmail.ts
import "server-only";

export function renderInviteEmail(opts: {
  appName?: string;
  roleLabel: string;
  acceptUrl: string;
  expiresIn: string; // "7 days"
}) {
  const appName = opts.appName || "CavBot";

  return `
  <!doctype html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>You’re invited to ${appName}</title>
  </head>
  <body style="margin:0;background:#0b1020;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:#e9ecff;">
    <div style="max-width:640px;margin:0 auto;padding:28px 18px;">
      <div style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.10);border-radius:18px;padding:22px 18px;">
        <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:rgba(233,236,255,0.70);margin-bottom:12px;">
          ${appName} Access
        </div>

        <div style="font-size:26px;line-height:1.25;font-weight:800;margin:0 0 10px 0;">
          You’ve been invited.
        </div>

        <div style="font-size:15px;line-height:1.6;color:rgba(233,236,255,0.82);margin-bottom:18px;">
          You’ve been granted access to a ${appName} workspace with the role:
          <span style="font-weight:700;color:#b9c85a;">${opts.roleLabel}</span>.
        </div>

        <div style="margin:18px 0 22px 0;">
          <a href="${opts.acceptUrl}"
             style="display:inline-block;padding:12px 16px;border-radius:12px;
                    background:#b9c85a;color:#0b1020;text-decoration:none;font-weight:800;">
            Accept invite
          </a>
        </div>

        <div style="font-size:13px;line-height:1.6;color:rgba(233,236,255,0.68);">
          This invite expires in <strong>${opts.expiresIn}</strong>.
          For security, this link can only be used once.
        </div>

        <div style="height:1px;background:rgba(255,255,255,0.10);margin:18px 0;"></div>

        <div style="font-size:12px;line-height:1.6;color:rgba(233,236,255,0.55);">
          If you didn’t expect this invitation, you can safely ignore this email.
        </div>
      </div>

      <div style="text-align:center;font-size:12px;color:rgba(233,236,255,0.45);margin-top:14px;">
        © ${new Date().getFullYear()} ${appName}. All rights reserved.
      </div>
    </div>
  </body>
  </html>
  `;
}