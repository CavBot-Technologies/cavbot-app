import { serveFaviconAsset } from "../faviconAssetResponses";

export const runtime = "nodejs";

export function GET() {
  return serveFaviconAsset("android-chrome-192x192.png");
}
