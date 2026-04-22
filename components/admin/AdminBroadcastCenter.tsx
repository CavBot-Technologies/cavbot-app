"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { Badge, Panel } from "@/components/admin/AdminPrimitives";

type BroadcastCampaign = {
  id: string;
  title: string;
  body: string;
  status: string;
  audienceType: string;
  targetDepartments: string[];
  channels: string[];
  ctaLabel?: string | null;
  ctaHref?: string | null;
  dismissalPolicy?: string | null;
  scheduledFor?: string | null;
  sentAt?: string | null;
  canceledAt?: string | null;
  createdAt: string;
  deliveries?: Array<{
    id: string;
    channel: string;
    status: string;
    readAt?: string | null;
  }>;
};

function formatDateLabel(value?: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not scheduled";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function statusTone(status: string) {
  if (status === "SENT") return "good" as const;
  if (status === "SCHEDULED" || status === "SENDING") return "watch" as const;
  return "bad" as const;
}

export function AdminBroadcastCenter(props: {
  initialCampaigns: BroadcastCampaign[];
  canBroadcastUsers: boolean;
  canBroadcastStaff: boolean;
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState("");
  const [feedback, setFeedback] = useState<string>("");
  const [audienceType, setAudienceType] = useState<string>(
    props.canBroadcastUsers ? "ALL_USERS" : "ALL_STAFF",
  );

  const audienceOptions = useMemo(() => {
    const items: Array<{ value: string; label: string }> = [];
    if (props.canBroadcastUsers) {
      items.push({ value: "ALL_USERS", label: "All users" });
    }
    if (props.canBroadcastStaff) {
      items.push({ value: "ALL_STAFF", label: "All staff" });
      items.push({ value: "STAFF_DEPARTMENTS", label: "Staff departments" });
    }
    return items;
  }, [props.canBroadcastStaff, props.canBroadcastUsers]);

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setBusyKey("create");
    setFeedback("");
    try {
      const targetDepartments = formData.getAll("targetDepartments").map((value) => String(value));
      const response = await fetch("/api/admin/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: String(formData.get("title") || "").trim(),
          body: String(formData.get("body") || "").trim(),
          audienceType: String(formData.get("audienceType") || "").trim(),
          targetDepartments,
          channels:
            String(formData.get("audienceType") || "").trim() === "ALL_STAFF"
            || String(formData.get("audienceType") || "").trim() === "STAFF_DEPARTMENTS"
              ? ["NOTIFICATION", "CAVCHAT"]
              : ["NOTIFICATION"],
          ctaLabel: String(formData.get("ctaLabel") || "").trim() || null,
          ctaHref: String(formData.get("ctaHref") || "").trim() || null,
          dismissalPolicy: String(formData.get("dismissalPolicy") || "").trim() || null,
          scheduledFor: String(formData.get("scheduledFor") || "").trim() || null,
          status: formData.get("scheduledFor") ? "SCHEDULED" : "DRAFT",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error || "Broadcast creation failed."));
      }
      form.reset();
      setAudienceType(props.canBroadcastUsers ? "ALL_USERS" : "ALL_STAFF");
      setFeedback("Broadcast campaign saved.");
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Broadcast creation failed.");
    } finally {
      setBusyKey("");
    }
  }

  async function runAction(action: string, campaignId?: string) {
    setBusyKey(`${action}:${campaignId || ""}`);
    setFeedback("");
    try {
      const response = await fetch("/api/admin/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action,
          campaignId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error || "Broadcast action failed."));
      }
      setFeedback(action === "dispatch_due" ? "Queued scheduled campaigns processed." : "Broadcast action completed.");
      router.refresh();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Broadcast action failed.");
    } finally {
      setBusyKey("");
    }
  }

  return (
    <div className="hq-grid hq-gridTwo">
      <Panel title="Campaign Composer" subtitle="Create scheduled or on-demand user and staff campaigns with mandatory in-app delivery.">
        <form className="hq-opSectionStack" onSubmit={submitCreate}>
          {feedback ? <div className="hq-opFeedback" data-tone={feedback.toLowerCase().includes("failed") ? "bad" : "good"}>{feedback}</div> : null}
          <input className="hq-input" name="title" placeholder="Campaign title" />
          <textarea className="hq-textarea" name="body" rows={7} placeholder="Write the message body that lands in the notification inbox or CavChat broadcast box." />
          <div className="hq-opInlineFields">
            <select className="hq-select" name="audienceType" value={audienceType} onChange={(event) => setAudienceType(event.currentTarget.value)}>
              {audienceOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select className="hq-select" name="dismissalPolicy" defaultValue="manual">
              <option value="manual">Manual dismissal</option>
              <option value="until_read">Until read</option>
              <option value="window_only">Only in delivery window</option>
            </select>
          </div>

          {audienceType === "STAFF_DEPARTMENTS" ? (
            <div className="hq-opCheckGrid">
              {[
                ["COMMAND", "Command"],
                ["OPERATIONS", "Operations"],
                ["SECURITY", "Security"],
                ["HUMAN_RESOURCES", "Human Resources"],
              ].map(([value, label]) => (
                <label key={value} className="hq-opCheck">
                  <input type="checkbox" name="targetDepartments" value={value} />
                  {label}
                </label>
              ))}
            </div>
          ) : null}

          <div className="hq-opInlineFields">
            <input className="hq-input" name="ctaLabel" placeholder="CTA label" />
            <input className="hq-input" name="ctaHref" placeholder="/notifications or /status" />
          </div>

          <div className="hq-opInlineFields">
            <div className="hq-dateTimeField">
              <input className="hq-input hq-dateTimeInput" name="scheduledFor" type="datetime-local" />
              <span className="hq-dateTimeIcon" aria-hidden="true" />
            </div>
            <button className="hq-button" type="submit" disabled={busyKey === "create"}>
              {busyKey === "create" ? "Saving…" : "Save campaign"}
            </button>
          </div>
          <button
            className="hq-buttonGhost"
            type="button"
            onClick={() => {
              void runAction("dispatch_due");
            }}
            disabled={busyKey === "dispatch_due:"}
          >
            Process due scheduled campaigns
          </button>
        </form>
      </Panel>

      <Panel title="Campaign Ledger" subtitle="Drafts, scheduled sends, live broadcasts, and historical delivery state.">
        <div className="hq-opContextList">
          {props.initialCampaigns.length ? props.initialCampaigns.map((campaign) => {
            const deliveryCount = campaign.deliveries?.length || 0;
            const readCount = campaign.deliveries?.filter((delivery) => delivery.readAt).length || 0;
            return (
              <div key={campaign.id} className="hq-opCampaignCard">
                <div className="hq-opCampaignHead">
                  <div>
                    <div className="hq-listLabel">{campaign.title}</div>
                    <div className="hq-listMeta">
                      {campaign.audienceType} · {campaign.channels.join(" + ") || "NOTIFICATION"} · created {formatDateLabel(campaign.createdAt)}
                    </div>
                  </div>
                  <Badge tone={statusTone(campaign.status)}>{campaign.status}</Badge>
                </div>
                <p className="hq-helperText">{campaign.body}</p>
                <div className="hq-inline">
                  <span className="hq-helperText">Deliveries {deliveryCount}</span>
                  <span className="hq-helperText">Reads {readCount}</span>
                  {campaign.scheduledFor ? <span className="hq-helperText">Scheduled {formatDateLabel(campaign.scheduledFor)}</span> : null}
                  {campaign.sentAt ? <span className="hq-helperText">Sent {formatDateLabel(campaign.sentAt)}</span> : null}
                </div>
                <div className="hq-opCampaignActions">
                  <button
                    className="hq-buttonGhost"
                    type="button"
                    onClick={() => {
                      void runAction("dispatch", campaign.id);
                    }}
                    disabled={busyKey === `dispatch:${campaign.id}` || campaign.status === "SENT" || campaign.status === "CANCELED"}
                  >
                    Send now
                  </button>
                  <button
                    className="hq-buttonGhost"
                    data-tone="danger"
                    type="button"
                    onClick={() => {
                      void runAction("cancel", campaign.id);
                    }}
                    disabled={busyKey === `cancel:${campaign.id}` || campaign.status === "SENT" || campaign.status === "CANCELED"}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          }) : <p className="hq-helperText">No campaigns yet.</p>}
        </div>
      </Panel>
    </div>
  );
}
