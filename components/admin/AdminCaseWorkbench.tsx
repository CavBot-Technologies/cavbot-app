"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Badge, Panel } from "@/components/admin/AdminPrimitives";

type CaseNote = {
  id: string;
  body: string;
  createdAt: string;
};

type CaseItem = {
  id: string;
  caseCode: string;
  queue: string;
  status: string;
  priority: string;
  subject: string;
  description?: string | null;
  accountId?: string | null;
  userId?: string | null;
  assigneeStaffId?: string | null;
  slaDueAt?: string | null;
  customerNotifiedAt?: string | null;
  outcome?: string | null;
  updatedAt: string;
  notes: CaseNote[];
};

type StaffOption = {
  id: string;
  name: string;
  positionTitle: string;
};

function formatDateLabel(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function toneForPriority(priority: string) {
  if (priority === "CRITICAL") return "bad" as const;
  if (priority === "HIGH") return "watch" as const;
  return "good" as const;
}

function humanizeCaseToken(value?: string | null) {
  const normalized = String(value || "").trim();
  if (!normalized) return "Unknown";
  return normalized
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function humanizeCaseQueue(value?: string | null) {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "CUSTOMER_SUCCESS") return "Customer Success";
  if (normalized === "CUSTOMER_SUCCES") return "Customer Success";
  if (normalized === "BILLING_OPS") return "Billing Ops";
  if (normalized === "TRUST_SAFETY") return "Trust & Safety";
  return humanizeCaseToken(value);
}

export function AdminCaseWorkbench(props: {
  initialCases: CaseItem[];
  staffOptions: StaffOption[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(props.initialCases[0]?.id || null);
  const [busy, setBusy] = useState("");
  const [feedback, setFeedback] = useState("");
  const [query, setQuery] = useState("");
  const [queueFilter, setQueueFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const filteredCases = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return props.initialCases.filter((caseItem) => {
      const matchesQuery = !normalizedQuery || [
        caseItem.caseCode,
        caseItem.subject,
        caseItem.description || "",
        humanizeCaseQueue(caseItem.queue),
        humanizeCaseToken(caseItem.status),
        humanizeCaseToken(caseItem.priority),
      ].join(" ").toLowerCase().includes(normalizedQuery);
      const matchesQueue = !queueFilter || caseItem.queue === queueFilter;
      const matchesStatus = !statusFilter || caseItem.status === statusFilter;
      return matchesQuery && matchesQueue && matchesStatus;
    });
  }, [props.initialCases, query, queueFilter, statusFilter]);

  useEffect(() => {
    if (!filteredCases.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filteredCases.some((caseItem) => caseItem.id === selectedId)) {
      setSelectedId(filteredCases[0]?.id || null);
    }
  }, [filteredCases, selectedId]);

  const selectedCase = useMemo(
    () => filteredCases.find((caseItem) => caseItem.id === selectedId) || filteredCases[0] || null,
    [filteredCases, selectedId],
  );
  const queueOptions = useMemo(
    () => Array.from(new Set(props.initialCases.map((caseItem) => caseItem.queue))).sort(),
    [props.initialCases],
  );
  const statusOptions = useMemo(
    () => Array.from(new Set(props.initialCases.map((caseItem) => caseItem.status))).sort(),
    [props.initialCases],
  );

  async function syncCases() {
    setBusy("sync");
    setFeedback("");
    try {
      const response = await fetch("/api/admin/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ action: "sync" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(String(payload?.error || "Case sync failed."));
      setFeedback("Operational signals synced into cases.");
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Case sync failed.");
    } finally {
      setBusy("");
    }
  }

  async function updateCase(formData: FormData) {
    if (!selectedCase) return;
    setBusy(`update:${selectedCase.id}`);
    setFeedback("");
    try {
      const response = await fetch("/api/admin/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          caseId: selectedCase.id,
          status: String(formData.get("status") || "").trim(),
          priority: String(formData.get("priority") || "").trim(),
          assigneeStaffId: String(formData.get("assigneeStaffId") || "").trim() || null,
          slaDueAt: String(formData.get("slaDueAt") || "").trim() || null,
          outcome: String(formData.get("outcome") || "").trim() || null,
          note: String(formData.get("note") || "").trim() || null,
          customerNotified: formData.get("customerNotified") === "on",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) throw new Error(String(payload?.error || "Case update failed."));
      setFeedback(`${selectedCase.caseCode} updated.`);
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Case update failed.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="hq-caseWorkbench">
      <article className="hq-card">
        <div className="hq-cardBody">
        {selectedCase ? (
          <form
            className="hq-caseWorkbenchDetail"
            onSubmit={(event) => {
              event.preventDefault();
              void updateCase(new FormData(event.currentTarget));
            }}
          >
            <div className="hq-opSection">
              <div className="hq-opContextTitle">Case controls</div>
              <div className="hq-opInlineFields">
                <label className="hq-caseWorkbenchField">
                  <span className="hq-caseWorkbenchFieldLabel">Status</span>
                  <select className="hq-select" name="status" defaultValue={selectedCase.status}>
                    <option value="OPEN">Open</option>
                    <option value="IN_PROGRESS">In progress</option>
                    <option value="PENDING_EXTERNAL">Pending external</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="CLOSED">Closed</option>
                  </select>
                </label>
                <label className="hq-caseWorkbenchField">
                  <span className="hq-caseWorkbenchFieldLabel">Priority</span>
                  <select className="hq-select" name="priority" defaultValue={selectedCase.priority}>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </label>
              </div>

              <div className="hq-opInlineFields">
                <label className="hq-caseWorkbenchField">
                  <span className="hq-caseWorkbenchFieldLabel">Assignee</span>
                  <select className="hq-select" name="assigneeStaffId" defaultValue={selectedCase.assigneeStaffId || ""}>
                    <option value="">Unassigned</option>
                    {props.staffOptions.map((staff) => (
                      <option key={staff.id} value={staff.id}>{staff.name} · {staff.positionTitle}</option>
                    ))}
                  </select>
                </label>
                <label className="hq-caseWorkbenchField">
                  <span className="hq-caseWorkbenchFieldLabel">SLA</span>
                  <div className="hq-dateTimeField">
                    <input className="hq-input hq-dateTimeInput" name="slaDueAt" type="datetime-local" />
                    <span className="hq-dateTimeIcon" aria-hidden="true" />
                  </div>
                </label>
              </div>

              <label className="hq-caseWorkbenchField">
                <span className="hq-caseWorkbenchFieldLabel">Outcome</span>
                <textarea className="hq-textarea" name="outcome" rows={3} defaultValue={selectedCase.outcome || ""} placeholder="Resolution summary or internal outcome" />
              </label>
              <label className="hq-caseWorkbenchField">
                <span className="hq-caseWorkbenchFieldLabel">Note</span>
                <textarea className="hq-textarea" name="note" rows={3} placeholder="Add a case note" />
              </label>
              <label className="hq-opCheck">
                <input type="checkbox" name="customerNotified" defaultChecked={Boolean(selectedCase.customerNotifiedAt)} />
                Customer notified
              </label>
              <div className="hq-inline">
                <button className="hq-button" type="submit" disabled={busy === `update:${selectedCase.id}`}>Save case</button>
              </div>
            </div>

            <div className="hq-caseWorkbenchMetaGrid">
              <div className="hq-caseWorkbenchMetaCard">
                <div className="hq-caseWorkbenchMetaLabel">Case</div>
                <div className="hq-caseWorkbenchMetaValue">{selectedCase.caseCode}</div>
                <div className="hq-caseWorkbenchMetaSub">Updated {formatDateLabel(selectedCase.updatedAt)}</div>
              </div>
              <div className="hq-caseWorkbenchMetaCard">
                <div className="hq-caseWorkbenchMetaLabel">Assignee</div>
                <div className="hq-caseWorkbenchMetaValue">
                  {props.staffOptions.find((staff) => staff.id === selectedCase.assigneeStaffId)?.name || "Unassigned"}
                </div>
                <div className="hq-caseWorkbenchMetaSub">{selectedCase.slaDueAt ? `SLA ${formatDateLabel(selectedCase.slaDueAt)}` : "SLA not set"}</div>
              </div>
              <div className="hq-caseWorkbenchMetaCard">
                <div className="hq-caseWorkbenchMetaLabel">Linked entities</div>
                <div className="hq-caseWorkbenchEntityLinks">
                  {selectedCase.accountId ? <Link href={`/accounts/${selectedCase.accountId}`} className="hq-buttonGhost">Account dossier</Link> : null}
                  {selectedCase.userId ? <Link href={`/clients/${selectedCase.userId}`} className="hq-buttonGhost">Client dossier</Link> : null}
                  {!selectedCase.accountId && !selectedCase.userId ? <span className="hq-caseWorkbenchMetaSub">No linked account or client</span> : null}
                </div>
              </div>
            </div>

            <RecentCaseNotes notes={selectedCase.notes} />
          </form>
        ) : <p className="hq-helperText">Select a case to open the workbench.</p>}
        </div>
      </article>

      <Panel
        title="Queues"
        subtitle="Payment risk, access, trust, broadcast, and customer success cases with operator ownership."
        actions={(
          <button
            className="hq-buttonGhost hq-syncButton"
            type="button"
            onClick={() => { void syncCases(); }}
            disabled={busy === "sync"}
            title={busy === "sync" ? "Syncing signals" : "Sync signals"}
            aria-label={busy === "sync" ? "Syncing signals" : "Sync signals"}
          >
            <span className="hq-syncIcon" aria-hidden="true" />
          </button>
        )}
      >
        {feedback ? <div className="hq-opFeedback" data-tone={feedback.toLowerCase().includes("failed") ? "bad" : "good"}>{feedback}</div> : null}
        <div className="hq-caseWorkbenchQueueHead">
          <div className="hq-caseWorkbenchFilters">
            <label className="hq-caseWorkbenchSearch">
              <input
                className="hq-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="Search case code, subject, queue, or priority"
                aria-label="Search cases"
              />
            </label>
            <select className="hq-select" value={queueFilter} onChange={(event) => setQueueFilter(event.currentTarget.value)} aria-label="Filter by queue">
              <option value="">All queues</option>
              {queueOptions.map((queue) => (
                <option key={queue} value={queue}>{humanizeCaseQueue(queue)}</option>
              ))}
            </select>
            <select className="hq-select" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)} aria-label="Filter by status">
              <option value="">All statuses</option>
              {statusOptions.map((status) => (
                <option key={status} value={status}>{humanizeCaseToken(status)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="hq-opContextList hq-caseWorkbenchQueueList">
          {filteredCases.length ? filteredCases.map((caseItem) => (
            <button
              key={caseItem.id}
              type="button"
              className="hq-opCaseRow hq-caseQueueRow"
              data-active={selectedCase?.id === caseItem.id}
              onClick={() => setSelectedId(caseItem.id)}
            >
              <div className="hq-caseQueueCopy">
                <div className="hq-listLabel">{caseItem.caseCode}</div>
                <div className="hq-caseQueueSubject">{caseItem.subject}</div>
                <div className="hq-listMeta">
                  {humanizeCaseQueue(caseItem.queue)} · {humanizeCaseToken(caseItem.status)} · updated {formatDateLabel(caseItem.updatedAt)}
                </div>
              </div>
              <div className="hq-caseQueuePills">
                <Badge className="hq-caseBadge" tone={toneForPriority(caseItem.priority)}>{humanizeCaseToken(caseItem.priority)}</Badge>
              </div>
            </button>
          )) : <p className="hq-helperText">No cases match this filter set.</p>}
        </div>
      </Panel>
    </div>
  );
}

function RecentCaseNotes(props: { notes: CaseNote[] }) {
  return (
    <div className="hq-opContextBlock">
      <div className="hq-opContextTitle">Recent notes</div>
      <div className="hq-opContextList">
        {props.notes.length ? props.notes.map((note) => (
          <div key={note.id} className="hq-opContextItem">
            <div>
              <div className="hq-listLabel">{formatDateLabel(note.createdAt)}</div>
              <div className="hq-listMeta">{note.body}</div>
            </div>
          </div>
        )) : <p className="hq-helperText">No notes recorded yet.</p>}
      </div>
    </div>
  );
}
