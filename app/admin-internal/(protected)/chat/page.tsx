import { AdminCavChatWorkspace } from "@/components/admin/AdminCavChatWorkspace";
import { getAdminChatWorkspaceSeed } from "@/lib/admin/chatWorkspace.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ChatPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const seed = await getAdminChatWorkspaceSeed({
    path: "/chat",
    scopes: ["messaging.read"],
    searchParams: props.searchParams,
  });

  return (
    <section className="hq-page">
      <AdminCavChatWorkspace
        mode="chat"
        currentUserId={seed.currentUserId}
        initialThreads={seed.initialThreads}
        initialThread={seed.initialThread}
        initialMailboxUserId={seed.initialMailboxUserId}
        staffOptions={seed.staffOptions}
      />
    </section>
  );
}
