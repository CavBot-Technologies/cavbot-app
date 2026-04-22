"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type FormEvent, type FormHTMLAttributes, type ReactNode } from "react";

import { Badge, Panel } from "@/components/admin/AdminPrimitives";
import { ALIBABA_QWEN_PLUS_MODEL_ID } from "@/src/lib/ai/model-catalog";

type ActionFeedback = {
  tone: "good" | "watch" | "bad";
  message: string;
};

const ACTION_CENTER_AI_TONES = ["Professional", "Direct", "Executive", "Supportive", "Firm"] as const;

type AccountActionCenterProps = {
  accountId: string;
  accountName: string;
  discipline: {
    status: "ACTIVE" | "SUSPENDED" | "REVOKED";
    violationCount: number;
    suspendedUntilISO?: string | null;
    note?: string | null;
  } | null;
  notes: Array<{
    id: string;
    body: string;
    customerVisibleNote: boolean;
    createdAt: string;
  }>;
  cases: Array<{
    id: string;
    caseCode: string;
    subject: string;
    status: string;
    priority: string;
  }>;
  billingAdjustments: Array<{
    id: string;
    kind: string;
    amountCents?: number | null;
    reason: string;
    createdAt: string;
  }>;
  members: Array<{
    id: string;
    role: string;
    user: {
      id: string;
      email: string;
      displayName?: string | null;
      fullName?: string | null;
      username?: string | null;
    };
  }>;
  previewMode?: boolean;
  previewLabel?: string | null;
};

type UserActionCenterProps = {
  userId: string;
  displayName: string;
  discipline: {
    status: "ACTIVE" | "SUSPENDED" | "REVOKED";
    violationCount: number;
    suspendedUntilISO?: string | null;
    lastSessionKillAtISO?: string | null;
    note?: string | null;
  } | null;
  notes: Array<{
    id: string;
    body: string;
    customerVisibleNote: boolean;
    createdAt: string;
  }>;
  cases: Array<{
    id: string;
    caseCode: string;
    subject: string;
    status: string;
    priority: string;
  }>;
  memberships: Array<{
    id: string;
    role: string;
    account: {
      id: string;
      name: string;
      tier: string;
    };
  }>;
};

function formatDateLabel(value?: string | null) {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not set";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatMoneyCents(amount?: number | null) {
  if (!Number.isFinite(Number(amount))) return "Custom";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(amount) / 100);
}

function formDataInput(formData: FormData, excluded: string[]) {
  const blocked = new Set(excluded);
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (blocked.has(key)) continue;
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    out[key] = trimmed;
  }
  return out;
}

