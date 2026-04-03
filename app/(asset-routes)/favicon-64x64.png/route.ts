import { serveFaviconAsset } from "../faviconAssetResponses";

export const runtime = "nodejs";

export function GET() {
  return serveFaviconAsset("favicon-64x64.png");
}
