import dynamic from "next/dynamic";
import { redirect } from "next/navigation";

import { cavsafeDeniedRedirectPath, getCavsafeAccessContext } from "../../access.server";

const CavSafeViewerClient = dynamic(() => import("./CavSafeViewerClient"), {
  ssr: false,
});

export default async function CavSafeFileViewerPage() {
  const access = await getCavsafeAccessContext("/cavsafe/view");
  if (!access.canEnter) {
    redirect(cavsafeDeniedRedirectPath(access, "/cavsafe/view"));
  }
  return <CavSafeViewerClient />;
}
