// lib/email/sendEmail.ts
type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
};

export async function sendEmail({ to, subject, html }: SendEmailArgs) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
  const MAIL_FROM = process.env.MAIL_FROM || "support@cavbot.io";

  // DEV fallback: log it so you can test instantly
  if (!RESEND_API_KEY) {
    console.log("[email:dev-preview]", JSON.stringify({
      to,
      from: MAIL_FROM,
      subject,
      html,
    }));
    return { ok: true, dev: true };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    console.error("Resend send failed:", t);
    throw new Error("EMAIL_SEND_FAILED");
  }

  return { ok: true };
}
