import { POST as cavcloudPublish } from "../artifacts/publish/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  return cavcloudPublish(req);
}