function humanizeToken(value: string) {
  return String(value || "")
    .trim()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function formatActionResultLabel(action: string) {
  return humanizeToken(action).replace(/\bId\b/g, "ID");
}

function FeedbackBanner(props: { feedback: ActionFeedback | null }) {
  if (!props.feedback) return null;
  return (
    <div className="hq-opFeedback" data-tone={props.feedback.tone}>
      {props.feedback.message}
    </div>
  );
}

function SummaryCard(props: { label: string; value: string; meta?: string }) {
  return (
    <div className="hq-opSummaryCard">
      <div className="hq-opSummaryLabel">{props.label}</div>
      <div className="hq-opSummaryValue">{props.value}</div>
      {props.meta ? <div className="hq-opSummaryMeta">{props.meta}</div> : null}
    </div>
  );
}

function RecentContext(props: {
  title: string;
  items: Array<{ id: string; heading: string; meta: string; tone?: "good" | "watch" | "bad"; href?: string | null }>;
}) {
  return (
    <div className="hq-opContextBlock">
      <div className="hq-opContextTitle">{props.title}</div>
      <div className="hq-opContextList">
        {props.items.length ? props.items.map((item) => (
          <div key={item.id} className="hq-opContextItem">
            <div>
              <div className="hq-listLabel">{item.href ? <Link href={item.href}>{item.heading}</Link> : item.heading}</div>
              <div className="hq-listMeta">{item.meta}</div>
            </div>
            {item.tone ? <Badge tone={item.tone}>{item.tone.toUpperCase()}</Badge> : null}
          </div>
        )) : <p className="hq-helperText">No recent entries yet.</p>}
      </div>
    </div>
  );
}

function OperationCard(props: {
  title: string;
  subtitle: string;
  actionButton: ReactNode;
  children: ReactNode;
  className?: string;
} & FormHTMLAttributes<HTMLFormElement>) {
  const { title, subtitle, actionButton, children, className, ...rest } = props;
  return (
    <form className={className ? `hq-opActionCard ${className}` : "hq-opActionCard"} {...rest}>
      <div className="hq-opActionHead">
        <div>
          <div className="hq-opActionTitle">{title}</div>
          <div className="hq-opActionSub">{subtitle}</div>
        </div>
      </div>
      <div className="hq-opActionBody">{children}</div>
      <div className="hq-opActionFooter">{actionButton}</div>
    </form>
  );
}

function OperationActionButton(props: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  const { children, className, tone = "default", ...rest } = props;
  return (
    <button
      className={className ? `hq-opActionButton ${className}` : "hq-opActionButton"}
      data-tone={tone}
      {...rest}
    >
      {children}
    </button>
  );
}

function ActionReasonField(props: {
  name: string;
  placeholder: string;
  entityLabel: string;
  actionLabel: string;
  promptLabel: string;
  rows?: number;
  onError: (message: string) => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const aiPromptRef = useRef<HTMLTextAreaElement | null>(null);
  const [tone, setTone] = useState<(typeof ACTION_CENTER_AI_TONES)[number]>("Professional");
  const [busy, setBusy] = useState(false);
  const [toneMenuOpen, setToneMenuOpen] = useState(false);
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");

  useEffect(() => {
    if (!aiPromptOpen) return;
    aiPromptRef.current?.focus();
  }, [aiPromptOpen]);

  async function draftWithCavAi() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const promptInstruction = aiInstruction.trim();
    if (!promptInstruction) return;

    setBusy(true);
    try {
      const form = textarea.form;
      const formData = form ? new FormData(form) : null;
      const contextLines: string[] = [];
      if (formData) {
        for (const [key, value] of formData.entries()) {
          if (key === props.name || key === "action" || key === "caseId") continue;
          if (typeof value !== "string") continue;
          const trimmed = value.trim();
          if (!trimmed) continue;
          contextLines.push(`${humanizeToken(key)}: ${trimmed}`);
        }
      }

      const prompt = [
        "Write a concise internal HQ action rationale. Return plain text only with no markdown, no bullets, and no greeting.",
        `Tone: ${tone}.`,
        `Target: ${props.entityLabel}.`,
        `Action: ${props.actionLabel}.`,
        `Field: ${props.promptLabel}.`,
        contextLines.length ? `Current form context:\n${contextLines.join("\n")}` : "Current form context: none supplied.",
        textarea.value.trim() ? `Existing draft:\n${textarea.value.trim()}` : "Existing draft is blank.",
        `What to write:\n${promptInstruction}`,
      ].join("\n\n");

      const response = await fetch("/api/ai/center/assist", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({
          action: "email_text_agent",
          surface: "general",
          prompt,
          model: ALIBABA_QWEN_PLUS_MODEL_ID,
          reasoningLevel: "low",
          contextLabel: "HQ Action Center",
          context: {
            source: "admin.action_center",
            channel: "operations",
            target: props.entityLabel,
            assistant: "Messenger",
          },
        }),
      });
      const payload = await response.json().catch(() => ({})) as {
        ok?: boolean;
        data?: { answer?: string };
        error?: string;
        message?: string;
      };
      if (!response.ok || payload.ok !== true || !payload.data?.answer) {
        throw new Error(String(payload.message || payload.error || "CavAi could not draft this reason."));
      }

      textarea.value = String(payload.data.answer || "").trim();
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      textarea.focus();
      setToneMenuOpen(false);
      setAiPromptOpen(false);
      setAiInstruction("");
    } catch (error) {
      props.onError(error instanceof Error ? error.message : "CavAi could not draft this reason.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hq-opReasonField">
      <label className="hq-opReasonShell" data-ai-open={aiPromptOpen ? "true" : "false"}>
        <textarea
          ref={textareaRef}
          className="hq-textarea hq-opReasonTextarea"
          name={props.name}
          rows={props.rows || 3}
          placeholder={props.placeholder}
        />

        {aiPromptOpen ? (
          <div className="hq-opReasonAiPromptField">
            <textarea
              ref={aiPromptRef}
              className="hq-textarea hq-opReasonAiPrompt"
              rows={3}
              value={aiInstruction}
              onChange={(event) => setAiInstruction(event.currentTarget.value)}
              placeholder="Help me write"
            />
            <div className="hq-opReasonAiPromptTools">
              <button
                className="hq-opReasonAiPromptSend"
                type="button"
                aria-label={busy ? "CavAi is drafting" : "Generate with CavAi"}
                title={busy ? "CavAi is drafting" : "Generate with CavAi"}
                onClick={() => { void draftWithCavAi(); }}
                disabled={busy || !aiInstruction.trim()}
              >
                <span className="hq-chatComposerAiPromptSendGlyph" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : null}

        <div className="hq-opReasonAssistBar">
          <div className="hq-opReasonAssistToneWrap hq-chatComposerAiToneWrap">
            <button
              className="hq-opReasonAssistToneButton hq-chatComposerAiToneButton"
              type="button"
              aria-label={`Tone ${tone}. Open tone menu`}
              aria-haspopup="menu"
              aria-expanded={toneMenuOpen}
              title={`Tone: ${tone}`}
              onClick={() => setToneMenuOpen((current) => !current)}
            >
              <span className="hq-chatComposerAiToneGlyph" aria-hidden="true" />
            </button>

            {toneMenuOpen ? (
              <div className="hq-opReasonAssistToneMenu hq-chatComposerAiToneMenu" role="menu" aria-label="Choose CavAi tone">
                {ACTION_CENTER_AI_TONES.map((option) => (
                  <button
                    key={option}
                    className="hq-chatComposerAiToneOption"
                    type="button"
                    role="menuitemradio"
                    aria-checked={tone === option}
                    data-active={tone === option}
                    onClick={() => {
                      setTone(option);
                      setToneMenuOpen(false);
                    }}
                  >
                    {option}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            className="hq-opReasonAssistButton"
            type="button"
            onClick={() => {
              setAiPromptOpen((current) => !current);
              setToneMenuOpen(false);
            }}
            disabled={busy}
            title={aiPromptOpen ? "Close help me write" : "Help me write with CavAi"}
            aria-label={aiPromptOpen ? "Close help me write" : "Help me write with CavAi"}
          >
            <span className="hq-chatComposerGlyph" data-icon="cavai" aria-hidden="true" />
          </button>
        </div>
      </label>
    </div>
  );
}

export function AccountActionCenter(props: AccountActionCenterProps) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState("");
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [resetNonce, setResetNonce] = useState(0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (props.previewMode) return;
    const form = event.currentTarget;
    const formData = new FormData(form);
    const action = String(formData.get("action") || "").trim();
    if (!action) return;
    const submitKey = `${action}:${String(formData.get("membershipId") || formData.get("role") || "")}`;
    setBusyKey(submitKey);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/accounts/${props.accountId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action,
          reason: String(formData.get("reason") || "").trim() || null,
          notifySubject: formData.get("notifySubject") === "on",
          customerVisibleNote: String(formData.get("customerVisibleNote") || "").trim() || null,
          caseId: String(formData.get("caseId") || "").trim() || null,
          input: formDataInput(formData, ["action", "reason", "notifySubject", "customerVisibleNote", "caseId"]),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error || "Account action failed."));
      }
      setFeedback({ tone: "good", message: `${formatActionResultLabel(action)} completed for ${props.accountName}.` });
      form.reset();
      setResetNonce((value) => value + 1);
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "bad",
        message: error instanceof Error ? error.message : "Account action failed.",
      });
    } finally {
      setBusyKey("");
    }
  }

  const recentCases = useMemo(
    () => props.cases.map((caseItem) => ({
      id: caseItem.id,
      heading: caseItem.caseCode,
      meta: `${caseItem.subject} · ${caseItem.status} · ${caseItem.priority}`,
      tone: (caseItem.priority === "CRITICAL" ? "bad" : caseItem.priority === "HIGH" ? "watch" : "good") as "good" | "watch" | "bad",
      href: `/cases`,
    })),
    [props.cases],
  );

  return (
    <Panel title="Action Center" subtitle="Operate this workspace directly from HQ with trust, billing, customer success, and note controls.">
      <div id="action-center" className="hq-opSectionStack">
        <div className="hq-opSummaryGrid">
          <SummaryCard
            label="Trust status"
            value={props.discipline?.status || "ACTIVE"}
            meta={props.discipline?.suspendedUntilISO ? `Until ${formatDateLabel(props.discipline.suspendedUntilISO)}` : "No active restriction"}
          />
          <SummaryCard
            label="Violations"
            value={String(props.discipline?.violationCount || 0)}
            meta="Recorded against this workspace"
          />
          <SummaryCard
            label="Open cases"
            value={String(props.cases.length)}
            meta="Linked operational follow-up"
          />
          <SummaryCard
            label="Workspace users"
            value={String(props.members.length)}
            meta={`${props.billingAdjustments.length} billing adjustments logged`}
          />
        </div>

        <FeedbackBanner feedback={feedback} />

        {props.previewMode ? (
          <div className="hq-opFeedback" data-tone="watch">
            {props.previewLabel || "Preview workspace. Actions are disabled on this record."}
          </div>
        ) : null}

        <fieldset className="hq-opFieldset" disabled={props.previewMode}>
          <div className="hq-opGrid">
            <section className="hq-opSection">
              <div className="hq-opSectionHeading">
                <div className="hq-opSectionTitle">Trust &amp; Safety</div>
                <p className="hq-opSectionSub">Run suspension, restore, and revoke decisions in compact operational cards.</p>
              </div>
              <div className="hq-opActionGrid">
              <OperationCard
                key={`suspend-${resetNonce}`}
                title="Suspend access"
                subtitle="Pause workspace access and capture the internal rationale."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" disabled={busyKey === "suspend:"}>Suspend</OperationActionButton>}
              >
                <input type="hidden" name="action" value="suspend" />
                <div className="hq-opInlineFields">
                  <select name="durationDays" className="hq-select" defaultValue="7">
                    <option value="7">Suspend 7 days</option>
                    <option value="14">Suspend 14 days</option>
                    <option value="30">Suspend 30 days</option>
                  </select>
                  <label className="hq-opCheck">
                    <input type="checkbox" name="notifySubject" />
                    Notify workspace
                  </label>
                </div>
                <ActionReasonField
                  name="reason"
                  rows={3}
                  placeholder="Why this workspace is being suspended"
                  entityLabel={`Workspace ${props.accountName}`}
                  actionLabel="Suspend workspace access"
                  promptLabel="Internal suspension rationale"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
                <textarea className="hq-textarea hq-opSecondaryTextarea" name="customerVisibleNote" rows={2} placeholder="Customer-visible update (optional)" />
              </OperationCard>

              <OperationCard
                key={`restore-${resetNonce}`}
                title="Restore access"
                subtitle="Return the workspace to good standing with a logged rationale."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" disabled={busyKey === "restore:"}>Restore</OperationActionButton>}
              >
                <input type="hidden" name="action" value="restore" />
                <ActionReasonField
                  name="reason"
                  rows={2}
                  placeholder="Why access is being restored"
                  entityLabel={`Workspace ${props.accountName}`}
                  actionLabel="Restore workspace access"
                  promptLabel="Internal restoration rationale"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
              </OperationCard>

              <OperationCard
                key={`revoke-${resetNonce}`}
                title="Permanent revoke"
                subtitle="Revoke the workspace permanently and preserve the revocation record."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" tone="danger" disabled={busyKey === "revoke:"}>Revoke</OperationActionButton>}
              >
                <input type="hidden" name="action" value="revoke" />
                <label className="hq-opCheck">
                  <input type="checkbox" name="notifySubject" />
                  Notify workspace
                </label>
                <ActionReasonField
                  name="reason"
                  rows={2}
                  placeholder="Permanent revoke rationale"
                  entityLabel={`Workspace ${props.accountName}`}
                  actionLabel="Permanently revoke workspace access"
                  promptLabel="Revocation rationale"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
              </OperationCard>
            </div>
            </section>

            <section className="hq-opSection">
              <div className="hq-opSectionHeading">
                <div className="hq-opSectionTitle">Plan &amp; Billing Ops</div>
                <p className="hq-opSectionSub">Keep billing actions compact, legible, and ready for fast operator reasoning.</p>
              </div>
              <div className="hq-opActionGrid">
              <OperationCard
                key={`extend_trial-${resetNonce}`}
                title="Extend trial"
                subtitle="Move the trial window forward with a precise internal explanation."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" disabled={busyKey === "extend_trial:"}>Extend</OperationActionButton>}
              >
                <input type="hidden" name="action" value="extend_trial" />
                <select name="durationDays" className="hq-select" defaultValue="14">
                  <option value="7">Extend 7 days</option>
                  <option value="14">Extend 14 days</option>
                  <option value="30">Extend 30 days</option>
                </select>
                <ActionReasonField
                  name="reason"
                  rows={2}
                  placeholder="Why this trial is being extended"
                  entityLabel={`Workspace ${props.accountName}`}
                  actionLabel="Extend trial"
                  promptLabel="Trial extension rationale"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
              </OperationCard>

              <OperationCard
                key={`change_plan-${resetNonce}`}
                title="Change plan"
                subtitle="Adjust subscription tier and state with a cleaner billing record."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" disabled={busyKey === "change_plan:"}>Change</OperationActionButton>}
              >
                <input type="hidden" name="action" value="change_plan" />
                <div className="hq-opInlineFields">
                  <select name="planTier" className="hq-select" defaultValue="PREMIUM">
                    <option value="FREE">Free</option>
                    <option value="PREMIUM">Premium</option>
                    <option value="PREMIUM_PLUS">Premium+</option>
                  </select>
                  <select name="subscriptionStatus" className="hq-select" defaultValue="ACTIVE">
                    <option value="ACTIVE">Active</option>
                    <option value="TRIALING">Trialing</option>
                    <option value="PAST_DUE">Past due</option>
                    <option value="CANCELED">Canceled</option>
                  </select>
                </div>
                <ActionReasonField
                  name="reason"
                  rows={2}
                  placeholder="Why the subscription is being changed"
                  entityLabel={`Workspace ${props.accountName}`}
                  actionLabel="Change plan and subscription state"
                  promptLabel="Plan change rationale"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
              </OperationCard>

              <OperationCard
                key={`apply_credit-${resetNonce}`}
                title="Apply credit"
                subtitle="Issue a recorded credit and preserve the commercial reason."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" disabled={busyKey === "apply_credit:"}>Credit</OperationActionButton>}
              >
                <input type="hidden" name="action" value="apply_credit" />
                <input className="hq-input" name="amountCents" inputMode="numeric" placeholder="Credit in cents" />
                <ActionReasonField
                  name="reason"
                  rows={2}
                  placeholder="Why this credit is being applied"
                  entityLabel={`Workspace ${props.accountName}`}
                  actionLabel="Apply subscription credit"
                  promptLabel="Credit rationale"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
              </OperationCard>

              <OperationCard
                key={`apply_comp-${resetNonce}`}
                title="Apply comp"
                subtitle="Record complimentary value without burying the business reason."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" disabled={busyKey === "apply_comp:"}>Comp</OperationActionButton>}
              >
                <input type="hidden" name="action" value="apply_comp" />
                <input className="hq-input" name="amountCents" inputMode="numeric" placeholder="Comp in cents" />
                <ActionReasonField
                  name="reason"
                  rows={2}
                  placeholder="Why this comp is being applied"
                  entityLabel={`Workspace ${props.accountName}`}
                  actionLabel="Apply subscription comp"
                  promptLabel="Comp rationale"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
              </OperationCard>
            </div>
            </section>
          </div>

          <div className="hq-opGrid hq-opGridSingle">
            <section className="hq-opSection">
              <div className="hq-opSectionHeading">
                <div className="hq-opSectionTitle">Customer Success</div>
                <p className="hq-opSectionSub">Keep onboarding follow-through and internal notes in the same management lane.</p>
              </div>
              <div className="hq-opActionGrid">
                <OperationCard
                  key={`resend_onboarding-${resetNonce}`}
                  title="Resend onboarding"
                  subtitle="Trigger the onboarding reminder with aligned internal context."
                  onSubmit={submit}
                  actionButton={<OperationActionButton type="submit" disabled={busyKey === "resend_onboarding:"}>Resend</OperationActionButton>}
                >
                  <input type="hidden" name="action" value="resend_onboarding" />
                  <ActionReasonField
                    name="reason"
                    rows={2}
                    placeholder="Optional context for the resend"
                    entityLabel={`Workspace ${props.accountName}`}
                    actionLabel="Resend onboarding guidance"
                    promptLabel="Resend context"
                    onError={(message) => setFeedback({ tone: "bad", message })}
                  />
                </OperationCard>

                <OperationCard
                  key={`note-${resetNonce}`}
                  title="Internal note"
                  subtitle="Capture an internal workspace note without leaving the management surface."
                  onSubmit={submit}
                  actionButton={<OperationActionButton type="submit" disabled={busyKey === "note:"}>Save note</OperationActionButton>}
                >
                  <input type="hidden" name="action" value="note" />
                  <ActionReasonField
                    name="reason"
                    rows={3}
                    placeholder="Internal workspace note"
                    entityLabel={`Workspace ${props.accountName}`}
                    actionLabel="Log internal workspace note"
                    promptLabel="Internal note"
                    onError={(message) => setFeedback({ tone: "bad", message })}
                  />
                </OperationCard>
              </div>
            </section>
          </div>
        </fieldset>

        <div className="hq-opGrid hq-opGridContext">
          <RecentContext
            title="Recent cases"
            items={recentCases}
          />
          <RecentContext
            title="Recent notes"
            items={props.notes.map((note) => ({
              id: note.id,
              heading: note.customerVisibleNote ? "Customer-visible note" : "Internal note",
              meta: `${note.body} · ${formatDateLabel(note.createdAt)}`,
              tone: (note.customerVisibleNote ? "watch" : "good") as "good" | "watch" | "bad",
            }))}
          />
          <RecentContext
            title="Billing ledger"
            items={props.billingAdjustments.map((entry) => ({
              id: entry.id,
              heading: entry.kind,
              meta: `${entry.reason} · ${formatMoneyCents(entry.amountCents)} · ${formatDateLabel(entry.createdAt)}`,
              tone: (entry.kind === "COMP" ? "watch" : "good") as "good" | "watch" | "bad",
            }))}
          />
        </div>
      </div>
    </Panel>
  );
}

export function UserActionCenter(props: UserActionCenterProps) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState("");
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [resetNonce, setResetNonce] = useState(0);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const action = String(formData.get("action") || "").trim();
    if (!action) return;
    const submitKey = `${action}:${String(formData.get("membershipId") || "")}`;
    setBusyKey(submitKey);
    setFeedback(null);
    try {
      const response = await fetch(`/api/admin/clients/${props.userId}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          action,
          reason: String(formData.get("reason") || "").trim() || null,
          notifySubject: formData.get("notifySubject") === "on",
          customerVisibleNote: String(formData.get("customerVisibleNote") || "").trim() || null,
          caseId: String(formData.get("caseId") || "").trim() || null,
          input: formDataInput(formData, ["action", "reason", "notifySubject", "customerVisibleNote", "caseId"]),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.ok) {
        throw new Error(String(payload?.error || "User action failed."));
      }
      setFeedback({ tone: "good", message: `${formatActionResultLabel(action)} completed for ${props.displayName}.` });
      form.reset();
      setResetNonce((value) => value + 1);
      router.refresh();
    } catch (error) {
      setFeedback({
        tone: "bad",
        message: error instanceof Error ? error.message : "User action failed.",
      });
    } finally {
      setBusyKey("");
    }
  }

  return (
    <Panel title="Action Center" subtitle="Run trust, recovery, membership, and note workflows directly for this client identity.">
      <div id="action-center" className="hq-opSectionStack">
        <div className="hq-opSummaryGrid">
          <SummaryCard
            label="Trust status"
            value={props.discipline?.status || "ACTIVE"}
            meta={props.discipline?.suspendedUntilISO ? `Until ${formatDateLabel(props.discipline.suspendedUntilISO)}` : "No active restriction"}
          />
          <SummaryCard
            label="Violations"
            value={String(props.discipline?.violationCount || 0)}
            meta={props.discipline?.lastSessionKillAtISO ? `Sessions killed ${formatDateLabel(props.discipline.lastSessionKillAtISO)}` : "No forced session kill logged"}
          />
          <SummaryCard
            label="Memberships"
            value={String(props.memberships.length)}
            meta="Connected workspace roles"
          />
          <SummaryCard
            label="Open cases"
            value={String(props.cases.length)}
            meta={`${props.notes.length} saved notes`}
          />
        </div>

        <FeedbackBanner feedback={feedback} />

        <div className="hq-opGrid">
          <section className="hq-opSection">
            <div className="hq-opSectionHeading">
              <div className="hq-opSectionTitle">Trust &amp; Safety</div>
              <p className="hq-opSectionSub">Handle user trust actions with the same compact control logic as the rest of HQ.</p>
            </div>
            <div className="hq-opActionGrid">
              <OperationCard
                key={`user-suspend-${resetNonce}`}
                title="Suspend access"
                subtitle="Pause this user and log the trust rationale cleanly."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" disabled={busyKey === "suspend:"}>Suspend</OperationActionButton>}
              >
                <input type="hidden" name="action" value="suspend" />
                <div className="hq-opInlineFields">
                  <select name="durationDays" className="hq-select" defaultValue="7">
                    <option value="7">Suspend 7 days</option>
                    <option value="14">Suspend 14 days</option>
                    <option value="30">Suspend 30 days</option>
                  </select>
                  <label className="hq-opCheck">
                    <input type="checkbox" name="notifySubject" />
                    Notify user
                  </label>
                </div>
                <ActionReasonField
                  name="reason"
                  rows={3}
                  placeholder="Why this user is being suspended"
                  entityLabel={`Client ${props.displayName}`}
                  actionLabel="Suspend user access"
                  promptLabel="Suspension rationale"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
                <textarea className="hq-textarea hq-opSecondaryTextarea" name="customerVisibleNote" rows={2} placeholder="Customer-visible update (optional)" />
              </OperationCard>

              <OperationCard
                key={`user-restore-${resetNonce}`}
                title="Restore access"
                subtitle="Return access with a logged note explaining the recovery decision."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" disabled={busyKey === "restore:"}>Restore</OperationActionButton>}
              >
                <input type="hidden" name="action" value="restore" />
                <ActionReasonField
                  name="reason"
                  rows={2}
                  placeholder="Why access is being restored"
                  entityLabel={`Client ${props.displayName}`}
                  actionLabel="Restore user access"
                  promptLabel="Restoration rationale"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
              </OperationCard>

              <OperationCard
                key={`user-revoke-${resetNonce}`}
                title="Permanent revoke"
                subtitle="Remove access permanently while preserving the final rationale."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" tone="danger" disabled={busyKey === "revoke:"}>Revoke</OperationActionButton>}
              >
                <input type="hidden" name="action" value="revoke" />
                <ActionReasonField
                  name="reason"
                  rows={2}
                  placeholder="Permanent revoke rationale"
                  entityLabel={`Client ${props.displayName}`}
                  actionLabel="Permanently revoke user access"
                  promptLabel="Revocation rationale"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
              </OperationCard>

              <OperationCard
                key={`identity-review-${resetNonce}`}
                title="Identity review"
                subtitle="Record the review outcome and keep the investigation note attached."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" disabled={busyKey === "identity_review:"}>Record</OperationActionButton>}
              >
                <input type="hidden" name="action" value="identity_review" />
                <select className="hq-select" name="outcome" defaultValue="approved">
                  <option value="approved">Approved</option>
                  <option value="manual_review">Manual review</option>
                  <option value="rejected">Rejected</option>
                </select>
                <ActionReasonField
                  name="reason"
                  rows={2}
                  placeholder="Identity review notes"
                  entityLabel={`Client ${props.displayName}`}
                  actionLabel="Record identity review"
                  promptLabel="Identity review note"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
              </OperationCard>
            </div>
          </section>

          <section className="hq-opSection">
            <div className="hq-opSectionHeading">
              <div className="hq-opSectionTitle">Recovery &amp; Membership</div>
              <p className="hq-opSectionSub">Keep recovery decisions and account-role overrides in one tighter operating lane.</p>
            </div>
            <div className="hq-opActionGrid">
              <OperationCard
                key={`reset-recovery-${resetNonce}`}
                title="Reset recovery"
                subtitle="Clear the user’s recovery path with a clean internal explanation."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" disabled={busyKey === "reset_recovery:"}>Reset</OperationActionButton>}
              >
                <input type="hidden" name="action" value="reset_recovery" />
                <ActionReasonField
                  name="reason"
                  rows={2}
                  placeholder="Why recovery is being reset"
                  entityLabel={`Client ${props.displayName}`}
                  actionLabel="Reset recovery"
                  promptLabel="Recovery reset rationale"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
              </OperationCard>

              <OperationCard
                key={`kill-sessions-${resetNonce}`}
                title="Kill sessions"
                subtitle="Expire active sessions quickly and leave behind the operational reason."
                onSubmit={submit}
                actionButton={<OperationActionButton type="submit" disabled={busyKey === "kill_sessions:"}>Kill</OperationActionButton>}
              >
                <input type="hidden" name="action" value="kill_sessions" />
                <ActionReasonField
                  name="reason"
                  rows={2}
                  placeholder="Why sessions are being killed"
                  entityLabel={`Client ${props.displayName}`}
                  actionLabel="Kill active sessions"
                  promptLabel="Session termination rationale"
                  onError={(message) => setFeedback({ tone: "bad", message })}
                />
              </OperationCard>
            </div>

            <div className="hq-opMemberList">
              {props.memberships.map((membership) => (
                <div key={membership.id} className="hq-opMemberRow">
                  <div>
                    <div className="hq-listLabel">
                      <Link href={`/accounts/${membership.account.id}`}>{membership.account.name}</Link>
                    </div>
                    <div className="hq-listMeta">{membership.role} · {membership.account.tier}</div>
                  </div>
                  <form className="hq-opMemberForm" onSubmit={submit}>
                    <input type="hidden" name="action" value="membership_override" />
                    <input type="hidden" name="membershipId" value={membership.id} />
                    <select className="hq-select" name="role" defaultValue={membership.role}>
                      <option value="MEMBER">Member</option>
                      <option value="ADMIN">Admin</option>
                      <option value="OWNER">Owner</option>
                    </select>
                    <OperationActionButton type="submit" disabled={busyKey === `membership_override:${membership.id}`}>Apply</OperationActionButton>
                  </form>
                </div>
              ))}
            </div>

            <OperationCard
              key={`user-note-${resetNonce}`}
              title="Internal note"
              subtitle="Capture a clean internal note without leaving the client control surface."
              onSubmit={submit}
              actionButton={<OperationActionButton type="submit" disabled={busyKey === "note:"}>Save note</OperationActionButton>}
            >
              <input type="hidden" name="action" value="note" />
              <ActionReasonField
                name="reason"
                rows={3}
                placeholder="Internal user note"
                entityLabel={`Client ${props.displayName}`}
                actionLabel="Log internal user note"
                promptLabel="Internal note"
                onError={(message) => setFeedback({ tone: "bad", message })}
              />
            </OperationCard>
          </section>
        </div>

        <div className="hq-opGrid hq-opGridContext">
          <RecentContext
            title="Recent cases"
            items={props.cases.map((caseItem) => ({
              id: caseItem.id,
              heading: caseItem.caseCode,
              meta: `${caseItem.subject} · ${caseItem.status} · ${caseItem.priority}`,
              tone: (caseItem.priority === "CRITICAL" ? "bad" : caseItem.priority === "HIGH" ? "watch" : "good") as "good" | "watch" | "bad",
              href: "/cases",
            }))}
          />
          <RecentContext
            title="Recent notes"
            items={props.notes.map((note) => ({
              id: note.id,
              heading: note.customerVisibleNote ? "Customer-visible note" : "Internal note",
              meta: `${note.body} · ${formatDateLabel(note.createdAt)}`,
              tone: (note.customerVisibleNote ? "watch" : "good") as "good" | "watch" | "bad",
            }))}
          />
        </div>
      </div>
    </Panel>
  );
}
