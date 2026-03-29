"use client";

import * as React from "react";

import AppShell from "@/components/AppShell";

import "./request-access.css";

type ResolvedUser = {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
};

type RequestResponse = {
  ok: boolean;
  deduped?: boolean;
  workspace?: {
    id: string;
    name: string;
  };
  message?: string;
  error?: string;
};

type ResolvedWorkspace = {
  id: string;
  name: string;
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

export default function RequestAccessPage() {
  const [input, setInput] = React.useState("");
  const [results, setResults] = React.useState<ResolvedUser[]>([]);
  const [lookupBusy, setLookupBusy] = React.useState(false);
  const [selected, setSelected] = React.useState<ResolvedUser | null>(null);
  const [resolvedWorkspace, setResolvedWorkspace] = React.useState<ResolvedWorkspace | null>(null);
  const [workspaceBusy, setWorkspaceBusy] = React.useState(false);
  const [submitBusy, setSubmitBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [success, setSuccess] = React.useState("");

  React.useEffect(() => {
    const query = s(input);
    if (!query) {
      setResults([]);
      setLookupBusy(false);
      setResolvedWorkspace(null);
      return;
    }

    const selectedUsername = s(selected?.username).toLowerCase();
    const normalized = query.replace(/^@+/, "").toLowerCase();
    if (selectedUsername && normalized === selectedUsername) return;

    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setLookupBusy(true);
      try {
        const res = await fetch(`/api/users/resolve?q=${encodeURIComponent(query)}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal: ctrl.signal,
        });
        const data = (await res.json().catch(() => ({}))) as { users?: ResolvedUser[] };
        if (!res.ok) return;
        setResults(Array.isArray(data.users) ? data.users : []);
      } catch {
        setResults([]);
      } finally {
        setLookupBusy(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(t);
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
    };
  }, [input, selected]);

  React.useEffect(() => {
    const raw = s(input);
    if (!raw) {
      setResolvedWorkspace(null);
      setWorkspaceBusy(false);
      return;
    }

    const selectedUsername = s(selected?.username).toLowerCase();
    const normalized = raw.replace(/^@+/, "").toLowerCase();
    const targetOwnerUsername = selectedUsername && normalized === selectedUsername
      ? s(selected?.username)
      : "";

    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setWorkspaceBusy(true);
      try {
        const qs = new URLSearchParams();
        if (targetOwnerUsername) {
          qs.set("targetOwnerUsername", targetOwnerUsername);
        } else {
          qs.set("targetOwnerProfileUrl", raw);
        }

        const res = await fetch(`/api/workspaces/access-requests/resolve?${qs.toString()}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store",
          signal: ctrl.signal,
        });

        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          workspace?: { id?: string; name?: string } | null;
        };

        if (!res.ok || data?.ok !== true || !data.workspace?.id) {
          setResolvedWorkspace(null);
          return;
        }

        setResolvedWorkspace({
          id: s(data.workspace.id),
          name: s(data.workspace.name) || "Workspace",
        });
      } catch {
        setResolvedWorkspace(null);
      } finally {
        setWorkspaceBusy(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(t);
      try {
        ctrl.abort();
      } catch {
        // ignore
      }
    };
  }, [input, selected]);

  const onSubmit = async () => {
    setError("");
    setSuccess("");

    const raw = s(input);
    if (!raw) {
      setError("Enter an owner username or CavBot profile URL.");
      return;
    }

    if (!resolvedWorkspace?.id) {
      setError("Select a valid workspace target before requesting access.");
      return;
    }

    setSubmitBusy(true);
    try {
      const res = await fetch("/api/workspaces/access-requests", {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "x-cavbot-csrf": "1",
        },
        body: JSON.stringify({ targetWorkspaceId: resolvedWorkspace.id }),
      });

      const data = (await res.json().catch(() => ({}))) as RequestResponse;
      if (!res.ok || !data.ok) {
        throw new Error(s(data.message || data.error || "Request failed."));
      }

      const workspaceName = s(data.workspace?.name) || s(resolvedWorkspace.name) || "workspace";
      setSuccess(data.deduped
        ? `Request already pending for ${workspaceName}.`
        : `Request sent to ${workspaceName}.`);
      setInput("");
      setSelected(null);
      setResults([]);
      setResolvedWorkspace(null);
    } catch (e) {
      setError(s(e instanceof Error ? e.message : "Request failed."));
    } finally {
      setSubmitBusy(false);
    }
  };

  return (
    <AppShell title="Request access" subtitle="Request workspace access by owner username or profile URL">
      <section className="request-access-panel" aria-label="Request workspace access">
        <header className="request-access-head">
          <h1>Request access</h1>
        </header>

        <div className="request-access-field">
          <label htmlFor="request-access-target">Enter Owner username or CavBot profile URL</label>
          <input
            id="request-access-target"
            value={input}
            onChange={(event) => {
              setInput(event.currentTarget.value);
              if (selected && event.currentTarget.value.replace(/^@+/, "").toLowerCase() !== s(selected.username).toLowerCase()) {
                setSelected(null);
              }
              setResolvedWorkspace(null);
            }}
            placeholder="@owner • app.cavbot.io/owner"
            autoComplete="off"
            spellCheck={false}
          />
          {lookupBusy ? <div className="request-access-meta">Searching…</div> : null}
          {workspaceBusy ? <div className="request-access-meta">Resolving workspace…</div> : null}

          {!lookupBusy && s(input) && results.length ? (
            <div className="request-access-results" role="listbox" aria-label="Owner matches">
              {results.map((user) => (
                <button
                  key={user.userId}
                  type="button"
                  className={`request-access-result ${selected?.userId === user.userId ? "is-active" : ""}`}
                  onClick={() => {
                    setSelected(user);
                    setInput(`@${user.username}`);
                    setResults([]);
                  }}
                >
                  <span>{user.displayName || `@${user.username}`}</span>
                  <small>@{user.username}</small>
                </button>
              ))}
            </div>
          ) : null}

          {!workspaceBusy && resolvedWorkspace ? (
            <div className="request-access-target">
              Target workspace: <strong>{resolvedWorkspace.name}</strong>
            </div>
          ) : null}
        </div>

        {error ? <div className="request-access-error">{error}</div> : null}
        {success ? <div className="request-access-success">{success}</div> : null}

        <div className="request-access-actions">
          <button
            type="button"
            className="request-access-submit"
            disabled={submitBusy || !resolvedWorkspace}
            onClick={onSubmit}
          >
            {submitBusy ? "Sending…" : "Request access"}
          </button>
        </div>
      </section>
    </AppShell>
  );
}
