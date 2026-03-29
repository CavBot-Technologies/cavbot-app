import Link from "next/link";
import { notFound } from "next/navigation";

export default function DriveDebugPage() {
  const enabled =
    process.env.NODE_ENV !== "production" ||
    String(process.env.CAVBOT_ENABLE_DRIVE_DEBUG_ROUTE || "").trim() === "1";
  if (!enabled) notFound();

  return (
    <main style={{ maxWidth: 840, margin: "0 auto", padding: "32px 20px", color: "var(--text, #e6f0ff)" }}>
      <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Drive Debug</h1>
      <p style={{ marginTop: 12, lineHeight: 1.5 }}>
        Use these links to open CavCloud/CavSafe with realtime drive diagnostics enabled.
      </p>
      <ul style={{ marginTop: 16, paddingLeft: 18, lineHeight: 1.8 }}>
        <li>
          <Link href="/cavcloud?driveDebug=1">Open CavCloud (driveDebug=1)</Link>
        </li>
        <li>
          <Link href="/cavsafe?driveDebug=1">Open CavSafe (driveDebug=1)</Link>
        </li>
      </ul>
      <p style={{ marginTop: 16, lineHeight: 1.5 }}>
        Debug panel fields: <code>currentFolderId</code>, <code>listingQueryKey</code>, <code>lastFetchAt</code>,
        <code> isFetching</code>, <code>lastMutation</code>, <code>optimisticCount/serverCount</code>.
      </p>
      <p style={{ marginTop: 8, lineHeight: 1.5 }}>
        You can also force debug globally with <code>NEXT_PUBLIC_DRIVE_DEBUG=1</code>.
      </p>
    </main>
  );
}
