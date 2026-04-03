import { serveFaviconAsset } from "../faviconAssetResponses";

export const runtime = "nodejs";

export function GET() {
  return serveFaviconAsset("favicon-96x96.png");
}
