import { runtime, serveFaviconAsset } from "../faviconAssetResponses";

export { runtime };

export function GET() {
  return serveFaviconAsset("apple-touch-icon-152x152.png");
}
