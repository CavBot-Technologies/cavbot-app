import { redirect } from "next/navigation";

import { cavsafeDeniedRedirectPath, getCavsafeAccessContext } from "./access.server";
import CavSafeClientShell from "./CavSafeClientShell";

export default async function CavSafePageRoute() {
  const access = await getCavsafeAccessContext("/cavsafe");
  if (!access.canEnter) {
    redirect(cavsafeDeniedRedirectPath(access, "/cavsafe"));
  }
  return <CavSafeClientShell />;
}
