import { redirect } from "next/navigation";

import { cavsafeDeniedRedirectPath, getCavsafeAccessContext } from "../access.server";

export default async function CavSafeSettingsPage() {
  const access = await getCavsafeAccessContext("/cavsafe/settings");
  if (!access.canEnter) {
    redirect(cavsafeDeniedRedirectPath(access, "/cavsafe/settings"));
  }
  redirect("/cavsafe");
}
