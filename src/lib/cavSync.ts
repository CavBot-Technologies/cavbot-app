type SyncOpts = {
  key: string;
  onChange: (source: "storage" | "broadcast" | "poll") => void;
  intervalMs?: number;
};

export function bindStorageSync(opts: SyncOpts) {
  const { key, onChange, intervalMs = 2000 } = opts;
  let lastPoll = 0;
  let pollId: number | null = null;
  let bc: BroadcastChannel | null = null;

  function notify(source: "storage" | "broadcast" | "poll") {
    try {
      onChange(source);
    } catch {}
  }

  function onStorage(e: StorageEvent) {
    if (!e) return;
    if (e.key !== key) return;
    notify("storage");
  }

  function startPoll() {
    if (pollId) return;
    pollId = window.setInterval(() => {
      if (document.hidden) return;
      const now = Date.now();
      if (now - lastPoll < intervalMs) return;
      lastPoll = now;
      notify("poll");
    }, Math.max(800, intervalMs));
  }

  function stopPoll() {
    if (!pollId) return;
    window.clearInterval(pollId);
    pollId = null;
  }

  function onVisibility() {
    if (document.hidden) {
      stopPoll();
    } else {
      startPoll();
    }
  }

  try {
    window.addEventListener("storage", onStorage);
  } catch {}

  try {
    if (typeof BroadcastChannel !== "undefined") {
      bc = new BroadcastChannel(`cavbot:${key}`);
      bc.onmessage = () => notify("broadcast");
    }
  } catch {}

  try {
    document.addEventListener("visibilitychange", onVisibility);
  } catch {}

  startPoll();

  return {
    ping() {
      try {
        bc?.postMessage({ key, ts: Date.now() });
      } catch {}
    },
    dispose() {
      try {
        window.removeEventListener("storage", onStorage);
      } catch {}
      try {
        document.removeEventListener("visibilitychange", onVisibility);
      } catch {}
      stopPoll();
      try {
        bc?.close();
      } catch {}
      bc = null;
    },
  };
}
