import { runtime, serveFaviconAsset } from "../faviconAssetResponses";

export { runtime };

export function GET() {
  return serveFaviconAsset("favicon-32x32.png");
}
