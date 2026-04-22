import { AdminCavChatWorkspace } from "@/components/admin/AdminCavChatWorkspace";
import { getAdminChatWorkspaceSeed } from "@/lib/admin/chatWorkspace.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MessageOversightPage(props: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const seed = await getAdminChatWorkspaceSeed({
    path: "/message-oversight",
    scopes: ["messaging.oversight"],
    searchParams: props.searchParams,
    allowMailboxSelection: true,
  });

  return (
    <section className="hq-page">
      <AdminCavChatWorkspace
        mode="oversight"
        currentUserId={seed.currentUserId}
        initialThreads={seed.initialThreads}
        initialThread={seed.initialThread}
        initialMailboxUserId={seed.initialMailboxUserId}
        staffOptions={seed.staffOptions}
      />
    </section>
  );
}
