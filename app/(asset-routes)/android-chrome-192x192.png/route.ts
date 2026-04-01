import { runtime, serveFaviconAsset } from "../faviconAssetResponses";

export { runtime };

export function GET() {
  return serveFaviconAsset("android-chrome-192x192.png");
}
