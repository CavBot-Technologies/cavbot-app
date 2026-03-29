export function scopedRunLookupKey(accountId: string, runId: string) {
  return {
    accountId_runId: {
      accountId: String(accountId || "").trim(),
      runId: String(runId || "").trim(),
    },
  } as const;
}
