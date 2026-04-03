import { serveFaviconAsset } from "../faviconAssetResponses";

export const runtime = "nodejs";

export function GET() {
  return serveFaviconAsset("favicon-32x32.png");
}
