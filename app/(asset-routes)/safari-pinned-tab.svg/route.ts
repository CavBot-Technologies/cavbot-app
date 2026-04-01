import { runtime, serveFaviconAsset } from "../faviconAssetResponses";

export { runtime };

export function GET() {
  return serveFaviconAsset("safari-pinned-tab.svg");
}
