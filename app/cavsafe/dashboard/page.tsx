import { redirect } from "next/navigation";

import { cavsafeDeniedRedirectPath, getCavsafeAccessContext } from "../access.server";

export default async function CavSafeDashboardPage() {
  const access = await getCavsafeAccessContext("/cavsafe/dashboard");
  if (!access.canEnter) {
    redirect(cavsafeDeniedRedirectPath(access, "/cavsafe/dashboard"));
  }
  redirect("/cavsafe");
}
