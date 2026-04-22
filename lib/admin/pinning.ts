const PRIMARY_CAVBOT_ADMIN_EMAIL = "cavbotadm@gmail.com";
const PRIMARY_CAVBOT_ADMIN_USERNAME = "cavbot";
const PRIMARY_CAVBOT_ADMIN_NAME = "cavbot admin";

function normalize(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

export function isPrimaryCavBotAdminIdentity(input: {
  email?: string | null;
  username?: string | null;
  name?: string | null;
}) {
  return (
    normalize(input.email) === PRIMARY_CAVBOT_ADMIN_EMAIL
    || normalize(input.username).replace(/^@/, "") === PRIMARY_CAVBOT_ADMIN_USERNAME
    || normalize(input.name) === PRIMARY_CAVBOT_ADMIN_NAME
  );
}

export function pinPrimaryItemFirst<T>(items: readonly T[], isPrimary: (item: T) => boolean) {
  return items
    .map((item, index) => ({
      item,
      index,
      priority: isPrimary(item) ? 0 : 1,
    }))
    .sort((left, right) => left.priority - right.priority || left.index - right.index)
    .map(({ item }) => item);
}
