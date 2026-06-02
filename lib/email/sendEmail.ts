type SendEmailArgs = {
  to: string;
  subject: string;
  html: string;
};

export const DEFAULT_SECURITY_MAIL_FROM = "CavBot Security <no-reply@cavbot.io>";

function cleanMailFrom(raw: string | undefined) {
  const value = String(raw || "").trim();
  if (!value) return "";

  const lowered = value.toLowerCase();
  if (
    lowered.startsWith("paste_") ||
    lowered.includes("paste_your") ||
    /^https?:\/\//i.test(value) ||
    !value.includes("@")
  ) {
    return "";
  }

  return value;
}

export function resolveMailFrom(source: Record<string, string | undefined> = process.env) {
  return (
    cleanMailFrom(source.CAVBOT_MAIL_FROM) ||
    cleanMailFrom(source.MAIL_FROM) ||
    DEFAULT_SECURITY_MAIL_FROM
  );
}

export async function sendEmail({ to, subject, html }: SendEmailArgs) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
  const MAIL_FROM = resolveMailFrom();

  if (!RESEND_API_KEY) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("EMAIL_NOT_CONFIGURED");
    }

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
