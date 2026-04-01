import { runtime, serveFaviconAsset } from "../faviconAssetResponses";

export { runtime };

export function GET() {
  return serveFaviconAsset("favicon-64x64.png");
}
