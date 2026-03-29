import "server-only";

import crypto from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Prisma, type CavCloudShareMode, type PlanTier, type PublicArtifactVisibility } from "@prisma/client";

import {
  ApiAuthError,
  getAppOrigin,
  requireAccountContext,
  requireSession,
  requireUser,
  type CavbotAccountSession,
} from "@/lib/apiAuth";
import { auditLogWrite } from "@/lib/audit";
import { getProjectSummaryForTenant } from "@/lib/cavbotApi.server";
import {
  assertCavCloudActionAllowed,
  assertCavCodeProjectAccess,
  type CavEffectivePermission,
} from "@/lib/cavcloud/permissions.server";
import { getCavCloudSettings } from "@/lib/cavcloud/settings.server";
import {
  createFolder as cavcloudCreateFolder,
  duplicateFile as cavcloudDuplicateFile,
  getTreeLite as cavcloudTreeLite,
  softDeleteFile as cavcloudSoftDeleteFile,
  softDeleteFolder as cavcloudSoftDeleteFolder,
  replaceFileContent as cavcloudReplaceFileContent,
  updateFile as cavcloudUpdateFile,
  updateFolder as cavcloudUpdateFolder,
  upsertTextFile as cavcloudUpsertTextFile,
} from "@/lib/cavcloud/storage.server";
import { getCavcloudObjectStream } from "@/lib/cavcloud/r2.server";
import { loadProjectMounts } from "@/lib/cavcode/mounts.server";
import { decryptAesGcm, encryptAesGcmB64 } from "@/lib/cryptoAesGcm.server";
import {
  createFolder as cavsafeCreateFolder,
  duplicateFile as cavsafeDuplicateFile,
  getFileById as cavsafeGetFileById,
  getRootFolder as cavsafeGetRootFolder,
  getTreeLite as cavsafeTreeLite,
  softDeleteFile as cavsafeSoftDeleteFile,
  softDeleteFolder as cavsafeSoftDeleteFolder,
  updateFile as cavsafeUpdateFile,
  updateFolder as cavsafeUpdateFolder,
  upsertTextFile as cavsafeUpsertTextFile,
} from "@/lib/cavsafe/storage.server";
import { getCavsafeObjectStream } from "@/lib/cavsafe/r2.server";
import { createCavSafeInvite, revokeCavSafeAccess } from "@/lib/cavsafe/privateShare.server";
import { resolvePlanIdFromTier, type PlanId } from "@/lib/plans";
import { prisma } from "@/lib/prisma";
import { requirePremiumEntitlement } from "@/lib/security/authorize";
import { buildCavGuardDecision } from "@/src/lib/cavguard/cavGuard.registry";
import * as ts from "typescript";

export type CavtoolsNamespace = "cavcloud" | "cavsafe" | "cavcode" | "telemetry" | "workspace";

export type CavtoolsFsItem = {
  type: "file" | "folder";
  namespace: CavtoolsNamespace;
  name: string;
  path: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  updatedAtISO?: string | null;
  readOnly?: boolean;
};

export type CavtoolsWorkspaceDiagnostic = {
  file: string;
  line: number;
  col: number;
  severity: "error" | "warn" | "info";
  source: string;
  code?: string;
  message: string;
  fixReady?: boolean;
};

export type CavtoolsWorkspaceDiagnosticsSummary = {
  total: number;
  errors: number;
  warnings: number;
  infos: number;
  filesScanned: number;
  generatedAtISO: string;
  truncated: boolean;
};

export type CavtoolsExecBlock =
  | { kind: "text"; title?: string; lines: string[] }
  | { kind: "table"; title?: string; columns: string[]; rows: Array<Record<string, string | number | boolean | null>> }
  | { kind: "json"; title?: string; data: unknown }
  | { kind: "files"; title?: string; cwd: string; items: CavtoolsFsItem[] }
  | {
      kind: "diagnostics";
      title?: string;
      diagnostics: CavtoolsWorkspaceDiagnostic[];
      summary: CavtoolsWorkspaceDiagnosticsSummary;
    }
  | { kind: "open"; title?: string; url: string; label?: string }
  | { kind: "warning"; message: string };

export type CavtoolsExecInput = {
  cwd?: string | null;
  command: string;
  projectId?: number | string | null;
  siteOrigin?: string | null;
  sessionId?: string | null;
};

export type CavtoolsExecOutput = {
  ok: boolean;
  cwd: string;
  command: string;
  warnings: string[];
  blocks: CavtoolsExecBlock[];
  durationMs: number;
  audit: {
    commandId: string;
    atISO: string;
    denied: boolean;
  };
  actor?: {
    memberRole: "OWNER" | "ADMIN" | "MEMBER" | "ANON";
    planId: PlanId | "free";
    includeCavsafe: boolean;
  };
  error?: {
    code: string;
    message: string;
    guardDecision?: ReturnType<typeof buildCavGuardDecision>;
  };
};

export type CavtoolsFileReadOutput = {
  ok: true;
  path: string;
  mimeType: string;
  readOnly: boolean;
  content: string;
  updatedAtISO?: string | null;
  sha256?: string | null;
  versionNumber?: number | null;
  etag?: string | null;
};

export type CavtoolsFileWriteOutput = {
  ok: true;
  path: string;
  mimeType: string;
  updatedAtISO?: string | null;
  sha256?: string | null;
  versionNumber?: number | null;
  etag?: string | null;
};

const ROOTS = ["/cavcloud", "/cavsafe", "/cavcode", "/telemetry", "/workspace"] as const;
const DEFAULT_CWD = "/cavcloud";
const MAX_CAT_BYTES = 512 * 1024;
const MAX_TREE_DEPTH = 4;
const MAX_LIST_ROWS = 120;
const MAX_LINT_FILES = 900;
const MAX_LINT_FILE_BYTES = 256 * 1024;
const MAX_LINT_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_LINT_DIAGNOSTICS = 2000;
const MAX_RUNTIME_FILES = 4800;
const MAX_RUNTIME_FILE_BYTES = 20 * 1024 * 1024;
const MAX_RUNTIME_TOTAL_BYTES = 350 * 1024 * 1024;
const MAX_RUNTIME_LOG_LINES = 6000;
const MAX_RUNTIME_LOG_LINE_CHARS = 1800;
const RUNTIME_POLL_BATCH = 240;
const RUNTIME_SESSION_RETENTION_MS = 30 * 60 * 1000;
const MAX_DEBUG_LOG_LINES = 5000;
const MAX_DEBUG_LOG_LINE_CHARS = 1800;
const DEBUG_POLL_BATCH = 220;
const DEBUG_SESSION_RETENTION_MS = 30 * 60 * 1000;
const MAX_PROJECT_SERVICE_LOG_LINES = 3500;
const MAX_PROJECT_SERVICE_LOG_LINE_CHARS = 1800;
const PROJECT_SERVICE_SESSION_RETENTION_MS = 45 * 60 * 1000;
const PROJECT_SERVICE_WATCH_INTERVAL_MS = 6000;
const PROJECT_SERVICE_MAX_DIAGNOSTICS = 3500;
const PROJECT_SERVICE_MAX_TS_FILES_FOR_GETERR = 4000;
const CAVCODE_SCM_ROOT = path.join(tmpdir(), "cavcode-scm");
const CAVCODE_INDEX_MAX_FILES = 6000;
const CAVCODE_INDEX_MAX_BYTES = 150 * 1024 * 1024;
const CAVCODE_INDEX_MAX_FILE_BYTES = 512 * 1024;
const CAVCODE_INDEX_RESULT_LIMIT = 400;
const CAVCODE_EVENT_BATCH = 200;
const MAX_TASK_LOG_LINES = 5000;
const MAX_TASK_LOG_LINE_CHARS = 1800;
const TASK_SESSION_RETENTION_MS = 45 * 60 * 1000;
const TASK_POLL_BATCH = 220;
const EXTENSION_HOST_SESSION_RETENTION_MS = 45 * 60 * 1000;
const MAX_EXTENSION_HOST_LOG_LINES = 3000;
const MAX_EXTENSION_HOST_LOG_LINE_CHARS = 1800;
const COLLAB_OP_BATCH = 240;
const SECURITY_AUDIT_LIMIT = 500;
const REMOTE_SESSION_RETENTION_MS = 60 * 60 * 1000;
const REMOTE_MAX_SESSION_LOG_LINES = 3200;
const REMOTE_MAX_SESSION_LOG_LINE_CHARS = 1800;
const RELIABILITY_EVENT_WINDOW_DAYS = 7;
const RELIABILITY_DEFAULT_SLO = 99.9;
const AI_CHECKPOINT_MAX_FILES = 220;
const AI_CHECKPOINT_MAX_BYTES = 6 * 1024 * 1024;
const AI_CHECKPOINT_MAX_FILE_BYTES = 160 * 1024;

type RuntimeRunKind = "dev" | "build" | "test";
type RuntimeSessionStatus = "starting" | "running" | "exited" | "failed" | "stopped";
type RuntimeLogStream = "stdout" | "stderr" | "system";
type DebugSessionStatus = "starting" | "running" | "paused" | "exited" | "failed" | "stopped";
type DebugLogStream = "stdout" | "stderr" | "system";
type DebugAdapterId = "node-inspector" | "chrome-inspector";

type RuntimeLogEntry = {
  seq: number;
  atISO: string;
  stream: RuntimeLogStream;
  text: string;
};

type RuntimeSession = {
  id: string;
  key: string;
  accountId: string;
  userId: string;
  projectId: number;
  kind: RuntimeRunKind;
  command: string;
  cwd: string;
  workspaceDir: string;
  process: ChildProcess | null;
  status: RuntimeSessionStatus;
  createdAtMs: number;
  updatedAtMs: number;
  exitCode: number | null;
  exitSignal: string | null;
  stopRequested: boolean;
  nextSeq: number;
  logTruncated: boolean;
  logs: RuntimeLogEntry[];
  partialStdout: string;
  partialStderr: string;
  filesMaterialized: number;
  bytesMaterialized: number;
};

type ProjectServiceSessionStatus = "starting" | "running" | "failed" | "stopped";

type ProjectServiceLogEntry = {
  seq: number;
  atISO: string;
  stream: "stdout" | "stderr" | "system";
  text: string;
};

type ProjectServiceMountSummary = {
  id: string;
  sourceType: "CAVCLOUD" | "CAVSAFE";
  mountPath: string;
  mode: "READ_ONLY" | "READ_WRITE";
};

type ProjectServiceSession = {
  id: string;
  key: string;
  accountId: string;
  userId: string;
  projectId: number;
  workspaceDir: string;
  process: ChildProcess | null;
  status: ProjectServiceSessionStatus;
  createdAtMs: number;
  updatedAtMs: number;
  stopRequested: boolean;
  exitCode: number | null;
  exitSignal: string | null;
  nextSeq: number;
  logTruncated: boolean;
  logs: ProjectServiceLogEntry[];
  partialStdout: string;
  partialStderr: string;
  protocolSeq: number;
  protocolBuffer: string;
  pending: Map<number, {
    command: string;
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: unknown) => void;
    timer: ReturnType<typeof setTimeout> | null;
  }>;
  configFiles: string[];
  tsFileCount: number;
  workspaceRoots: string[];
  projectReferences: Array<{ configPath: string; referencePath: string }>;
  mounts: ProjectServiceMountSummary[];
  caseSensitiveFs: boolean;
  workspaceRealPath: string;
  symlinkCount: number;
  diagnostics: CavtoolsWorkspaceDiagnostic[];
  diagnosticsByFile: Map<string, CavtoolsWorkspaceDiagnostic[]>;
  activeGeterrSeq: number | null;
  geterrDone: Set<number>;
  refreshState: {
    filesWritten: number;
    filesRemoved: number;
    bytesWritten: number;
    warnings: string[];
    syncedAtISO: string | null;
  };
  watcherTimer: ReturnType<typeof setInterval> | null;
  sourceVersion: number;
};

type TaskSessionStatus = "starting" | "running" | "exited" | "failed" | "stopped";

type TaskLogStream = "stdout" | "stderr" | "system";

type TaskLogEntry = {
  seq: number;
  atISO: string;
  stream: TaskLogStream;
  text: string;
};

type TaskProblemMatcherPattern = {
  regex: RegExp;
  fileGroup: number;
  lineGroup: number;
  columnGroup: number;
  codeGroup: number;
  severityGroup: number;
  messageGroup: number;
};

type TaskProblemMatcher = {
  id: string;
  owner: string;
  source: string;
  severity: "error" | "warn" | "info";
  pattern: TaskProblemMatcherPattern | null;
  backgroundBegins: RegExp | null;
  backgroundEnds: RegExp | null;
};

type TaskSession = {
  id: string;
  key: string;
  accountId: string;
  userId: string;
  projectId: number;
  taskId: string;
  label: string;
  command: string;
  cwd: string;
  workspaceDir: string;
  process: ChildProcess | null;
  status: TaskSessionStatus;
  createdAtMs: number;
  updatedAtMs: number;
  exitCode: number | null;
  exitSignal: string | null;
  stopRequested: boolean;
  isBackground: boolean;
  nextSeq: number;
  logTruncated: boolean;
  logs: TaskLogEntry[];
  partialStdout: string;
  partialStderr: string;
  diagnostics: CavtoolsWorkspaceDiagnostic[];
  problemMatchers: TaskProblemMatcher[];
  historyId: string;
};

type ExtensionHostSessionStatus = "starting" | "running" | "failed" | "stopped";
type ExtensionHostLogStream = "stdout" | "stderr" | "system";

type ExtensionHostLogEntry = {
  seq: number;
  atISO: string;
  stream: ExtensionHostLogStream;
  text: string;
};

type ExtensionInstallRecord = {
  extensionId: string;
  version: string;
  enabled: boolean;
  runtimeStatus: string;
  requestedPermissions: string[];
  grantedPermissions: string[];
  activationEvents: string[];
  installedAtISO: string;
  updatedAtISO: string;
  lastActivatedAtISO: string | null;
  activationCount: number;
};

type ExtensionHostSession = {
  id: string;
  key: string;
  accountId: string;
  userId: string;
  projectId: number;
  status: ExtensionHostSessionStatus;
  sandboxProfile: string;
  apiSurface: string[];
  extensions: ExtensionInstallRecord[];
  activatedExtensions: string[];
  createdAtMs: number;
  updatedAtMs: number;
  stopRequested: boolean;
  nextSeq: number;
  logTruncated: boolean;
  logs: ExtensionHostLogEntry[];
};

type CollabProtocol = "ot" | "crdt";

type CollabTextOperation = {
  kind: "insert" | "delete" | "replace";
  index: number;
  length: number;
  text: string;
};

type SecurityExecutionScope = "runtime" | "task" | "debug" | "project-service" | "extension-host" | "remote";
type ExecutionSandboxMode = "restricted" | "standard" | "extended";
type NetworkPolicyMode = "deny" | "project-only" | "allow";

type CavcodeExecutionPolicyRecord = {
  profile: "strict" | "balanced" | "trusted";
  sandboxMode: ExecutionSandboxMode;
  networkPolicy: NetworkPolicyMode;
  maxConcurrentRuntime: number;
  maxConcurrentDebug: number;
  maxConcurrentTasks: number;
  maxConcurrentExtensionHosts: number;
  allowedCommandRegex: string[];
  blockedCommandRegex: string[];
  quotas: Record<string, unknown>;
  policy: Record<string, unknown>;
  updatedAtISO: string;
};

type RemoteProviderType = "ssh" | "container" | "workspace";
type RemoteSessionStatus = "starting" | "running" | "failed" | "stopped";
type RemotePortForwardStatus = "active" | "closed";

type RemoteSessionLogEntry = {
  seq: number;
  atISO: string;
  stream: "system" | "telemetry";
  text: string;
};

type RemoteDebugAdapter = {
  id: string;
  label: string;
  type: string;
  host: string;
  port: number;
  capability: string[];
};

type RemoteSession = {
  id: string;
  key: string;
  accountId: string;
  projectId: number;
  userId: string;
  providerId: string;
  providerType: RemoteProviderType;
  providerLabel: string;
  workspacePath: string;
  status: RemoteSessionStatus;
  latencyMs: number;
  throughputKbps: number;
  adapterMap: RemoteDebugAdapter[];
  cacheDir: string;
  filesSynced: number;
  bytesSynced: number;
  createdAtMs: number;
  updatedAtMs: number;
  stopRequested: boolean;
  nextSeq: number;
  logTruncated: boolean;
  logs: RemoteSessionLogEntry[];
};

type ReliabilityBudgetConfig = {
  targetAvailability: number;
  errorBudgetPct: number;
  burnAlertPct: number;
  p95LatencyMs: number;
  updatedAtISO: string;
};

type ReliabilityActor = {
  accountId: string;
  userId: string;
  projectId: number;
};

type DebugBreakpoint = {
  id: string;
  kind: "source" | "function" | "logpoint";
  enabled: boolean;
  setId?: string | null;
  condition?: string | null;
  hitCondition?: string | null;
  logMessage?: string | null;
  functionName?: string | null;
  file: string;
  line: number;
  verified: boolean;
  message?: string | null;
  adapterBreakpointId?: string | null;
  hitCount: number;
};

type DebugDataBreakpoint = {
  id: string;
  accessType: "read" | "write" | "readWrite";
  enabled: boolean;
  variablesReference: number;
  expression?: string | null;
  message?: string | null;
};

type DebugStackFrame = {
  id: number;
  frameId: string;
  threadId: number;
  name: string;
  file: string | null;
  line: number | null;
  column: number | null;
};

type DebugThread = {
  id: number;
  name: string;
  stopped: boolean;
  reason?: string | null;
};

type DebugScope = {
  name: string;
  variablesReference: number;
  expensive: boolean;
  presentationHint?: string | null;
};

type DebugVariable = {
  name: string;
  value: string;
  type?: string | null;
  variablesReference: number;
  evaluateName?: string | null;
  namedVariables?: number | null;
  indexedVariables?: number | null;
};

type DebugAdapterCapabilities = {
  supportsConditionalBreakpoints: boolean;
  supportsHitConditionalBreakpoints: boolean;
  supportsLogPoints: boolean;
  supportsFunctionBreakpoints: boolean;
  supportsExceptionFilterOptions: boolean;
  supportsStepBack: boolean;
  supportsSetVariable: boolean;
  supportsEvaluateForHovers: boolean;
  supportsDataBreakpoints: boolean;
  supportsReadMemoryRequest: boolean;
};

type DebugDapProtocol = {
  adapterId: DebugAdapterId;
  adapterLabel: string;
  capabilities: DebugAdapterCapabilities;
};

type DebugAdapterDefinition = {
  id: DebugAdapterId;
  label: string;
  launchTypes: string[];
  languageHints: string[];
  capabilities: DebugAdapterCapabilities;
};

type DebugLaunchRequest = "launch" | "attach";

type DebugLaunchTarget = {
  id: string;
  name: string;
  request: DebugLaunchRequest;
  debugType: string;
  adapterId: DebugAdapterId;
  entryCavcodePath: string | null;
  cwdCavcodePath: string | null;
  runtimeExecutable: string;
  runtimeArgs: string[];
  programArgs: string[];
  stopOnEntry: boolean;
  env: Record<string, string>;
  sourceMaps: boolean;
  outFiles: string[];
  attachHost: string | null;
  attachPort: number | null;
  attachWsUrl: string | null;
  attachProcessId: number | null;
  preLaunchTask: string | null;
  postDebugTask: string | null;
  profileId: string | null;
  workspaceVariantId: string | null;
  presentationGroup: string | null;
  raw: Record<string, unknown>;
};

type DebugLaunchCompound = {
  id: string;
  name: string;
  configurationRefs: string[];
  targetIds: string[];
  preLaunchTask: string | null;
  postDebugTask: string | null;
  stopAll: boolean;
  presentationGroup: string | null;
  raw: Record<string, unknown>;
};

type DebugLaunchProfile = {
  id: string;
  name: string;
  description: string | null;
  runtimeExecutable: string | null;
  runtimeArgs: string[];
  programArgs: string[];
  cwdCavcodePath: string | null;
  env: Record<string, string>;
  preLaunchTask: string | null;
  postDebugTask: string | null;
  raw: Record<string, unknown>;
};

type DebugWorkspaceVariant = {
  id: string;
  name: string;
  description: string | null;
  runtimeExecutable: string | null;
  runtimeArgs: string[];
  programArgs: string[];
  cwdCavcodePath: string | null;
  env: Record<string, string>;
  preLaunchTask: string | null;
  postDebugTask: string | null;
  raw: Record<string, unknown>;
};

type DebugTaskDefinition = {
  id: string;
  label: string;
  type: string;
  command: string;
  args: string[];
  cwd: string | null;
  env: Record<string, string>;
  detail: string | null;
  dependsOn: string[];
  group: string | null;
  isBackground: boolean;
  problemMatchers: TaskProblemMatcher[];
  raw: Record<string, unknown>;
};

type DebugLaunchManifest = {
  targets: DebugLaunchTarget[];
  compounds: DebugLaunchCompound[];
  profiles: DebugLaunchProfile[];
  workspaceVariants: DebugWorkspaceVariant[];
  tasks: DebugTaskDefinition[];
};

type DebugLoadedScript = {
  scriptId: string;
  url: string;
  file: string | null;
  cavcodePath: string | null;
  sourceMapUrl: string | null;
  hash: string | null;
  language: string | null;
  isModule: boolean;
  lastSeenISO: string;
};

type DebugLoadedModule = {
  module: string;
  scriptCount: number;
};

type DebugCdpScopeChainEntry = {
  type: string;
  name?: string;
  object?: { objectId?: string };
};

type DebugCdpFrameState = {
  frameId: string;
  functionName: string;
  scriptId: string | null;
  url: string;
  line: number;
  column: number;
  scopeChain: DebugCdpScopeChainEntry[];
};

type DebugConsoleEntry = {
  seq: number;
  atISO: string;
  category: "stdout" | "stderr" | "console" | "repl" | "exception";
  text: string;
  level?: string | null;
};

type DebugLogEntry = {
  seq: number;
  atISO: string;
  stream: DebugLogStream;
  text: string;
};

type DebugPendingRequest = {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: unknown) => void;
  method: string;
  timer: ReturnType<typeof setTimeout> | null;
};

type DebugSession = {
  id: string;
  key: string;
  accountId: string;
  userId: string;
  projectId: number;
  entryCavcodePath: string;
  entryRelPath: string;
  workspaceDir: string;
  adapterId: DebugAdapterId;
  adapterType: string;
  protocol: DebugDapProtocol;
  launchTargetName: string | null;
  launchRequest: DebugLaunchRequest;
  attachInfo: {
    host: string | null;
    port: number | null;
    wsUrl: string | null;
    processId: number | null;
  } | null;
  process: ChildProcess | null;
  wsUrl: string | null;
  ws: WebSocket | null;
  wsPartialStderr: string;
  nextRequestId: number;
  pendingRequests: Map<number, DebugPendingRequest>;
  status: DebugSessionStatus;
  createdAtMs: number;
  updatedAtMs: number;
  exitCode: number | null;
  exitSignal: string | null;
  stopRequested: boolean;
  nextSeq: number;
  logTruncated: boolean;
  logs: DebugLogEntry[];
  consoleEntries: DebugConsoleEntry[];
  partialStdout: string;
  partialStderr: string;
  breakpoints: Map<string, DebugBreakpoint>;
  functionBreakpoints: Map<string, DebugBreakpoint>;
  dataBreakpoints: Map<string, DebugDataBreakpoint>;
  exceptionFilters: {
    all: boolean;
    uncaught: boolean;
  };
  threads: DebugThread[];
  stack: DebugStackFrame[];
  scopes: Map<number, DebugScope[]>;
  variablesByRef: Map<number, { objectId: string; evaluateName?: string | null; frameId?: string | null }>;
  nextVariablesRef: number;
  cdpFramesById: Map<string, DebugCdpFrameState>;
  frameOrdinalById: Map<string, number>;
  scriptUrlById: Map<string, string>;
  scriptMetaById: Map<string, {
    url: string;
    sourceMapUrl: string | null;
    hash: string | null;
    language: string | null;
    isModule: boolean;
    lastSeenMs: number;
  }>;
  watches: Map<string, string | null>;
  selectedThreadId: number | null;
  selectedFrameId: string | null;
  postDebugTask: string | null;
  postDebugTaskRan: boolean;
  launchProfileId: string | null;
  workspaceVariantId: string | null;
  launchCompoundName: string | null;
  currentLocation: {
    file: string | null;
    line: number | null;
    column: number | null;
  };
  filesMaterialized: number;
  bytesMaterialized: number;
};

type CavcodeEventEnvelope = {
  seq: number;
  kind: string;
  projectId: number;
  userId: string;
  atISO: string;
  payload: Record<string, unknown>;
};

type CavcodeIndexerSymbol = {
  name: string;
  kind: string;
  file: string;
  line: number;
  col: number;
  exported: boolean;
};

type CavcodeIndexerReference = {
  name: string;
  file: string;
  line: number;
  col: number;
  context: "read" | "write" | "type";
};

type CavcodeIndexerCall = {
  callee: string;
  file: string;
  line: number;
  col: number;
};

type CavcodeIndexerDependencyEdge = {
  from: string;
  to: string;
};

type CavcodeIndexerSnapshot = {
  generatedAtISO: string;
  fileCount: number;
  filesIndexed: number;
  bytesIndexed: number;
  symbols: CavcodeIndexerSymbol[];
  references: CavcodeIndexerReference[];
  calls: CavcodeIndexerCall[];
  dependencies: CavcodeIndexerDependencyEdge[];
  shards?: Array<{
    key: string;
    files: number;
    symbols: number;
    references: number;
    calls: number;
    dependencies: number;
  }>;
  incremental?: {
    changedFiles: number;
    unchangedFiles: number;
    removedFiles: number;
    shardCount: number;
  };
};

const runtimeSessions = new Map<string, RuntimeSession>();
const runtimeSessionByProject = new Map<string, string>();
const projectServiceSessions = new Map<string, ProjectServiceSession>();
const projectServiceSessionByProject = new Map<string, string>();
const taskSessions = new Map<string, TaskSession>();
const extensionHostSessions = new Map<string, ExtensionHostSession>();
const extensionHostSessionByProject = new Map<string, string>();
const remoteSessions = new Map<string, RemoteSession>();
const remoteSessionByProject = new Map<string, string>();
const debugSessions = new Map<string, DebugSession>();
const debugSessionByProject = new Map<string, string>();
let cavcodeInfraTablesReady = false;

class CavtoolsExecError extends Error {
  code: string;
  status: number;
  guardActionId: string | null;

  constructor(code: string, message: string, status = 400, guardActionId?: string | null) {
    super(message);
    this.code = code;
    this.status = status;
    this.guardActionId = guardActionId || null;
  }
}

type Token = {
  value: string;
  start: number;
  end: number;
};

type ExecContext = {
  session: CavbotAccountSession & { sub: string };
  accountId: string;
  userId: string;
  memberRole: "OWNER" | "ADMIN" | "MEMBER";
  planId: PlanId;
  includeCavsafe: boolean;
  project: {
    id: number;
    slug: string;
    name: string;
    serverKeyEnc: string | null;
    serverKeyEncIv: string | null;
  } | null;
  siteOrigin: string | null;
  request: Request;
};

type ParsedCommand = {
  raw: string;
  name: string;
  args: string[];
  tokens: Token[];
};

type CloudNode = {
  folder: {
    id: string;
    name: string;
    path: string;
    parentId: string | null;
    updatedAt: Date;
    createdAt: Date;
  } | null;
  file: {
    id: string;
    name: string;
    path: string;
    folderId: string;
    mimeType: string;
    r2Key: string;
    bytes: bigint;
    updatedAt: Date;
    sha256: string;
  } | null;
};

type SafeNode = {
  folder: {
    id: string;
    name: string;
    path: string;
    parentId: string | null;
    updatedAt: Date;
    createdAt: Date;
  } | null;
  file: {
    id: string;
    name: string;
    path: string;
    folderId: string;
    mimeType: string;
    r2Key: string;
    bytes: bigint;
    updatedAt: Date;
    sha256: string;
  } | null;
};

type MountRow = {
  id: string;
  sourceType: "CAVCLOUD" | "CAVSAFE";
  mountPath: string;
  mode: "READ_ONLY" | "READ_WRITE";
  priority: number;
  folderId: string;
  folder: {
    id: string;
    path: string;
    deletedAt: Date | null;
  } | null;
};

type ResolvedMountPath = {
  mount: MountRow;
  sourceType: "CAVCLOUD" | "CAVSAFE";
  sourcePath: string;
  relPath: string;
};

function s(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeOrigin(input: string | null | undefined): string | null {
  const raw = s(input);
  if (!raw) return null;
  try {
    const withProto = raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`;
    const url = new URL(withProto);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function normalizePath(rawPath: string): string {
  const raw = String(rawPath || "").trim();
  if (!raw) return "/";

  const withLeading = raw.startsWith("/") ? raw : `/${raw}`;
  const parts = withLeading.split("/");
  const stack: string[] = [];

  for (const part of parts) {
    const seg = part.trim();
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      stack.pop();
      continue;
    }
    stack.push(seg);
  }

  const path = `/${stack.join("/")}`;
  if (path.length > 1 && path.endsWith("/")) return path.slice(0, -1);
  return path || "/";
}

function resolvePath(input: string | null | undefined, cwd: string): string {
  const arg = s(input);
  if (!arg) return normalizePath(cwd || DEFAULT_CWD);
  if (arg.startsWith("/")) return normalizePath(arg);
  return normalizePath(`${normalizePath(cwd || DEFAULT_CWD)}/${arg}`);
}

function pathRoot(path: string): (typeof ROOTS)[number] | null {
  const normalized = normalizePath(path);
  for (const root of ROOTS) {
    if (normalized === root || normalized.startsWith(`${root}/`)) return root;
  }
  return null;
}

function assertKnownRoot(path: string): void {
  const root = pathRoot(path);
  if (!root) {
    throw new CavtoolsExecError(
      "UNKNOWN_NAMESPACE",
      `Path "${path}" is outside CavTools namespaces. Allowed roots: ${ROOTS.join(", ")}.`,
      400
    );
  }
}

function toNamespacePath(namespaceRoot: "/cavcloud" | "/cavsafe", sourcePath: string): string {
  const src = normalizePath(sourcePath || "/");
  if (src === "/") return namespaceRoot;
  return `${namespaceRoot}${src}`;
}

function toSourcePath(namespaceRoot: "/cavcloud" | "/cavsafe", virtualPath: string): string {
  const normalized = normalizePath(virtualPath);
  if (normalized === namespaceRoot) return "/";
  if (!normalized.startsWith(`${namespaceRoot}/`)) {
    throw new CavtoolsExecError("PATH_OUT_OF_SCOPE", `Path "${virtualPath}" is outside ${namespaceRoot}.`, 400);
  }
  const rest = normalized.slice(namespaceRoot.length);
  return normalizePath(rest || "/");
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/") return "/";
  const parts = normalized.split("/").filter(Boolean);
  if (parts.length <= 1) return "/";
  return `/${parts.slice(0, -1).join("/")}`;
}

function basename(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/") return "";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || "";
}

function nowISO(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Math.trunc(ms)));
  });
}

function toSafeNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (value > max) return Number.MAX_SAFE_INTEGER;
  if (value < BigInt(0)) return 0;
  return Number(value);
}

function maybeTextMimeType(mimeType: string | null | undefined): boolean {
  const mime = s(mimeType).toLowerCase();
  if (!mime) return false;
  if (mime.startsWith("text/")) return true;
  if (mime.includes("json")) return true;
  if (mime.includes("xml")) return true;
  if (mime.includes("javascript")) return true;
  if (mime.includes("typescript")) return true;
  if (mime.includes("yaml")) return true;
  if (mime.includes("toml")) return true;
  if (mime.includes("svg")) return true;
  return false;
}

function hashCommandId(command: string, cwd: string): string {
  const payload = `${Date.now()}:${cwd}:${command}:${Math.random().toString(16).slice(2)}`;
  return Buffer.from(payload).toString("base64url").slice(0, 32);
}

function tokenize(rawInput: string): Token[] {
  const input = String(rawInput || "");
  const tokens: Token[] = [];
  const len = input.length;
  let i = 0;

  while (i < len) {
    while (i < len && /\s/.test(input[i])) i += 1;
    if (i >= len) break;

    const start = i;
    let out = "";
    let quote: '"' | "'" | null = null;

    while (i < len) {
      const ch = input[i];
      if (quote) {
        if (ch === "\\" && i + 1 < len) {
          out += input[i + 1];
          i += 2;
          continue;
        }
        if (ch === quote) {
          quote = null;
          i += 1;
          continue;
        }
        out += ch;
        i += 1;
        continue;
      }

      if (ch === "\"" || ch === "'") {
        quote = ch;
        i += 1;
        continue;
      }

      if (/\s/.test(ch)) break;

      if (ch === "\\" && i + 1 < len) {
        out += input[i + 1];
        i += 2;
        continue;
      }

      out += ch;
      i += 1;
    }

    const end = i;
    tokens.push({ value: out, start, end });

    while (i < len && /\s/.test(input[i])) i += 1;
  }

  return tokens;
}

function parseCommand(rawInput: string): ParsedCommand {
  const raw = String(rawInput || "").trim();
  const tokens = tokenize(raw);
  const name = s(tokens[0]?.value || "").toLowerCase();
  const args = tokens.slice(1).map((token) => token.value);
  return {
    raw,
    name,
    args,
    tokens,
  };
}

function parseWriteContent(parsed: ParsedCommand): { pathArg: string; content: string } {
  if (parsed.tokens.length < 3) {
    throw new CavtoolsExecError("WRITE_USAGE", "Usage: write <path> <content>", 400);
  }
  const pathArg = parsed.tokens[1]?.value || "";
  const contentStart = parsed.tokens[2]?.start || 0;
  const content = parsed.raw.slice(contentStart).trim();
  return { pathArg, content };
}

async function resolveAccountPlan(accountId: string): Promise<PlanId> {
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      tier: true,
      trialSeatActive: true,
      trialEndsAt: true,
    },
  });

  const tier = (account?.tier || "FREE") as PlanTier;
  const trialEndsAtMs = account?.trialEndsAt ? new Date(account.trialEndsAt).getTime() : 0;
  if (account?.trialSeatActive && Number.isFinite(trialEndsAtMs) && trialEndsAtMs > Date.now()) {
    return "premium_plus";
  }
  return resolvePlanIdFromTier(tier);
}

async function resolveProjectForContext(accountId: string, projectIdHint: number | null) {
  const project = projectIdHint
    ? await prisma.project.findFirst({
        where: {
          id: projectIdHint,
          accountId,
          isActive: true,
        },
        select: {
          id: true,
          slug: true,
          name: true,
          serverKeyEnc: true,
          serverKeyEncIv: true,
        },
      })
    : await prisma.project.findFirst({
        where: {
          accountId,
          isActive: true,
        },
        orderBy: {
          createdAt: "asc",
        },
        select: {
          id: true,
          slug: true,
          name: true,
          serverKeyEnc: true,
          serverKeyEncIv: true,
        },
      });

  return project
    ? {
        id: project.id,
        slug: s(project.slug) || "project",
        name: s(project.name) || "Project",
        serverKeyEnc: project.serverKeyEnc || null,
        serverKeyEncIv: project.serverKeyEncIv || null,
      }
    : null;
}

async function resolveExecContext(req: Request, input: CavtoolsExecInput): Promise<ExecContext> {
  const session = await requireSession(req);
  requireUser(session);
  requireAccountContext(session);

  const accountId = s(session.accountId);
  const userId = s(session.sub);
  if (!accountId || !userId) {
    throw new CavtoolsExecError("UNAUTHORIZED", "Unauthorized", 401, "AUTH_REQUIRED");
  }

  const memberRole = (s(session.memberRole).toUpperCase() || "MEMBER") as "OWNER" | "ADMIN" | "MEMBER";

  const projectIdHintNum = Number(input.projectId);
  const projectIdHint = Number.isFinite(projectIdHintNum) && Number.isInteger(projectIdHintNum) && projectIdHintNum > 0
    ? projectIdHintNum
    : null;

  const [planId, project] = await Promise.all([
    resolveAccountPlan(accountId),
    resolveProjectForContext(accountId, projectIdHint),
  ]);

  return {
    session: session as CavbotAccountSession & { sub: string },
    accountId,
    userId,
    memberRole,
    planId,
    includeCavsafe: planId === "premium" || planId === "premium_plus",
    project,
    siteOrigin: normalizeOrigin(input.siteOrigin),
    request: req,
  };
}

function formatErrorMessage(err: unknown): { code: string; message: string; status: number; guardActionId: string | null } {
  if (err instanceof CavtoolsExecError) {
    return {
      code: err.code,
      message: err.message,
      status: err.status,
      guardActionId: err.guardActionId,
    };
  }

  if (err instanceof ApiAuthError) {
    const code = s(err.code).toUpperCase() || "UNAUTHORIZED";
    const status = Number(err.status || 401) || 401;
    if (code === "PLAN_REQUIRED" || code === "PLAN_UPGRADE_REQUIRED") {
      return {
        code,
        message: "Plan entitlement required.",
        status,
        guardActionId: "CAVSAFE_PLAN_REQUIRED",
      };
    }
    return {
      code,
      message: code === "UNAUTHORIZED" ? "Unauthorized" : code,
      status,
      guardActionId: status === 401 ? "AUTH_REQUIRED" : "ROLE_BLOCKED",
    };
  }

  const status = Number((err as { status?: unknown })?.status || 500);
  const code = s((err as { code?: unknown })?.code) || "INTERNAL";
  const message = s((err as { message?: unknown })?.message) || "Command failed.";
  return {
    code,
    message,
    status: Number.isFinite(status) ? status : 500,
    guardActionId: null,
  };
}

async function writeCommandAudit(ctx: ExecContext, args: {
  commandId: string;
  command: string;
  cwd: string;
  ok: boolean;
  denied: boolean;
  durationMs: number;
  code?: string;
}) {
  await auditLogWrite({
    accountId: ctx.accountId,
    operatorUserId: ctx.userId,
    action: "SYSTEM_JOB_RAN",
    actionLabel: args.ok ? "CavTools command executed" : "CavTools command denied",
    category: "system",
    severity: args.ok ? "info" : args.denied ? "warning" : "destructive",
    targetType: "cavtools_command",
    targetId: args.commandId,
    targetLabel: args.command,
    request: ctx.request,
    metaJson: {
      commandId: args.commandId,
      command: args.command,
      cwd: args.cwd,
      ok: args.ok,
      denied: args.denied,
      durationMs: args.durationMs,
      errorCode: args.code || null,
      page: "cavtools",
      projectId: ctx.project?.id || null,
      siteOrigin: ctx.siteOrigin || null,
    },
  });
}

async function readObjectText(stream: ReadableStream<Uint8Array>, maxBytes = MAX_CAT_BYTES): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;

    if (total + value.length > maxBytes) {
      const keep = Math.max(0, maxBytes - total);
      if (keep > 0) chunks.push(value.slice(0, keep));
      total = maxBytes;
      break;
    }

    chunks.push(value);
    total += value.length;
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder("utf-8", { fatal: false }).decode(combined);
}

async function readObjectBuffer(stream: ReadableStream<Uint8Array>, maxBytes: number): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value || value.length === 0) continue;

    if (total + value.length > maxBytes) {
      const keep = Math.max(0, maxBytes - total);
      if (keep > 0) chunks.push(value.slice(0, keep));
      total = maxBytes;
      break;
    }

    chunks.push(value);
    total += value.length;
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return Buffer.from(combined);
}

async function ensureCavcodeInfraTables() {
  if (cavcodeInfraTablesReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeEvent" (
      "seq" BIGSERIAL PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeEvent_account_project_seq_idx"
    ON "CavCodeEvent" ("accountId", "projectId", "seq");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeIndexSnapshot" (
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "hash" TEXT NOT NULL,
      "snapshot" JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CavCodeIndexSnapshot_pkey" PRIMARY KEY ("accountId", "projectId")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeIndexSnapshot_account_project_idx"
    ON "CavCodeIndexSnapshot" ("accountId", "projectId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeIndexShard" (
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "filePath" TEXT NOT NULL,
      "fileHash" TEXT NOT NULL,
      "shardKey" TEXT NOT NULL,
      "payload" JSONB NOT NULL,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CavCodeIndexShard_pkey" PRIMARY KEY ("accountId", "projectId", "filePath")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeIndexShard_account_project_shard_idx"
    ON "CavCodeIndexShard" ("accountId", "projectId", "shardKey");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeAiLoopRun" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "goal" TEXT NOT NULL,
      "result" JSONB NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeAiLoopRun_account_project_created_idx"
    ON "CavCodeAiLoopRun" ("accountId", "projectId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeTaskRun" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "taskId" TEXT NOT NULL,
      "taskLabel" TEXT NOT NULL,
      "command" TEXT NOT NULL,
      "cwd" TEXT NOT NULL,
      "isBackground" BOOLEAN NOT NULL DEFAULT FALSE,
      "status" TEXT NOT NULL,
      "exitCode" INTEGER,
      "exitSignal" TEXT,
      "problemCount" INTEGER NOT NULL DEFAULT 0,
      "result" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "finishedAt" TIMESTAMP(3)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeTaskRun_account_project_created_idx"
    ON "CavCodeTaskRun" ("accountId", "projectId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeExtensionMarketplace" (
      "id" TEXT PRIMARY KEY,
      "extensionId" TEXT NOT NULL,
      "version" TEXT NOT NULL,
      "publisher" TEXT NOT NULL DEFAULT '',
      "manifest" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "activationEvents" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "permissions" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "signature" TEXT NOT NULL,
      "signatureAlgo" TEXT NOT NULL DEFAULT 'hmac-sha256',
      "packageUrl" TEXT,
      "status" TEXT NOT NULL DEFAULT 'active',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeExtensionMarketplace_extension_status_idx"
    ON "CavCodeExtensionMarketplace" ("extensionId", "status", "updatedAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "CavCodeExtensionMarketplace_extension_version_unique"
    ON "CavCodeExtensionMarketplace" ("extensionId", "version");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeExtensionInstall" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "extensionId" TEXT NOT NULL,
      "version" TEXT NOT NULL,
      "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
      "runtimeStatus" TEXT NOT NULL DEFAULT 'installed',
      "requestedPermissions" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "grantedPermissions" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "activationEvents" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "activationCount" INTEGER NOT NULL DEFAULT 0,
      "lastActivatedAt" TIMESTAMP(3),
      "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "CavCodeExtensionInstall_account_project_extension_unique"
    ON "CavCodeExtensionInstall" ("accountId", "projectId", "extensionId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeExtensionInstall_account_project_updated_idx"
    ON "CavCodeExtensionInstall" ("accountId", "projectId", "updatedAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeExtensionHostSession" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "sandboxProfile" TEXT NOT NULL,
      "apiSurface" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "extensions" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "activatedExtensions" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "logs" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "stoppedAt" TIMESTAMP(3)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeExtensionHostSession_account_project_created_idx"
    ON "CavCodeExtensionHostSession" ("accountId", "projectId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeCollabSession" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "documentPath" TEXT NOT NULL,
      "protocol" TEXT NOT NULL DEFAULT 'ot',
      "status" TEXT NOT NULL DEFAULT 'active',
      "baseVersion" BIGINT NOT NULL DEFAULT 0,
      "vectorClock" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdBy" TEXT NOT NULL,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "endedAt" TIMESTAMP(3)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeCollabSession_account_project_status_idx"
    ON "CavCodeCollabSession" ("accountId", "projectId", "status", "updatedAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeCollabPresence" (
      "id" TEXT PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "displayName" TEXT,
      "color" TEXT,
      "activeFile" TEXT,
      "cursor" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "selection" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "sharedPanels" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "CavCodeCollabPresence_session_user_unique"
    ON "CavCodeCollabPresence" ("sessionId", "userId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeCollabPresence_account_project_session_idx"
    ON "CavCodeCollabPresence" ("accountId", "projectId", "sessionId", "updatedAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeCollabOpLog" (
      "id" TEXT PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "clientId" TEXT NOT NULL,
      "seq" BIGINT NOT NULL,
      "opKind" TEXT NOT NULL,
      "baseVersion" BIGINT NOT NULL DEFAULT 0,
      "appliedVersion" BIGINT NOT NULL DEFAULT 0,
      "operation" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "transformed" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeCollabOpLog_session_seq_idx"
    ON "CavCodeCollabOpLog" ("sessionId", "seq");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeCollabOpLog_account_project_created_idx"
    ON "CavCodeCollabOpLog" ("accountId", "projectId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeExecutionPolicy" (
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "profile" TEXT NOT NULL DEFAULT 'balanced',
      "sandboxMode" TEXT NOT NULL DEFAULT 'standard',
      "networkPolicy" TEXT NOT NULL DEFAULT 'project-only',
      "maxConcurrentRuntime" INTEGER NOT NULL DEFAULT 1,
      "maxConcurrentDebug" INTEGER NOT NULL DEFAULT 1,
      "maxConcurrentTasks" INTEGER NOT NULL DEFAULT 2,
      "maxConcurrentExtensionHosts" INTEGER NOT NULL DEFAULT 1,
      "allowedCommandRegex" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "blockedCommandRegex" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "quotas" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "updatedBy" TEXT NOT NULL DEFAULT '',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CavCodeExecutionPolicy_pkey" PRIMARY KEY ("accountId", "projectId")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeSecretBroker" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "alias" TEXT NOT NULL,
      "valueEnc" TEXT NOT NULL,
      "valueIv" TEXT NOT NULL,
      "scopes" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "policy" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "rotatedAt" TIMESTAMP(3),
      "revokedAt" TIMESTAMP(3)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "CavCodeSecretBroker_account_project_alias_unique"
    ON "CavCodeSecretBroker" ("accountId", "projectId", "alias");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeSecretBroker_account_project_updated_idx"
    ON "CavCodeSecretBroker" ("accountId", "projectId", "updatedAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeQuarantineScan" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "targetKind" TEXT NOT NULL,
      "targetPath" TEXT NOT NULL,
      "targetHash" TEXT,
      "engine" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "verdict" TEXT NOT NULL,
      "findings" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "finishedAt" TIMESTAMP(3)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeQuarantineScan_account_project_created_idx"
    ON "CavCodeQuarantineScan" ("accountId", "projectId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeSecurityAudit" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "action" TEXT NOT NULL,
      "resource" TEXT NOT NULL,
      "decision" TEXT NOT NULL,
      "reason" TEXT,
      "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeSecurityAudit_account_project_created_idx"
    ON "CavCodeSecurityAudit" ("accountId", "projectId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeSecurityAudit_account_project_action_idx"
    ON "CavCodeSecurityAudit" ("accountId", "projectId", "action", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeRemoteProvider" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "providerType" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'active',
      "config" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "CavCodeRemoteProvider_account_project_provider_unique"
    ON "CavCodeRemoteProvider" ("accountId", "projectId", "providerId");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeRemoteSession" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "providerId" TEXT NOT NULL,
      "providerType" TEXT NOT NULL,
      "workspacePath" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "latencyMs" INTEGER NOT NULL DEFAULT 120,
      "throughputKbps" INTEGER NOT NULL DEFAULT 10240,
      "adapterMap" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "syncState" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "logs" JSONB NOT NULL DEFAULT '[]'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "stoppedAt" TIMESTAMP(3)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeRemoteSession_account_project_created_idx"
    ON "CavCodeRemoteSession" ("accountId", "projectId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeRemotePortForward" (
      "id" TEXT PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "localPort" INTEGER NOT NULL,
      "remoteHost" TEXT NOT NULL,
      "remotePort" INTEGER NOT NULL,
      "protocol" TEXT NOT NULL DEFAULT 'tcp',
      "status" TEXT NOT NULL DEFAULT 'active',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "closedAt" TIMESTAMP(3)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeRemotePortForward_account_project_session_idx"
    ON "CavCodeRemotePortForward" ("accountId", "projectId", "sessionId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeReliabilitySnapshot" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "scopeId" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeReliabilitySnapshot_account_project_kind_created_idx"
    ON "CavCodeReliabilitySnapshot" ("accountId", "projectId", "kind", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeCrashRecord" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "scopeId" TEXT NOT NULL,
      "error" TEXT NOT NULL,
      "stack" TEXT,
      "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "resolvedAt" TIMESTAMP(3)
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeCrashRecord_account_project_created_idx"
    ON "CavCodeCrashRecord" ("accountId", "projectId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeDeterministicReplay" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "category" TEXT NOT NULL,
      "sessionId" TEXT NOT NULL,
      "seq" BIGINT NOT NULL,
      "action" TEXT NOT NULL,
      "payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeDeterministicReplay_account_project_category_idx"
    ON "CavCodeDeterministicReplay" ("accountId", "projectId", "category", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeReliabilityBudget" (
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "targetAvailability" DOUBLE PRECISION NOT NULL DEFAULT 99.9,
      "errorBudgetPct" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
      "burnAlertPct" DOUBLE PRECISION NOT NULL DEFAULT 50,
      "p95LatencyMs" INTEGER NOT NULL DEFAULT 1200,
      "updatedBy" TEXT NOT NULL DEFAULT '',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CavCodeReliabilityBudget_pkey" PRIMARY KEY ("accountId", "projectId")
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeAiCheckpoint" (
      "id" TEXT PRIMARY KEY,
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "label" TEXT NOT NULL,
      "snapshot" JSONB NOT NULL,
      "fileCount" INTEGER NOT NULL DEFAULT 0,
      "byteCount" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "CavCodeAiCheckpoint_account_project_created_idx"
    ON "CavCodeAiCheckpoint" ("accountId", "projectId", "createdAt");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CavCodeWorkbenchState" (
      "accountId" TEXT NOT NULL,
      "projectId" INTEGER NOT NULL,
      "userId" TEXT NOT NULL,
      "stateKey" TEXT NOT NULL,
      "state" JSONB NOT NULL DEFAULT '{}'::jsonb,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CavCodeWorkbenchState_pkey" PRIMARY KEY ("accountId", "projectId", "userId", "stateKey")
    );
  `);
  cavcodeInfraTablesReady = true;
}

function toEventEnvelopeRow(
  row: {
    seq: bigint | number;
    kind: string;
    projectId: number;
    userId: string;
    payload: unknown;
    createdAt: Date | string;
  }
): CavcodeEventEnvelope {
  const seqRaw = typeof row.seq === "bigint" ? Number(row.seq) : Number(row.seq);
  const seq = Number.isFinite(seqRaw) ? Math.max(0, Math.trunc(seqRaw)) : 0;
  const createdAt = row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt);
  const payloadRecord = row.payload && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? (row.payload as Record<string, unknown>)
    : {};
  return {
    seq,
    kind: s(row.kind) || "event",
    projectId: Number.isFinite(Number(row.projectId)) ? Math.max(1, Math.trunc(Number(row.projectId))) : 0,
    userId: s(row.userId),
    atISO: Number.isFinite(createdAt.getTime()) ? createdAt.toISOString() : nowISO(),
    payload: payloadRecord,
  };
}

async function publishCavcodeEvent(
  ctx: ExecContext,
  kind: string,
  payload?: Record<string, unknown> | null
): Promise<CavcodeEventEnvelope | null> {
  if (!ctx.project?.id) return null;
  await ensureCavcodeInfraTables();
  const payloadJson = JSON.stringify(payload && typeof payload === "object" ? payload : {});
  const rows = await prisma.$queryRaw<Array<{
    seq: bigint | number;
    kind: string;
    projectId: number;
    userId: string;
    payload: unknown;
    createdAt: Date | string;
  }>>(
    Prisma.sql`
      INSERT INTO "CavCodeEvent" (
        "accountId",
        "projectId",
        "userId",
        "kind",
        "payload"
      ) VALUES (
        ${ctx.accountId},
        ${ctx.project.id},
        ${ctx.userId},
        ${s(kind) || "event"},
        CAST(${payloadJson} AS jsonb)
      )
      RETURNING "seq", "kind", "projectId", "userId", "payload", "createdAt"
    `
  );
  const row = rows[0];
  return row ? toEventEnvelopeRow(row) : null;
}

async function readCavcodeEventsBySeq(args: {
  accountId: string;
  projectId: number;
  afterSeq: number;
  limit?: number;
}): Promise<{ events: CavcodeEventEnvelope[]; nextSeq: number }> {
  await ensureCavcodeInfraTables();
  const limit = Math.max(1, Math.min(CAVCODE_EVENT_BATCH, Math.trunc(Number(args.limit || CAVCODE_EVENT_BATCH)) || CAVCODE_EVENT_BATCH));
  const afterSeq = Number.isFinite(Number(args.afterSeq)) ? Math.max(0, Math.trunc(Number(args.afterSeq))) : 0;
  const rows = await prisma.$queryRaw<Array<{
    seq: bigint | number;
    kind: string;
    projectId: number;
    userId: string;
    payload: unknown;
    createdAt: Date | string;
  }>>(
    Prisma.sql`
      SELECT "seq", "kind", "projectId", "userId", "payload", "createdAt"
      FROM "CavCodeEvent"
      WHERE "accountId" = ${args.accountId}
        AND "projectId" = ${args.projectId}
        AND "seq" > ${afterSeq}
      ORDER BY "seq" ASC
      LIMIT ${limit}
    `
  );
  const events = rows.map((row) => toEventEnvelopeRow(row));
  const nextSeq = events.length ? events[events.length - 1].seq : afterSeq;
  return { events, nextSeq };
}

function jsonStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => s(item)).filter(Boolean);
}

function executionPolicyDefaults(planId: PlanId): CavcodeExecutionPolicyRecord {
  const plan = s(planId).toLowerCase();
  if (plan.includes("premium_plus") || plan.includes("premium+") || plan.includes("max")) {
    return {
      profile: "trusted",
      sandboxMode: "extended",
      networkPolicy: "allow",
      maxConcurrentRuntime: 3,
      maxConcurrentDebug: 3,
      maxConcurrentTasks: 6,
      maxConcurrentExtensionHosts: 2,
      allowedCommandRegex: [],
      blockedCommandRegex: [],
      quotas: {
        maxRuntimeMinutes: 45,
        maxDebugMinutes: 90,
        maxTaskMinutes: 30,
        maxWorkspaceBytes: MAX_RUNTIME_TOTAL_BYTES,
      },
      policy: {},
      updatedAtISO: nowISO(),
    };
  }
  if (plan.includes("premium")) {
    return {
      profile: "balanced",
      sandboxMode: "standard",
      networkPolicy: "project-only",
      maxConcurrentRuntime: 2,
      maxConcurrentDebug: 2,
      maxConcurrentTasks: 4,
      maxConcurrentExtensionHosts: 1,
      allowedCommandRegex: [],
      blockedCommandRegex: [
        "(^|\\s)rm\\s+-rf\\s+/",
        "(^|\\s)mkfs\\b",
        "(^|\\s)dd\\s+if=",
      ],
      quotas: {
        maxRuntimeMinutes: 30,
        maxDebugMinutes: 60,
        maxTaskMinutes: 20,
        maxWorkspaceBytes: MAX_RUNTIME_TOTAL_BYTES,
      },
      policy: {},
      updatedAtISO: nowISO(),
    };
  }
  return {
    profile: "strict",
    sandboxMode: "restricted",
    networkPolicy: "deny",
    maxConcurrentRuntime: 1,
    maxConcurrentDebug: 1,
    maxConcurrentTasks: 2,
    maxConcurrentExtensionHosts: 1,
    allowedCommandRegex: [],
    blockedCommandRegex: [
      "(^|\\s)curl\\b",
      "(^|\\s)wget\\b",
      "(^|\\s)nc\\b",
      "(^|\\s)ssh\\b",
      "(^|\\s)rm\\s+-rf\\s+/",
      "(^|\\s)mkfs\\b",
      "(^|\\s)dd\\s+if=",
    ],
    quotas: {
      maxRuntimeMinutes: 20,
      maxDebugMinutes: 45,
      maxTaskMinutes: 15,
      maxWorkspaceBytes: MAX_RUNTIME_TOTAL_BYTES,
    },
    policy: {},
    updatedAtISO: nowISO(),
  };
}

function normalizeExecutionPolicyRow(row: Record<string, unknown> | null, fallback: CavcodeExecutionPolicyRecord): CavcodeExecutionPolicyRecord {
  if (!row) return fallback;
  const profile = s(row.profile || fallback.profile).toLowerCase();
  const sandboxModeRaw = s(row.sandboxMode || fallback.sandboxMode).toLowerCase();
  const networkPolicyRaw = s(row.networkPolicy || fallback.networkPolicy).toLowerCase();
  return {
    profile: profile === "strict" || profile === "trusted" ? profile : "balanced",
    sandboxMode:
      sandboxModeRaw === "restricted" || sandboxModeRaw === "extended" ? sandboxModeRaw : "standard",
    networkPolicy:
      networkPolicyRaw === "deny" || networkPolicyRaw === "allow" ? networkPolicyRaw : "project-only",
    maxConcurrentRuntime: Math.max(1, Math.min(8, Math.trunc(Number(row.maxConcurrentRuntime || fallback.maxConcurrentRuntime || 1)) || 1)),
    maxConcurrentDebug: Math.max(1, Math.min(8, Math.trunc(Number(row.maxConcurrentDebug || fallback.maxConcurrentDebug || 1)) || 1)),
    maxConcurrentTasks: Math.max(1, Math.min(20, Math.trunc(Number(row.maxConcurrentTasks || fallback.maxConcurrentTasks || 2)) || 2)),
    maxConcurrentExtensionHosts: Math.max(1, Math.min(6, Math.trunc(Number(row.maxConcurrentExtensionHosts || fallback.maxConcurrentExtensionHosts || 1)) || 1)),
    allowedCommandRegex: jsonStringArray(row.allowedCommandRegex),
    blockedCommandRegex: jsonStringArray(row.blockedCommandRegex),
    quotas: asRecord(row.quotas) || fallback.quotas || {},
    policy: asRecord(row.policy) || fallback.policy || {},
    updatedAtISO: (() => {
      const value = row.updatedAt;
      if (value instanceof Date) return value.toISOString();
      const parsed = new Date(s(value || ""));
      return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback.updatedAtISO;
    })(),
  };
}

async function readExecutionPolicy(ctx: ExecContext): Promise<CavcodeExecutionPolicyRecord> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for execution policy.", 400);
  await ensureCavcodeInfraTables();
  const fallback = executionPolicyDefaults(ctx.planId);
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "profile",
        "sandboxMode",
        "networkPolicy",
        "maxConcurrentRuntime",
        "maxConcurrentDebug",
        "maxConcurrentTasks",
        "maxConcurrentExtensionHosts",
        "allowedCommandRegex",
        "blockedCommandRegex",
        "quotas",
        "policy",
        "updatedAt"
      FROM "CavCodeExecutionPolicy"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
      LIMIT 1
    `
  );
  const picked = asRecord(rows[0]);
  if (picked) return normalizeExecutionPolicyRow(picked, fallback);

  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeExecutionPolicy" (
        "accountId",
        "projectId",
        "profile",
        "sandboxMode",
        "networkPolicy",
        "maxConcurrentRuntime",
        "maxConcurrentDebug",
        "maxConcurrentTasks",
        "maxConcurrentExtensionHosts",
        "allowedCommandRegex",
        "blockedCommandRegex",
        "quotas",
        "policy",
        "updatedBy"
      ) VALUES (
        ${ctx.accountId},
        ${ctx.project.id},
        ${fallback.profile},
        ${fallback.sandboxMode},
        ${fallback.networkPolicy},
        ${fallback.maxConcurrentRuntime},
        ${fallback.maxConcurrentDebug},
        ${fallback.maxConcurrentTasks},
        ${fallback.maxConcurrentExtensionHosts},
        CAST(${JSON.stringify(fallback.allowedCommandRegex)} AS jsonb),
        CAST(${JSON.stringify(fallback.blockedCommandRegex)} AS jsonb),
        CAST(${JSON.stringify(fallback.quotas)} AS jsonb),
        CAST(${JSON.stringify(fallback.policy)} AS jsonb),
        ${ctx.userId}
      )
      ON CONFLICT ("accountId", "projectId")
      DO NOTHING
    `
  );

  return fallback;
}

async function upsertExecutionPolicy(
  ctx: ExecContext,
  patch: Partial<CavcodeExecutionPolicyRecord>
): Promise<CavcodeExecutionPolicyRecord> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for execution policy.", 400);
  const current = await readExecutionPolicy(ctx);
  const merged: CavcodeExecutionPolicyRecord = {
    ...current,
    ...patch,
    updatedAtISO: nowISO(),
    allowedCommandRegex: patch.allowedCommandRegex ? [...patch.allowedCommandRegex] : current.allowedCommandRegex,
    blockedCommandRegex: patch.blockedCommandRegex ? [...patch.blockedCommandRegex] : current.blockedCommandRegex,
    quotas: patch.quotas ? { ...current.quotas, ...patch.quotas } : current.quotas,
    policy: patch.policy ? { ...current.policy, ...patch.policy } : current.policy,
  };
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeExecutionPolicy" (
        "accountId",
        "projectId",
        "profile",
        "sandboxMode",
        "networkPolicy",
        "maxConcurrentRuntime",
        "maxConcurrentDebug",
        "maxConcurrentTasks",
        "maxConcurrentExtensionHosts",
        "allowedCommandRegex",
        "blockedCommandRegex",
        "quotas",
        "policy",
        "updatedBy"
      ) VALUES (
        ${ctx.accountId},
        ${ctx.project.id},
        ${merged.profile},
        ${merged.sandboxMode},
        ${merged.networkPolicy},
        ${merged.maxConcurrentRuntime},
        ${merged.maxConcurrentDebug},
        ${merged.maxConcurrentTasks},
        ${merged.maxConcurrentExtensionHosts},
        CAST(${JSON.stringify(merged.allowedCommandRegex)} AS jsonb),
        CAST(${JSON.stringify(merged.blockedCommandRegex)} AS jsonb),
        CAST(${JSON.stringify(merged.quotas)} AS jsonb),
        CAST(${JSON.stringify(merged.policy)} AS jsonb),
        ${ctx.userId}
      )
      ON CONFLICT ("accountId", "projectId")
      DO UPDATE SET
        "profile" = EXCLUDED."profile",
        "sandboxMode" = EXCLUDED."sandboxMode",
        "networkPolicy" = EXCLUDED."networkPolicy",
        "maxConcurrentRuntime" = EXCLUDED."maxConcurrentRuntime",
        "maxConcurrentDebug" = EXCLUDED."maxConcurrentDebug",
        "maxConcurrentTasks" = EXCLUDED."maxConcurrentTasks",
        "maxConcurrentExtensionHosts" = EXCLUDED."maxConcurrentExtensionHosts",
        "allowedCommandRegex" = EXCLUDED."allowedCommandRegex",
        "blockedCommandRegex" = EXCLUDED."blockedCommandRegex",
        "quotas" = EXCLUDED."quotas",
        "policy" = EXCLUDED."policy",
        "updatedBy" = EXCLUDED."updatedBy",
        "updatedAt" = CURRENT_TIMESTAMP
    `
  );
  return merged;
}

async function writeSecurityAudit(
  ctx: ExecContext,
  args: {
    action: string;
    resource: string;
    decision: "allow" | "deny" | "warn";
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<void> {
  if (!ctx.project?.id) return;
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeSecurityAudit" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "action",
        "resource",
        "decision",
        "reason",
        "metadata"
      ) VALUES (
        ${`secaudit_${crypto.randomUUID()}`},
        ${ctx.accountId},
        ${ctx.project.id},
        ${ctx.userId},
        ${s(args.action) || "unknown"},
        ${s(args.resource) || "unknown"},
        ${s(args.decision) || "warn"},
        ${s(args.reason || "") || null},
        CAST(${JSON.stringify(args.metadata && typeof args.metadata === "object" ? args.metadata : {})} AS jsonb)
      )
    `
  );
}

function regexMatchAny(command: string, patterns: string[]): boolean {
  const text = s(command || "");
  if (!text || !patterns.length) return false;
  for (const pattern of patterns) {
    const raw = s(pattern);
    if (!raw) continue;
    try {
      if (new RegExp(raw, "i").test(text)) return true;
    } catch {}
  }
  return false;
}

function sessionActive(status: string): boolean {
  return status === "starting" || status === "running" || status === "paused";
}

async function assertExecutionAllowed(
  ctx: ExecContext,
  args: {
    scope: SecurityExecutionScope;
    command: string;
    resource?: string;
  }
): Promise<CavcodeExecutionPolicyRecord> {
  const policy = await readExecutionPolicy(ctx);
  const command = s(args.command || "");
  const resource = s(args.resource || args.scope || "execution");

  const runtimeCount = Array.from(runtimeSessions.values()).filter((row) =>
    row.accountId === ctx.accountId
    && row.projectId === (ctx.project?.id || 0)
    && sessionActive(row.status)
  ).length;
  const debugCount = Array.from(debugSessions.values()).filter((row) =>
    row.accountId === ctx.accountId
    && row.projectId === (ctx.project?.id || 0)
    && sessionActive(row.status)
  ).length;
  const taskCount = Array.from(taskSessions.values()).filter((row) =>
    row.accountId === ctx.accountId
    && row.projectId === (ctx.project?.id || 0)
    && sessionActive(row.status)
  ).length;
  const extensionHostCount = Array.from(extensionHostSessions.values()).filter((row) =>
    row.accountId === ctx.accountId
    && row.projectId === (ctx.project?.id || 0)
    && sessionActive(row.status)
  ).length;
  const remoteCount = Array.from(remoteSessions.values()).filter((row) =>
    row.accountId === ctx.accountId
    && row.projectId === (ctx.project?.id || 0)
    && sessionActive(row.status)
  ).length;

  if (args.scope === "runtime" && runtimeCount >= policy.maxConcurrentRuntime) {
    await writeSecurityAudit(ctx, {
      action: "execution.runtime",
      resource,
      decision: "deny",
      reason: `Runtime limit exceeded (${policy.maxConcurrentRuntime})`,
      metadata: { runtimeCount },
    });
    throw new CavtoolsExecError(
      "SECURITY_RUNTIME_LIMIT",
      `Execution policy limit reached for runtime sessions (${policy.maxConcurrentRuntime}).`,
      429
    );
  }
  if (args.scope === "debug" && debugCount >= policy.maxConcurrentDebug) {
    await writeSecurityAudit(ctx, {
      action: "execution.debug",
      resource,
      decision: "deny",
      reason: `Debug limit exceeded (${policy.maxConcurrentDebug})`,
      metadata: { debugCount },
    });
    throw new CavtoolsExecError(
      "SECURITY_DEBUG_LIMIT",
      `Execution policy limit reached for debug sessions (${policy.maxConcurrentDebug}).`,
      429
    );
  }
  if (args.scope === "task" && taskCount >= policy.maxConcurrentTasks) {
    await writeSecurityAudit(ctx, {
      action: "execution.task",
      resource,
      decision: "deny",
      reason: `Task limit exceeded (${policy.maxConcurrentTasks})`,
      metadata: { taskCount },
    });
    throw new CavtoolsExecError(
      "SECURITY_TASK_LIMIT",
      `Execution policy limit reached for task sessions (${policy.maxConcurrentTasks}).`,
      429
    );
  }
  if (args.scope === "extension-host" && extensionHostCount >= policy.maxConcurrentExtensionHosts) {
    await writeSecurityAudit(ctx, {
      action: "execution.extensionHost",
      resource,
      decision: "deny",
      reason: `Extension host limit exceeded (${policy.maxConcurrentExtensionHosts})`,
      metadata: { extensionHostCount },
    });
    throw new CavtoolsExecError(
      "SECURITY_EXTENSION_HOST_LIMIT",
      `Execution policy limit reached for extension host sessions (${policy.maxConcurrentExtensionHosts}).`,
      429
    );
  }
  if (args.scope === "remote" && remoteCount >= Math.max(1, policy.maxConcurrentRuntime)) {
    await writeSecurityAudit(ctx, {
      action: "execution.remote",
      resource,
      decision: "deny",
      reason: `Remote session limit exceeded (${Math.max(1, policy.maxConcurrentRuntime)})`,
      metadata: { remoteCount },
    });
    throw new CavtoolsExecError(
      "SECURITY_REMOTE_LIMIT",
      `Execution policy limit reached for remote sessions (${Math.max(1, policy.maxConcurrentRuntime)}).`,
      429
    );
  }

  if (command && regexMatchAny(command, policy.blockedCommandRegex)) {
    await writeSecurityAudit(ctx, {
      action: `execution.${args.scope}`,
      resource,
      decision: "deny",
      reason: "Command matched blocked policy pattern.",
      metadata: { command, blockedCommandRegex: policy.blockedCommandRegex },
    });
    throw new CavtoolsExecError("SECURITY_COMMAND_BLOCKED", "Execution policy blocked this command pattern.", 403);
  }

  if (policy.allowedCommandRegex.length && command && !regexMatchAny(command, policy.allowedCommandRegex)) {
    await writeSecurityAudit(ctx, {
      action: `execution.${args.scope}`,
      resource,
      decision: "deny",
      reason: "Command did not match allow-list policy pattern.",
      metadata: { command, allowedCommandRegex: policy.allowedCommandRegex },
    });
    throw new CavtoolsExecError("SECURITY_COMMAND_NOT_ALLOWED", "Execution policy requires an allow-list match for this command.", 403);
  }

  if (policy.networkPolicy === "deny") {
    const networkPattern = /(^|\s)(curl|wget|ssh|scp|rsync|nc|netcat|ftp|git\s+clone|npm\s+install|pnpm\s+add|yarn\s+add)\b/i;
    if (networkPattern.test(command)) {
      await writeSecurityAudit(ctx, {
        action: `execution.${args.scope}`,
        resource,
        decision: "deny",
        reason: "Network policy blocks outbound network commands.",
        metadata: { command, networkPolicy: policy.networkPolicy },
      });
      throw new CavtoolsExecError("SECURITY_NETWORK_BLOCKED", "Execution policy blocks network commands for this project.", 403);
    }
  }

  await writeSecurityAudit(ctx, {
    action: `execution.${args.scope}`,
    resource,
    decision: "allow",
    metadata: {
      profile: policy.profile,
      sandboxMode: policy.sandboxMode,
      networkPolicy: policy.networkPolicy,
      command,
    },
  });
  return policy;
}

function normalizeSecretAlias(aliasRaw: string): string {
  const alias = s(aliasRaw)
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!alias) throw new CavtoolsExecError("SECRET_ALIAS_INVALID", "Secret alias is required.", 400);
  if (alias.length > 64) throw new CavtoolsExecError("SECRET_ALIAS_INVALID", "Secret alias must be at most 64 characters.", 400);
  return alias;
}

async function upsertSecretBrokerValue(
  ctx: ExecContext,
  aliasRaw: string,
  secretValue: string,
  scopes: string[]
): Promise<void> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for secrets.", 400);
  const alias = normalizeSecretAlias(aliasRaw);
  const value = String(secretValue || "");
  if (!value) throw new CavtoolsExecError("SECRET_VALUE_REQUIRED", "Secret value cannot be empty.", 400);
  const encrypted = await encryptAesGcmB64(value);
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeSecretBroker" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "alias",
        "valueEnc",
        "valueIv",
        "scopes",
        "policy"
      ) VALUES (
        ${`secret_${crypto.randomUUID()}`},
        ${ctx.accountId},
        ${ctx.project.id},
        ${ctx.userId},
        ${alias},
        ${encrypted.encB64},
        ${encrypted.ivB64},
        CAST(${JSON.stringify(scopes.map((item) => s(item).toLowerCase()).filter(Boolean))} AS jsonb),
        '{}'::jsonb
      )
      ON CONFLICT ("accountId", "projectId", "alias")
      DO UPDATE SET
        "valueEnc" = EXCLUDED."valueEnc",
        "valueIv" = EXCLUDED."valueIv",
        "scopes" = EXCLUDED."scopes",
        "userId" = EXCLUDED."userId",
        "revokedAt" = NULL,
        "rotatedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
    `
  );
}

async function listSecretBrokerValues(
  ctx: ExecContext,
  opts?: { includeValue?: boolean; scope?: SecurityExecutionScope | null }
): Promise<Array<Record<string, unknown>>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for secrets.", 400);
  await ensureCavcodeInfraTables();
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "alias",
        "valueEnc",
        "valueIv",
        "scopes",
        "createdAt",
        "updatedAt",
        "rotatedAt",
        "revokedAt"
      FROM "CavCodeSecretBroker"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
      ORDER BY "alias" ASC
    `
  );
  const out: Array<Record<string, unknown>> = [];
  for (const row of rows) {
    const alias = normalizeSecretAlias(s(row.alias || ""));
    const revokedAt = row.revokedAt instanceof Date ? row.revokedAt.toISOString() : (s(row.revokedAt || "") || null);
    const scopes = jsonStringArray(row.scopes).map((item) => item.toLowerCase());
    const inScope = opts?.scope ? scopes.includes("*") || scopes.includes(opts.scope) : true;
    if (!inScope) continue;
    if (revokedAt) continue;
    let value: string | null = null;
    if (opts?.includeValue) {
      value = await decryptAesGcm({
        enc: s(row.valueEnc || ""),
        iv: s(row.valueIv || ""),
      }).catch(() => "");
    }
    out.push({
      alias,
      scopes,
      createdAtISO: row.createdAt instanceof Date ? row.createdAt.toISOString() : s(row.createdAt || ""),
      updatedAtISO: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : s(row.updatedAt || ""),
      rotatedAtISO: row.rotatedAt instanceof Date ? row.rotatedAt.toISOString() : (s(row.rotatedAt || "") || null),
      revokedAtISO: revokedAt,
      value,
    });
  }
  return out;
}

async function revokeSecretBrokerValue(ctx: ExecContext, aliasRaw: string): Promise<boolean> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for secrets.", 400);
  const alias = normalizeSecretAlias(aliasRaw);
  await ensureCavcodeInfraTables();
  const result = await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "CavCodeSecretBroker"
      SET
        "revokedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "alias" = ${alias}
        AND "revokedAt" IS NULL
    `
  );
  return Number(result) > 0;
}

async function resolveSecretEnvForScope(
  ctx: ExecContext,
  scope: SecurityExecutionScope
): Promise<Record<string, string>> {
  const rows = await listSecretBrokerValues(ctx, { includeValue: true, scope });
  const env: Record<string, string> = {};
  for (const row of rows) {
    const alias = normalizeSecretAlias(s(row.alias || ""));
    const value = String(row.value || "");
    if (!value) continue;
    env[`CAV_SECRET_${alias}`] = value;
  }
  return env;
}

type QuarantineFinding = {
  file: string;
  line: number;
  severity: "high" | "medium";
  rule: string;
  excerpt: string;
};

function evaluateQuarantineFile(pathRel: string, text: string): QuarantineFinding[] {
  const findings: QuarantineFinding[] = [];
  const lines = String(text || "").split("\n");
  const rules: Array<{ id: string; severity: "high" | "medium"; re: RegExp }> = [
    { id: "shell_pipe_exec", severity: "high", re: /\b(curl|wget)\b[^\n|]{0,220}\|\s*(bash|sh)\b/i },
    { id: "rm_root_force", severity: "high", re: /\brm\s+-rf\s+\/(\s|$)/i },
    { id: "disk_wipe", severity: "high", re: /\bdd\s+if=\/dev\/(zero|random)\b/i },
    { id: "crypto_miner", severity: "medium", re: /\b(stratum\+tcp|xmrig|minerd|cryptonight)\b/i },
    { id: "secrets_plaintext", severity: "medium", re: /\b(AWS_SECRET_ACCESS_KEY|BEGIN RSA PRIVATE KEY|BEGIN OPENSSH PRIVATE KEY)\b/i },
  ];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    for (const rule of rules) {
      if (!rule.re.test(line)) continue;
      findings.push({
        file: normalizePath(`/cavcode/${pathRel}`),
        line: i + 1,
        severity: rule.severity,
        rule: rule.id,
        excerpt: line.slice(0, 240),
      });
    }
  }
  return findings;
}

async function runQuarantineScanForWorkspace(args: {
  ctx: ExecContext;
  workspaceDir: string;
  targetKind: string;
  targetPath: string;
  engine?: string;
}): Promise<{
  scanId: string;
  status: string;
  verdict: "pass" | "warn" | "blocked";
  findings: QuarantineFinding[];
}> {
  if (!args.ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for quarantine scan.", 400);
  await ensureCavcodeInfraTables();
  const scanId = `scan_${crypto.randomUUID()}`;
  const findings: QuarantineFinding[] = [];
  const files = await collectLocalWorkspaceFiles(args.workspaceDir).catch(() => []);
  const maxFiles = Math.min(files.length, 1400);
  for (let i = 0; i < maxFiles; i += 1) {
    const rel = files[i];
    if (rel.startsWith("node_modules/") || rel.startsWith(".git/")) continue;
    const lower = rel.toLowerCase();
    if (!/\.(js|jsx|ts|tsx|mjs|cjs|sh|bash|zsh|env|py|rb|php|go|rs|yaml|yml|json|toml|ini|sql|md|txt)$/.test(lower)) continue;
    const abs = path.join(args.workspaceDir, rel);
    let content = "";
    try {
      const stats = await stat(abs);
      if (stats.size > 256 * 1024) continue;
      content = await readFile(abs, "utf8");
    } catch {
      continue;
    }
    findings.push(...evaluateQuarantineFile(rel, content));
    if (findings.length >= 220) break;
  }
  const highCount = findings.filter((row) => row.severity === "high").length;
  const verdict: "pass" | "warn" | "blocked" = highCount > 0 ? "blocked" : findings.length > 0 ? "warn" : "pass";
  const now = nowISO();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeQuarantineScan" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "targetKind",
        "targetPath",
        "targetHash",
        "engine",
        "status",
        "verdict",
        "findings",
        "metadata",
        "finishedAt"
      ) VALUES (
        ${scanId},
        ${args.ctx.accountId},
        ${args.ctx.project.id},
        ${args.ctx.userId},
        ${s(args.targetKind) || "workspace"},
        ${s(args.targetPath) || "/cavcode"},
        ${hashCommandId(`${args.ctx.accountId}:${args.ctx.project.id}:${args.targetPath}`, now)},
        ${s(args.engine || "cavscan-v1")},
        ${"finished"},
        ${verdict},
        CAST(${JSON.stringify(findings)} AS jsonb),
        CAST(${JSON.stringify({
          scannedFiles: maxFiles,
          findings: findings.length,
          highFindings: highCount,
          generatedAtISO: now,
        })} AS jsonb),
        CURRENT_TIMESTAMP
      )
    `
  );
  await writeSecurityAudit(args.ctx, {
    action: "security.quarantine.scan",
    resource: s(args.targetPath) || "/cavcode",
    decision: verdict === "blocked" ? "deny" : verdict === "warn" ? "warn" : "allow",
    reason: verdict === "blocked" ? "High severity finding detected." : null,
    metadata: {
      scanId,
      verdict,
      findings: findings.length,
      highFindings: highCount,
    },
  });
  return {
    scanId,
    status: "finished",
    verdict,
    findings,
  };
}

function extensionSigningSecret(): string {
  const secret = s(process.env.CAVCODE_EXTENSION_SIGNING_SECRET || process.env.CAVBOT_KEY_ENC_SECRET || "");
  if (!secret) throw new CavtoolsExecError("EXTENSION_SIGNING_SECRET_MISSING", "Extension signing secret is not configured.", 500);
  return secret;
}

function extensionCanonicalManifest(manifest: Record<string, unknown>): string {
  const stable = {
    name: s(manifest.name || manifest.extensionId || ""),
    displayName: s(manifest.displayName || manifest.name || ""),
    version: s(manifest.version || ""),
    publisher: s(manifest.publisher || ""),
    description: s(manifest.description || ""),
    main: s(manifest.main || ""),
    activationEvents: jsonStringArray(manifest.activationEvents).sort(),
    permissions: jsonStringArray(manifest.permissions).sort(),
    contributes: asRecord(manifest.contributes) || {},
    engines: asRecord(manifest.engines) || {},
  };
  return JSON.stringify(stable);
}

function extensionComputeSignature(extensionId: string, version: string, manifest: Record<string, unknown>): string {
  const h = crypto.createHmac("sha256", extensionSigningSecret());
  h.update(s(extensionId));
  h.update("@");
  h.update(s(version));
  h.update("\n");
  h.update(extensionCanonicalManifest(manifest));
  return h.digest("hex");
}

function parseExtensionRef(rawRef: string): { extensionId: string; version: string | null } {
  const ref = s(rawRef || "");
  if (!ref) throw new CavtoolsExecError("EXTENSION_REF_REQUIRED", "Extension id is required.", 400);
  const at = ref.lastIndexOf("@");
  if (at > 0 && at < ref.length - 1) {
    return {
      extensionId: s(ref.slice(0, at)),
      version: s(ref.slice(at + 1)),
    };
  }
  return {
    extensionId: ref,
    version: null,
  };
}

function extensionPermissionsFromManifest(manifest: Record<string, unknown>): string[] {
  const direct = jsonStringArray(manifest.permissions).map((item) => item.toLowerCase());
  const fromCap = jsonStringArray(asRecord(manifest.capabilities)?.permissions).map((item) => item.toLowerCase());
  const merged = Array.from(new Set([...direct, ...fromCap])).filter(Boolean);
  return merged.sort();
}

function extensionActivationEventsFromManifest(manifest: Record<string, unknown>): string[] {
  const events = jsonStringArray(manifest.activationEvents)
    .map((item) => item.toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(events)).sort();
}

function extensionApiSurfaceFromPermission(permission: string): string[] {
  const p = s(permission).toLowerCase();
  if (!p) return [];
  if (p.includes("workspace.write")) return ["workspace.read", "workspace.write"];
  if (p.includes("workspace.read")) return ["workspace.read"];
  if (p.includes("diagnostics")) return ["diagnostics.read"];
  if (p.includes("terminal")) return ["terminal.exec", "terminal.logs"];
  if (p.includes("scm") || p.includes("git")) return ["scm.status", "scm.diff", "scm.stage", "scm.commit"];
  if (p.includes("debug")) return ["debug.status", "debug.control"];
  if (p.includes("network")) return ["network.fetch"];
  if (p.includes("secrets")) return ["secrets.read"];
  return [p];
}

function extensionPermissionAllowedByPolicy(permission: string, policy: CavcodeExecutionPolicyRecord): boolean {
  const p = s(permission).toLowerCase();
  if (!p) return false;
  if (policy.networkPolicy === "deny" && p.includes("network")) return false;
  if (policy.sandboxMode === "restricted" && (p.includes("terminal") || p.includes("debug.control"))) return false;
  return true;
}

async function listExtensionMarketplaceEntries(args?: {
  extensionId?: string | null;
  status?: string | null;
}): Promise<Array<Record<string, unknown>>> {
  await ensureCavcodeInfraTables();
  const extensionId = s(args?.extensionId || "");
  const status = s(args?.status || "");
  const whereParts: Prisma.Sql[] = [];
  if (extensionId) whereParts.push(Prisma.sql`"extensionId" = ${extensionId}`);
  if (status) whereParts.push(Prisma.sql`"status" = ${status}`);
  const whereSql = whereParts.length
    ? Prisma.sql`WHERE ${Prisma.join(whereParts, " AND ")}`
    : Prisma.sql``;
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "id",
        "extensionId",
        "version",
        "publisher",
        "manifest",
        "activationEvents",
        "permissions",
        "signature",
        "signatureAlgo",
        "packageUrl",
        "status",
        "createdAt",
        "updatedAt"
      FROM "CavCodeExtensionMarketplace"
      ${whereSql}
      ORDER BY "extensionId" ASC, "updatedAt" DESC
      LIMIT 400
    `
  );
  return rows;
}

function semverLikeCompare(aRaw: string, bRaw: string): number {
  const a = s(aRaw);
  const b = s(bRaw);
  if (a === b) return 0;
  const parse = (value: string) => value.split(/[.-]/g).map((chunk) => {
    const n = Number(chunk);
    return Number.isFinite(n) ? n : chunk;
  });
  const pa = parse(a);
  const pb = parse(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i];
    const vb = pb[i];
    if (va === undefined && vb === undefined) break;
    if (va === undefined) return -1;
    if (vb === undefined) return 1;
    if (typeof va === "number" && typeof vb === "number") {
      if (va !== vb) return va > vb ? 1 : -1;
      continue;
    }
    const sa = String(va);
    const sb = String(vb);
    if (sa !== sb) return sa > sb ? 1 : -1;
  }
  return a > b ? 1 : -1;
}

async function resolveMarketplaceExtensionVersion(extensionIdRaw: string, versionRaw?: string | null): Promise<Record<string, unknown> | null> {
  const extensionId = s(extensionIdRaw || "");
  if (!extensionId) return null;
  const version = s(versionRaw || "");
  const rows = await listExtensionMarketplaceEntries({ extensionId, status: "active" });
  if (!rows.length) return null;
  if (version) {
    return rows.find((row) => s(row.version || "") === version) || null;
  }
  const sorted = [...rows].sort((a, b) => semverLikeCompare(s(b.version || ""), s(a.version || "")));
  return sorted[0] || null;
}

async function verifyMarketplaceExtensionSignature(row: Record<string, unknown>): Promise<boolean> {
  const extensionId = s(row.extensionId || "");
  const version = s(row.version || "");
  const manifest = asRecord(row.manifest) || {};
  const signature = s(row.signature || "");
  if (!extensionId || !version || !signature) return false;
  const computed = extensionComputeSignature(extensionId, version, manifest);
  return computed === signature;
}

function toExtensionInstallRecord(row: Record<string, unknown>): ExtensionInstallRecord {
  return {
    extensionId: s(row.extensionId || ""),
    version: s(row.version || ""),
    enabled: row.enabled !== false,
    runtimeStatus: s(row.runtimeStatus || "installed"),
    requestedPermissions: jsonStringArray(row.requestedPermissions).map((item) => item.toLowerCase()),
    grantedPermissions: jsonStringArray(row.grantedPermissions).map((item) => item.toLowerCase()),
    activationEvents: jsonStringArray(row.activationEvents).map((item) => item.toLowerCase()),
    activationCount: Math.max(0, Math.trunc(Number(row.activationCount || 0)) || 0),
    lastActivatedAtISO: row.lastActivatedAt instanceof Date ? row.lastActivatedAt.toISOString() : (s(row.lastActivatedAt || "") || null),
    installedAtISO: row.installedAt instanceof Date ? row.installedAt.toISOString() : (s(row.installedAt || "") || nowISO()),
    updatedAtISO: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : (s(row.updatedAt || "") || nowISO()),
  };
}

async function readInstalledExtensions(ctx: ExecContext): Promise<ExtensionInstallRecord[]> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for extensions.", 400);
  await ensureCavcodeInfraTables();
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "extensionId",
        "version",
        "enabled",
        "runtimeStatus",
        "requestedPermissions",
        "grantedPermissions",
        "activationEvents",
        "activationCount",
        "lastActivatedAt",
        "installedAt",
        "updatedAt"
      FROM "CavCodeExtensionInstall"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
      ORDER BY "extensionId" ASC
      LIMIT 400
    `
  );
  return rows.map((row) => toExtensionInstallRecord(row));
}

async function upsertExtensionInstallRow(
  ctx: ExecContext,
  args: {
    extensionId: string;
    version: string;
    enabled: boolean;
    runtimeStatus?: string;
    requestedPermissions: string[];
    grantedPermissions: string[];
    activationEvents: string[];
  }
): Promise<ExtensionInstallRecord> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for extensions.", 400);
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeExtensionInstall" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "extensionId",
        "version",
        "enabled",
        "runtimeStatus",
        "requestedPermissions",
        "grantedPermissions",
        "activationEvents"
      ) VALUES (
        ${`extinst_${crypto.randomUUID()}`},
        ${ctx.accountId},
        ${ctx.project.id},
        ${ctx.userId},
        ${s(args.extensionId)},
        ${s(args.version)},
        ${args.enabled},
        ${s(args.runtimeStatus || "installed") || "installed"},
        CAST(${JSON.stringify(args.requestedPermissions.map((item) => s(item).toLowerCase()).filter(Boolean))} AS jsonb),
        CAST(${JSON.stringify(args.grantedPermissions.map((item) => s(item).toLowerCase()).filter(Boolean))} AS jsonb),
        CAST(${JSON.stringify(args.activationEvents.map((item) => s(item).toLowerCase()).filter(Boolean))} AS jsonb)
      )
      ON CONFLICT ("accountId", "projectId", "extensionId")
      DO UPDATE SET
        "version" = EXCLUDED."version",
        "enabled" = EXCLUDED."enabled",
        "runtimeStatus" = EXCLUDED."runtimeStatus",
        "requestedPermissions" = EXCLUDED."requestedPermissions",
        "grantedPermissions" = EXCLUDED."grantedPermissions",
        "activationEvents" = EXCLUDED."activationEvents",
        "updatedAt" = CURRENT_TIMESTAMP
    `
  );
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "extensionId",
        "version",
        "enabled",
        "runtimeStatus",
        "requestedPermissions",
        "grantedPermissions",
        "activationEvents",
        "activationCount",
        "lastActivatedAt",
        "installedAt",
        "updatedAt"
      FROM "CavCodeExtensionInstall"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "extensionId" = ${s(args.extensionId)}
      LIMIT 1
    `
  );
  const row = rows[0];
  if (!row) throw new CavtoolsExecError("EXTENSION_INSTALL_FAILED", "Failed to upsert extension install.", 500);
  return toExtensionInstallRecord(row);
}

async function removeExtensionInstallRow(ctx: ExecContext, extensionIdRaw: string): Promise<boolean> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for extensions.", 400);
  const extensionId = s(extensionIdRaw || "");
  if (!extensionId) return false;
  await ensureCavcodeInfraTables();
  const result = await prisma.$executeRaw(
    Prisma.sql`
      DELETE FROM "CavCodeExtensionInstall"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "extensionId" = ${extensionId}
    `
  );
  return Number(result) > 0;
}

async function setExtensionEnabledState(ctx: ExecContext, extensionIdRaw: string, enabled: boolean): Promise<boolean> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for extensions.", 400);
  const extensionId = s(extensionIdRaw || "");
  if (!extensionId) return false;
  await ensureCavcodeInfraTables();
  const result = await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "CavCodeExtensionInstall"
      SET
        "enabled" = ${enabled},
        "runtimeStatus" = ${enabled ? "installed" : "disabled"},
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "extensionId" = ${extensionId}
    `
  );
  return Number(result) > 0;
}

async function touchExtensionActivation(ctx: ExecContext, extensionIdRaw: string): Promise<void> {
  if (!ctx.project?.id) return;
  const extensionId = s(extensionIdRaw || "");
  if (!extensionId) return;
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "CavCodeExtensionInstall"
      SET
        "activationCount" = "activationCount" + 1,
        "lastActivatedAt" = CURRENT_TIMESTAMP,
        "runtimeStatus" = 'active',
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "extensionId" = ${extensionId}
    `
  );
}

function clampExtensionHostLine(input: string): string {
  const text = String(input || "").replace(/\r/g, "").trimEnd();
  if (!text) return "";
  return text.length > MAX_EXTENSION_HOST_LOG_LINE_CHARS ? `${text.slice(0, MAX_EXTENSION_HOST_LOG_LINE_CHARS)}…` : text;
}

function pushExtensionHostLogLine(session: ExtensionHostSession, stream: ExtensionHostLogStream, line: string) {
  const text = clampExtensionHostLine(line);
  if (!text && stream !== "system") return;
  const seq = session.nextSeq + 1;
  session.nextSeq = seq;
  session.updatedAtMs = Date.now();
  session.logs.push({
    seq,
    atISO: nowISO(),
    stream,
    text: text || "(system)",
  });
  if (session.logs.length > MAX_EXTENSION_HOST_LOG_LINES) {
    session.logs.splice(0, session.logs.length - MAX_EXTENSION_HOST_LOG_LINES);
    session.logTruncated = true;
  }
}

function extensionHostSessionView(session: ExtensionHostSession) {
  return {
    type: "cav_extension_host_status_v1",
    sessionId: session.id,
    projectId: session.projectId,
    status: session.status,
    sandboxProfile: session.sandboxProfile,
    apiSurface: session.apiSurface,
    extensionCount: session.extensions.length,
    activatedExtensions: session.activatedExtensions,
    createdAtISO: new Date(session.createdAtMs).toISOString(),
    updatedAtISO: new Date(session.updatedAtMs).toISOString(),
    nextSeq: session.nextSeq,
    logTruncated: session.logTruncated,
    extensions: session.extensions,
  };
}

function readExtensionHostLogs(session: ExtensionHostSession, afterSeq: number) {
  const after = Number.isFinite(Number(afterSeq)) ? Math.max(0, Math.trunc(Number(afterSeq))) : 0;
  const entries = session.logs.filter((row) => row.seq > after).slice(0, 220);
  const nextSeq = entries.length ? entries[entries.length - 1].seq : after;
  return {
    type: "cav_extension_host_logs_v1",
    sessionId: session.id,
    status: session.status,
    nextSeq,
    logTruncated: session.logTruncated,
    entries,
  };
}

async function persistExtensionHostSessionSnapshot(session: ExtensionHostSession): Promise<void> {
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeExtensionHostSession" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "status",
        "sandboxProfile",
        "apiSurface",
        "extensions",
        "activatedExtensions",
        "logs"
      ) VALUES (
        ${session.id},
        ${session.accountId},
        ${session.projectId},
        ${session.userId},
        ${session.status},
        ${session.sandboxProfile},
        CAST(${JSON.stringify(session.apiSurface)} AS jsonb),
        CAST(${JSON.stringify(session.extensions)} AS jsonb),
        CAST(${JSON.stringify(session.activatedExtensions)} AS jsonb),
        CAST(${JSON.stringify(session.logs.slice(-200))} AS jsonb)
      )
      ON CONFLICT ("id")
      DO UPDATE SET
        "status" = EXCLUDED."status",
        "sandboxProfile" = EXCLUDED."sandboxProfile",
        "apiSurface" = EXCLUDED."apiSurface",
        "extensions" = EXCLUDED."extensions",
        "activatedExtensions" = EXCLUDED."activatedExtensions",
        "logs" = EXCLUDED."logs",
        "updatedAt" = CURRENT_TIMESTAMP,
        "stoppedAt" = CASE WHEN EXCLUDED."status" = 'stopped' THEN CURRENT_TIMESTAMP ELSE NULL END
    `
  );
}

async function cleanupExtensionHostSessions() {
  const now = Date.now();
  const staleIds: string[] = [];
  for (const [id, session] of extensionHostSessions.entries()) {
    if (sessionActive(session.status)) continue;
    if (now - session.updatedAtMs < EXTENSION_HOST_SESSION_RETENTION_MS) continue;
    staleIds.push(id);
  }
  for (const id of staleIds) {
    const session = extensionHostSessions.get(id);
    if (!session) continue;
    extensionHostSessions.delete(id);
    const active = extensionHostSessionByProject.get(session.key);
    if (active === id) extensionHostSessionByProject.delete(session.key);
  }
}

function assertExtensionHostSessionAccess(ctx: ExecContext, sessionId: string): ExtensionHostSession {
  const session = extensionHostSessions.get(sessionId);
  if (!session) throw new CavtoolsExecError("EXTENSION_HOST_NOT_FOUND", `Extension host session not found: ${sessionId}`, 404);
  if (session.accountId !== ctx.accountId || session.userId !== ctx.userId) {
    throw new CavtoolsExecError("UNAUTHORIZED", "Extension host session is not accessible for this operator.", 403, "ROLE_BLOCKED");
  }
  return session;
}

async function stopExtensionHostSession(session: ExtensionHostSession, reason = "Extension host stopped by operator.") {
  session.stopRequested = true;
  session.status = "stopped";
  pushExtensionHostLogLine(session, "system", reason);
  await persistExtensionHostSessionSnapshot(session).catch(() => {});
  const actor = reliabilityActorFromSession(session);
  if (actor) {
    await writeReliabilitySnapshot(actor, {
      kind: "extension-host",
      scopeId: session.id,
      status: session.status,
      payload: extensionHostSessionView(session),
    }).catch(() => {});
    await writeDeterministicReplay(actor, {
      category: "extension-host",
      sessionId: session.id,
      action: "extension.host.stop",
      payload: {
        reason,
        status: session.status,
      },
    }).catch(() => {});
  }
}

async function startExtensionHostSession(ctx: ExecContext, opts?: { stopExisting?: boolean }): Promise<ExtensionHostSession> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for extension host.", 400);
  await cleanupExtensionHostSessions();
  const policy = await assertExecutionAllowed(ctx, {
    scope: "extension-host",
    command: "extension-host start",
    resource: "extension-host",
  });
  const key = runtimeProjectKey(ctx.accountId, ctx.project.id);
  const activeId = extensionHostSessionByProject.get(key);
  if (activeId && opts?.stopExisting !== false) {
    const existing = extensionHostSessions.get(activeId);
    if (existing && sessionActive(existing.status)) {
      await stopExtensionHostSession(existing, "Stopped previous extension host session.");
    }
  }
  const installed = (await readInstalledExtensions(ctx)).filter((row) => row.enabled);
  const apiSurface = Array.from(new Set(installed.flatMap((row) => row.grantedPermissions.flatMap((perm) => extensionApiSurfaceFromPermission(perm))))).sort();
  const sessionId = `exthost_${hashCommandId(`${ctx.accountId}:${ctx.userId}:${ctx.project.id}:${Date.now()}`, "/cavcode")}`;
  const session: ExtensionHostSession = {
    id: sessionId,
    key,
    accountId: ctx.accountId,
    userId: ctx.userId,
    projectId: ctx.project.id,
    status: "running",
    sandboxProfile: policy.sandboxMode,
    apiSurface,
    extensions: installed,
    activatedExtensions: [],
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    stopRequested: false,
    nextSeq: 0,
    logTruncated: false,
    logs: [],
  };
  pushExtensionHostLogLine(session, "system", `Extension host started with ${installed.length} extension(s).`);
  if (!installed.length) {
    pushExtensionHostLogLine(session, "system", "No installed extensions are enabled.");
  } else {
    pushExtensionHostLogLine(session, "system", `API surface: ${apiSurface.join(", ") || "(none)"}`);
  }
  extensionHostSessions.set(session.id, session);
  extensionHostSessionByProject.set(key, session.id);
  await persistExtensionHostSessionSnapshot(session).catch(() => {});
  await recordReliabilitySnapshot(ctx, {
    kind: "extension-host",
    scopeId: session.id,
    status: session.status,
    payload: extensionHostSessionView(session),
  }).catch(() => {});
  await recordDeterministicReplay(ctx, {
    category: "extension-host",
    sessionId: session.id,
    action: "extension.host.start",
    payload: extensionHostSessionView(session),
  }).catch(() => {});
  await publishCavcodeEvent(ctx, "extension.host.start", {
    sessionId: session.id,
    extensionCount: installed.length,
    sandboxProfile: session.sandboxProfile,
  });
  return session;
}

async function activateExtensionsForEvent(
  ctx: ExecContext,
  eventNameRaw: string,
  context?: Record<string, unknown> | null
): Promise<{ activated: string[]; session: ExtensionHostSession | null }> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for extension activation.", 400);
  const eventName = s(eventNameRaw || "").toLowerCase();
  if (!eventName) throw new CavtoolsExecError("EXTENSION_ACTIVATE_USAGE", "Activation event is required.", 400);
  await cleanupExtensionHostSessions();
  const key = runtimeProjectKey(ctx.accountId, ctx.project.id);
  const activeId = extensionHostSessionByProject.get(key);
  let session = activeId ? extensionHostSessions.get(activeId) || null : null;
  if (!session || !sessionActive(session.status)) {
    session = await startExtensionHostSession(ctx, { stopExisting: true });
  }
  const activated: string[] = [];
  for (const extension of session.extensions) {
    if (!extension.enabled) continue;
    const events = extension.activationEvents.map((item) => s(item).toLowerCase());
    if (!events.includes("*") && !events.includes(eventName)) continue;
    if (!session.activatedExtensions.includes(extension.extensionId)) {
      session.activatedExtensions.push(extension.extensionId);
    }
    activated.push(extension.extensionId);
    await touchExtensionActivation(ctx, extension.extensionId).catch(() => {});
  }
  session.updatedAtMs = Date.now();
  pushExtensionHostLogLine(
    session,
    "system",
    `Activation event "${eventName}" -> ${activated.length} extension(s): ${activated.join(", ") || "(none)"}`
  );
  await persistExtensionHostSessionSnapshot(session).catch(() => {});
  await publishCavcodeEvent(ctx, "extension.activate", {
    sessionId: session.id,
    eventName,
    activated,
    context: context && typeof context === "object" ? context : {},
  });
  return { activated, session };
}

function parseCollabProtocol(value: string): CollabProtocol {
  return s(value).toLowerCase() === "crdt" ? "crdt" : "ot";
}

function normalizeCollabDocumentPath(pathRaw: string): string {
  const normalized = normalizePath(s(pathRaw || ""));
  if (!normalized.startsWith("/cavcode/")) {
    throw new CavtoolsExecError("COLLAB_DOC_SCOPE", "Collaboration documents must be under /cavcode.", 400);
  }
  return normalized;
}

function colorForUser(userId: string): string {
  const hash = crypto.createHash("sha1").update(s(userId)).digest("hex");
  const hue = Number.parseInt(hash.slice(0, 2), 16) % 360;
  return `hsl(${hue} 70% 55%)`;
}

async function readCollabSessionById(ctx: ExecContext, sessionId: string): Promise<Record<string, unknown> | null> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for collaboration.", 400);
  await ensureCavcodeInfraTables();
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "id",
        "documentPath",
        "protocol",
        "status",
        "baseVersion",
        "vectorClock",
        "metadata",
        "createdBy",
        "createdAt",
        "updatedAt",
        "endedAt"
      FROM "CavCodeCollabSession"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "id" = ${s(sessionId)}
      LIMIT 1
    `
  );
  return asRecord(rows[0]);
}

async function listCollabSessions(ctx: ExecContext): Promise<Array<Record<string, unknown>>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for collaboration.", 400);
  await ensureCavcodeInfraTables();
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "id",
        "documentPath",
        "protocol",
        "status",
        "baseVersion",
        "vectorClock",
        "metadata",
        "createdBy",
        "createdAt",
        "updatedAt",
        "endedAt"
      FROM "CavCodeCollabSession"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
      ORDER BY "updatedAt" DESC
      LIMIT 200
    `
  );
  return rows;
}

function collabSessionView(row: Record<string, unknown>): Record<string, unknown> {
  const metadata = asRecord(row.metadata) || {};
  const documentState = asRecord(metadata.documentState);
  return {
    sessionId: s(row.id || ""),
    documentPath: s(row.documentPath || ""),
    protocol: parseCollabProtocol(s(row.protocol || "ot")),
    status: s(row.status || "active"),
    baseVersion: Math.max(0, Number(row.baseVersion || 0)),
    vectorClock: asRecord(row.vectorClock) || {},
    createdBy: s(row.createdBy || ""),
    createdAtISO: row.createdAt instanceof Date ? row.createdAt.toISOString() : s(row.createdAt || ""),
    updatedAtISO: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : s(row.updatedAt || ""),
    endedAtISO: row.endedAt instanceof Date ? row.endedAt.toISOString() : (s(row.endedAt || "") || null),
    documentState: {
      length: Math.max(0, Math.trunc(Number(documentState?.length || 0)) || 0),
      hash: s(documentState?.hash || ""),
      updatedAtISO: s(documentState?.updatedAtISO || ""),
    },
  };
}

async function createCollabSession(
  ctx: ExecContext,
  args: {
    documentPath: string;
    protocol: CollabProtocol;
    metadata?: Record<string, unknown> | null;
  }
): Promise<Record<string, unknown>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for collaboration.", 400);
  await ensureCavcodeInfraTables();
  const documentPath = normalizeCollabDocumentPath(args.documentPath);
  const existingRows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "id",
        "documentPath",
        "protocol",
        "status",
        "baseVersion",
        "vectorClock",
        "metadata",
        "createdBy",
        "createdAt",
        "updatedAt",
        "endedAt"
      FROM "CavCodeCollabSession"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "documentPath" = ${documentPath}
        AND "status" = 'active'
      ORDER BY "updatedAt" DESC
      LIMIT 1
    `
  );
  const existing = asRecord(existingRows[0]);
  if (existing) return existing;
  const sessionId = `collab_${crypto.randomUUID()}`;
  const metadata = {
    ...(args.metadata && typeof args.metadata === "object" ? args.metadata : {}),
    documentState: {
      text: "",
      length: 0,
      hash: hashCommandId(`${ctx.accountId}:${ctx.project?.id}:${documentPath}:empty`, "/cavcode"),
      updatedAtISO: nowISO(),
    },
  };
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeCollabSession" (
        "id",
        "accountId",
        "projectId",
        "documentPath",
        "protocol",
        "status",
        "baseVersion",
        "vectorClock",
        "metadata",
        "createdBy"
      ) VALUES (
        ${sessionId},
        ${ctx.accountId},
        ${ctx.project.id},
        ${documentPath},
        ${args.protocol},
        ${"active"},
        ${0},
        '{}'::jsonb,
        CAST(${JSON.stringify(metadata)} AS jsonb),
        ${ctx.userId}
      )
    `
  );
  const created = await readCollabSessionById(ctx, sessionId);
  if (!created) throw new CavtoolsExecError("COLLAB_SESSION_CREATE_FAILED", "Failed to create collaboration session.", 500);
  await publishCavcodeEvent(ctx, "collab.session.start", {
    sessionId,
    documentPath,
    protocol: args.protocol,
  });
  return created;
}

async function setCollabPresence(
  ctx: ExecContext,
  args: {
    sessionId: string;
    activeFile?: string | null;
    cursor?: Record<string, unknown> | null;
    selection?: Record<string, unknown> | null;
    sharedPanels?: string[];
  }
): Promise<Record<string, unknown>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for collaboration.", 400);
  const session = await readCollabSessionById(ctx, args.sessionId);
  if (!session) throw new CavtoolsExecError("COLLAB_SESSION_NOT_FOUND", `Collaboration session not found: ${args.sessionId}`, 404);
  if (s(session.status || "active") !== "active") {
    throw new CavtoolsExecError("COLLAB_SESSION_CLOSED", "Collaboration session is not active.", 409);
  }
  const activeFile = args.activeFile ? normalizePath(args.activeFile) : null;
  const sharedPanels = Array.from(new Set((args.sharedPanels || []).map((item) => s(item).toLowerCase()).filter(Boolean)));
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeCollabPresence" (
        "id",
        "sessionId",
        "accountId",
        "projectId",
        "userId",
        "displayName",
        "color",
        "activeFile",
        "cursor",
        "selection",
        "sharedPanels",
        "lastHeartbeatAt"
      ) VALUES (
        ${`presence_${crypto.randomUUID()}`},
        ${s(args.sessionId)},
        ${ctx.accountId},
        ${ctx.project.id},
        ${ctx.userId},
        ${ctx.userId},
        ${colorForUser(ctx.userId)},
        ${activeFile},
        CAST(${JSON.stringify(args.cursor && typeof args.cursor === "object" ? args.cursor : {})} AS jsonb),
        CAST(${JSON.stringify(args.selection && typeof args.selection === "object" ? args.selection : {})} AS jsonb),
        CAST(${JSON.stringify(sharedPanels)} AS jsonb),
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("sessionId", "userId")
      DO UPDATE SET
        "activeFile" = EXCLUDED."activeFile",
        "cursor" = EXCLUDED."cursor",
        "selection" = EXCLUDED."selection",
        "sharedPanels" = EXCLUDED."sharedPanels",
        "lastHeartbeatAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
    `
  );
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "sessionId",
        "userId",
        "displayName",
        "color",
        "activeFile",
        "cursor",
        "selection",
        "sharedPanels",
        "lastHeartbeatAt",
        "updatedAt"
      FROM "CavCodeCollabPresence"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "sessionId" = ${s(args.sessionId)}
        AND "userId" = ${ctx.userId}
      LIMIT 1
    `
  );
  const presence = asRecord(rows[0]) || {};
  await publishCavcodeEvent(ctx, "collab.presence", {
    sessionId: s(args.sessionId),
    userId: ctx.userId,
    activeFile,
    cursor: args.cursor || {},
    selection: args.selection || {},
    sharedPanels,
  });
  return presence;
}

async function listCollabPresence(ctx: ExecContext, sessionId: string): Promise<Array<Record<string, unknown>>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for collaboration.", 400);
  await ensureCavcodeInfraTables();
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "sessionId",
        "userId",
        "displayName",
        "color",
        "activeFile",
        "cursor",
        "selection",
        "sharedPanels",
        "lastHeartbeatAt",
        "updatedAt"
      FROM "CavCodeCollabPresence"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "sessionId" = ${s(sessionId)}
      ORDER BY "updatedAt" DESC
      LIMIT 120
    `
  );
  return rows;
}

function applyCollabTextOperation(
  currentText: string,
  op: CollabTextOperation
): { nextText: string; applied: CollabTextOperation } {
  const source = String(currentText || "");
  const idx = Math.max(0, Math.min(source.length, Math.trunc(Number(op.index || 0)) || 0));
  const len = Math.max(0, Math.min(source.length - idx, Math.trunc(Number(op.length || 0)) || 0));
  const text = String(op.text || "");
  if (op.kind === "insert") {
    return {
      nextText: `${source.slice(0, idx)}${text}${source.slice(idx)}`,
      applied: { kind: "insert", index: idx, length: 0, text },
    };
  }
  if (op.kind === "delete") {
    return {
      nextText: `${source.slice(0, idx)}${source.slice(idx + len)}`,
      applied: { kind: "delete", index: idx, length: len, text: "" },
    };
  }
  return {
    nextText: `${source.slice(0, idx)}${text}${source.slice(idx + len)}`,
    applied: { kind: "replace", index: idx, length: len, text },
  };
}

async function applyCollabOperation(
  ctx: ExecContext,
  args: {
    sessionId: string;
    clientId: string;
    op: CollabTextOperation;
    baseVersion?: number;
  }
): Promise<Record<string, unknown>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for collaboration.", 400);
  const session = await readCollabSessionById(ctx, args.sessionId);
  if (!session) throw new CavtoolsExecError("COLLAB_SESSION_NOT_FOUND", `Collaboration session not found: ${args.sessionId}`, 404);
  if (s(session.status || "active") !== "active") {
    throw new CavtoolsExecError("COLLAB_SESSION_CLOSED", "Collaboration session is not active.", 409);
  }
  const metadata = asRecord(session.metadata) || {};
  const documentState = asRecord(metadata.documentState) || {};
  const currentText = String(documentState.text || "");
  const baseVersion = Math.max(0, Math.trunc(Number(args.baseVersion ?? session.baseVersion ?? 0)) || 0);
  const currentVersion = Math.max(0, Math.trunc(Number(session.baseVersion || 0)) || 0);
  const transformedByVersion = parseCollabProtocol(s(session.protocol || "ot")) === "ot" && baseVersion < currentVersion;
  const applied = applyCollabTextOperation(currentText, args.op);
  const nextVersion = currentVersion + 1;
  const nextState = {
    text: applied.nextText,
    length: applied.nextText.length,
    hash: hashCommandId(applied.nextText.slice(0, 2000), `/cavcode:${s(session.documentPath || "")}`),
    updatedAtISO: nowISO(),
  };
  const nextMetadata = {
    ...metadata,
    documentState: nextState,
  };
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "CavCodeCollabSession"
      SET
        "baseVersion" = ${nextVersion},
        "metadata" = CAST(${JSON.stringify(nextMetadata)} AS jsonb),
        "vectorClock" = CAST(${JSON.stringify({
          ...(asRecord(session.vectorClock) || {}),
          [ctx.userId]: nextVersion,
        })} AS jsonb),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "id" = ${s(args.sessionId)}
    `
  );
  const seqRows = await prisma.$queryRaw<Array<{ nextSeq: bigint | number }>>(
    Prisma.sql`
      SELECT COALESCE(MAX("seq"), 0) + 1 AS "nextSeq"
      FROM "CavCodeCollabOpLog"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "sessionId" = ${s(args.sessionId)}
    `
  );
  const nextSeq = Number(seqRows[0]?.nextSeq || 1);
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeCollabOpLog" (
        "id",
        "sessionId",
        "accountId",
        "projectId",
        "userId",
        "clientId",
        "seq",
        "opKind",
        "baseVersion",
        "appliedVersion",
        "operation",
        "transformed"
      ) VALUES (
        ${`collabop_${crypto.randomUUID()}`},
        ${s(args.sessionId)},
        ${ctx.accountId},
        ${ctx.project.id},
        ${ctx.userId},
        ${s(args.clientId || "cavcode") || "cavcode"},
        ${nextSeq},
        ${args.op.kind},
        ${baseVersion},
        ${nextVersion},
        CAST(${JSON.stringify(args.op)} AS jsonb),
        CAST(${JSON.stringify({
          transformedByVersion,
          applied: applied.applied,
        })} AS jsonb)
      )
    `
  );
  await publishCavcodeEvent(ctx, "collab.op.apply", {
    sessionId: s(args.sessionId),
    seq: nextSeq,
    opKind: args.op.kind,
    baseVersion,
    appliedVersion: nextVersion,
    transformedByVersion,
    clientId: s(args.clientId || "cavcode"),
  });
  return {
    type: "cav_collab_op_apply_v1",
    sessionId: s(args.sessionId),
    seq: nextSeq,
    opKind: args.op.kind,
    baseVersion,
    appliedVersion: nextVersion,
    transformedByVersion,
    applied: applied.applied,
    documentState: {
      length: nextState.length,
      hash: nextState.hash,
      updatedAtISO: nextState.updatedAtISO,
    },
  };
}

async function listCollabOperations(
  ctx: ExecContext,
  args: {
    sessionId: string;
    afterSeq?: number;
    limit?: number;
  }
): Promise<Array<Record<string, unknown>>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for collaboration.", 400);
  await ensureCavcodeInfraTables();
  const afterSeq = Number.isFinite(Number(args.afterSeq)) ? Math.max(0, Math.trunc(Number(args.afterSeq))) : 0;
  const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Math.min(COLLAB_OP_BATCH, Math.trunc(Number(args.limit)))) : COLLAB_OP_BATCH;
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "sessionId",
        "seq",
        "userId",
        "clientId",
        "opKind",
        "baseVersion",
        "appliedVersion",
        "operation",
        "transformed",
        "createdAt"
      FROM "CavCodeCollabOpLog"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "sessionId" = ${s(args.sessionId)}
        AND "seq" > ${afterSeq}
      ORDER BY "seq" ASC
      LIMIT ${limit}
    `
  );
  return rows;
}

function toRemoteProviderType(value: string): RemoteProviderType {
  const raw = s(value).toLowerCase();
  if (raw === "container") return "container";
  if (raw === "workspace") return "workspace";
  return "ssh";
}

function defaultRemoteLatency(providerType: RemoteProviderType): number {
  if (providerType === "container") return 35;
  if (providerType === "workspace") return 15;
  return 120;
}

function defaultRemoteDebugAdapters(providerType: RemoteProviderType, host = "127.0.0.1"): RemoteDebugAdapter[] {
  const base = providerType === "container" ? 17000 : providerType === "workspace" ? 18000 : 19000;
  return [
    {
      id: "node-remote",
      label: "Node Remote",
      type: "node",
      host,
      port: base + 1,
      capability: ["attach", "breakpoints", "scopes", "variables", "watch", "repl"],
    },
    {
      id: "python-remote",
      label: "Python Remote",
      type: "python",
      host,
      port: base + 2,
      capability: ["attach", "breakpoints", "scopes", "variables"],
    },
    {
      id: "go-remote",
      label: "Go Remote",
      type: "go",
      host,
      port: base + 3,
      capability: ["attach", "breakpoints", "stack"],
    },
  ];
}

async function listRemoteProviders(ctx: ExecContext): Promise<Array<Record<string, unknown>>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for remote providers.", 400);
  await ensureCavcodeInfraTables();
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "providerId",
        "providerType",
        "label",
        "status",
        "config",
        "createdAt",
        "updatedAt"
      FROM "CavCodeRemoteProvider"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
      ORDER BY "providerId" ASC
      LIMIT 240
    `
  );
  return rows;
}

async function resolveRemoteProvider(ctx: ExecContext, providerIdRaw: string): Promise<Record<string, unknown> | null> {
  const providerId = s(providerIdRaw || "");
  if (!providerId) return null;
  const rows = await listRemoteProviders(ctx);
  return rows.find((row) => s(row.providerId || "") === providerId) || null;
}

async function upsertRemoteProvider(
  ctx: ExecContext,
  args: {
    providerId: string;
    providerType: RemoteProviderType;
    label: string;
    config: Record<string, unknown>;
  }
): Promise<void> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for remote provider.", 400);
  await ensureCavcodeInfraTables();
  const providerId = s(args.providerId || "");
  if (!providerId) throw new CavtoolsExecError("REMOTE_PROVIDER_REQUIRED", "Remote provider id is required.", 400);
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeRemoteProvider" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "providerId",
        "providerType",
        "label",
        "status",
        "config"
      ) VALUES (
        ${`rprov_${crypto.randomUUID()}`},
        ${ctx.accountId},
        ${ctx.project.id},
        ${ctx.userId},
        ${providerId},
        ${args.providerType},
        ${s(args.label || providerId) || providerId},
        ${"active"},
        CAST(${JSON.stringify(args.config && typeof args.config === "object" ? args.config : {})} AS jsonb)
      )
      ON CONFLICT ("accountId", "projectId", "providerId")
      DO UPDATE SET
        "providerType" = EXCLUDED."providerType",
        "label" = EXCLUDED."label",
        "config" = EXCLUDED."config",
        "status" = EXCLUDED."status",
        "userId" = EXCLUDED."userId",
        "updatedAt" = CURRENT_TIMESTAMP
    `
  );
}

async function removeRemoteProvider(ctx: ExecContext, providerIdRaw: string): Promise<boolean> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for remote provider.", 400);
  const providerId = s(providerIdRaw || "");
  if (!providerId) return false;
  await ensureCavcodeInfraTables();
  const result = await prisma.$executeRaw(
    Prisma.sql`
      DELETE FROM "CavCodeRemoteProvider"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "providerId" = ${providerId}
    `
  );
  return Number(result) > 0;
}

function clampRemoteSessionLine(input: string): string {
  const text = String(input || "").replace(/\r/g, "").trimEnd();
  if (!text) return "";
  return text.length > REMOTE_MAX_SESSION_LOG_LINE_CHARS ? `${text.slice(0, REMOTE_MAX_SESSION_LOG_LINE_CHARS)}…` : text;
}

function pushRemoteSessionLog(session: RemoteSession, stream: "system" | "telemetry", line: string) {
  const text = clampRemoteSessionLine(line);
  if (!text) return;
  const seq = session.nextSeq + 1;
  session.nextSeq = seq;
  session.updatedAtMs = Date.now();
  session.logs.push({
    seq,
    atISO: nowISO(),
    stream,
    text,
  });
  if (session.logs.length > REMOTE_MAX_SESSION_LOG_LINES) {
    session.logs.splice(0, session.logs.length - REMOTE_MAX_SESSION_LOG_LINES);
    session.logTruncated = true;
  }
}

function remoteSessionView(session: RemoteSession) {
  return {
    type: "cav_remote_session_v1",
    sessionId: session.id,
    providerId: session.providerId,
    providerType: session.providerType,
    providerLabel: session.providerLabel,
    workspacePath: session.workspacePath,
    status: session.status,
    latencyMs: session.latencyMs,
    throughputKbps: session.throughputKbps,
    adapterMap: session.adapterMap,
    filesSynced: session.filesSynced,
    bytesSynced: session.bytesSynced,
    createdAtISO: new Date(session.createdAtMs).toISOString(),
    updatedAtISO: new Date(session.updatedAtMs).toISOString(),
    nextSeq: session.nextSeq,
    logTruncated: session.logTruncated,
  };
}

function readRemoteSessionLogs(session: RemoteSession, afterSeq: number) {
  const after = Number.isFinite(Number(afterSeq)) ? Math.max(0, Math.trunc(Number(afterSeq))) : 0;
  const entries = session.logs.filter((row) => row.seq > after).slice(0, 240);
  const nextSeq = entries.length ? entries[entries.length - 1].seq : after;
  return {
    type: "cav_remote_logs_v1",
    sessionId: session.id,
    status: session.status,
    nextSeq,
    logTruncated: session.logTruncated,
    entries,
  };
}

async function persistRemoteSessionSnapshot(session: RemoteSession): Promise<void> {
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeRemoteSession" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "providerId",
        "providerType",
        "workspacePath",
        "status",
        "latencyMs",
        "throughputKbps",
        "adapterMap",
        "syncState",
        "logs"
      ) VALUES (
        ${session.id},
        ${session.accountId},
        ${session.projectId},
        ${session.userId},
        ${session.providerId},
        ${session.providerType},
        ${session.workspacePath},
        ${session.status},
        ${session.latencyMs},
        ${session.throughputKbps},
        CAST(${JSON.stringify(session.adapterMap)} AS jsonb),
        CAST(${JSON.stringify({
          filesSynced: session.filesSynced,
          bytesSynced: session.bytesSynced,
          cacheDir: session.cacheDir,
        })} AS jsonb),
        CAST(${JSON.stringify(session.logs.slice(-240))} AS jsonb)
      )
      ON CONFLICT ("id")
      DO UPDATE SET
        "status" = EXCLUDED."status",
        "latencyMs" = EXCLUDED."latencyMs",
        "throughputKbps" = EXCLUDED."throughputKbps",
        "adapterMap" = EXCLUDED."adapterMap",
        "syncState" = EXCLUDED."syncState",
        "logs" = EXCLUDED."logs",
        "updatedAt" = CURRENT_TIMESTAMP,
        "stoppedAt" = CASE WHEN EXCLUDED."status" = 'stopped' THEN CURRENT_TIMESTAMP ELSE NULL END
    `
  );
}

async function listPersistedRemoteSessions(
  ctx: ExecContext,
  limit = 80
): Promise<Array<Record<string, unknown>>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for remote sessions.", 400);
  await ensureCavcodeInfraTables();
  const max = Math.max(1, Math.min(240, Math.trunc(Number(limit)) || 80));
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "id",
        "providerId",
        "providerType",
        "workspacePath",
        "status",
        "latencyMs",
        "throughputKbps",
        "adapterMap",
        "syncState",
        "createdAt",
        "updatedAt",
        "stoppedAt"
      FROM "CavCodeRemoteSession"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
      ORDER BY "updatedAt" DESC
      LIMIT ${max}
    `
  );
  return rows;
}

async function cleanupRemoteSessions() {
  const now = Date.now();
  const staleIds: string[] = [];
  for (const [id, session] of remoteSessions.entries()) {
    if (sessionActive(session.status)) continue;
    if (now - session.updatedAtMs < REMOTE_SESSION_RETENTION_MS) continue;
    staleIds.push(id);
  }
  for (const id of staleIds) {
    const session = remoteSessions.get(id);
    if (!session) continue;
    remoteSessions.delete(id);
    const active = remoteSessionByProject.get(session.key);
    if (active === id) remoteSessionByProject.delete(session.key);
  }
}

function assertRemoteSessionAccess(ctx: ExecContext, sessionId: string): RemoteSession {
  const session = remoteSessions.get(sessionId);
  if (!session) throw new CavtoolsExecError("REMOTE_SESSION_NOT_FOUND", `Remote session not found: ${sessionId}`, 404);
  if (session.accountId !== ctx.accountId || session.userId !== ctx.userId) {
    throw new CavtoolsExecError("UNAUTHORIZED", "Remote session is not accessible for this operator.", 403, "ROLE_BLOCKED");
  }
  return session;
}

async function stopRemoteSession(session: RemoteSession, reason = "Remote session stopped by operator."): Promise<void> {
  session.stopRequested = true;
  session.status = "stopped";
  pushRemoteSessionLog(session, "system", reason);
  await persistRemoteSessionSnapshot(session).catch(() => {});
  const actor = reliabilityActorFromSession(session);
  if (actor) {
    await writeReliabilitySnapshot(actor, {
      kind: "remote-session",
      scopeId: session.id,
      status: session.status,
      payload: remoteSessionView(session),
    }).catch(() => {});
    await writeDeterministicReplay(actor, {
      category: "remote",
      sessionId: session.id,
      action: "remote.session.stop",
      payload: {
        reason,
        status: session.status,
      },
    }).catch(() => {});
  }
}

async function startRemoteSession(
  ctx: ExecContext,
  args: {
    providerId: string;
    workspacePath?: string | null;
    latencyMs?: number | null;
    stopExisting?: boolean;
  }
): Promise<RemoteSession> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for remote session.", 400);
  await cleanupRemoteSessions();
  const provider = await resolveRemoteProvider(ctx, args.providerId);
  if (!provider) throw new CavtoolsExecError("REMOTE_PROVIDER_NOT_FOUND", `Remote provider not found: ${args.providerId}`, 404);
  const policy = await assertExecutionAllowed(ctx, {
    scope: "remote",
    command: `remote session start ${s(provider.providerType || "ssh")} ${s(provider.providerId || args.providerId)}`,
    resource: s(provider.providerId || args.providerId),
  });
  const key = runtimeProjectKey(ctx.accountId, ctx.project.id);
  const activeId = remoteSessionByProject.get(key);
  if (activeId && args.stopExisting !== false) {
    const existing = remoteSessions.get(activeId);
    if (existing && sessionActive(existing.status)) {
      await stopRemoteSession(existing, "Stopped previous remote session.");
    }
  }
  const providerType = toRemoteProviderType(s(provider.providerType || "ssh"));
  const providerConfig = asRecord(provider.config) || {};
  const host = s(providerConfig.host || providerConfig.hostname || "127.0.0.1") || "127.0.0.1";
  const latencyMs = Number.isFinite(Number(args.latencyMs))
    ? Math.max(1, Math.min(2500, Math.trunc(Number(args.latencyMs))))
    : Number.isFinite(Number(providerConfig.latencyMs))
      ? Math.max(1, Math.min(2500, Math.trunc(Number(providerConfig.latencyMs))))
      : defaultRemoteLatency(providerType);
  const throughputKbps = Number.isFinite(Number(providerConfig.throughputKbps))
    ? Math.max(256, Math.min(500000, Math.trunc(Number(providerConfig.throughputKbps))))
    : providerType === "workspace"
      ? 200000
      : providerType === "container"
        ? 150000
        : 24000;
  const workspacePath = s(args.workspacePath || providerConfig.workspacePath || "/workspace") || "/workspace";
  const cacheRoot = path.join(tmpdir(), "cavcode-remote", ctx.accountId, String(ctx.project.id));
  await mkdir(cacheRoot, { recursive: true });
  const cacheDir = await mkdtemp(path.join(cacheRoot, `${s(provider.providerId || "provider")}-`));
  const sync = await syncMountedWorkspaceToDirectory(ctx, cacheDir);
  const sessionId = `remote_${hashCommandId(`${ctx.accountId}:${ctx.userId}:${ctx.project.id}:${provider.providerId}:${Date.now()}`, cacheDir)}`;
  const session: RemoteSession = {
    id: sessionId,
    key,
    accountId: ctx.accountId,
    projectId: ctx.project.id,
    userId: ctx.userId,
    providerId: s(provider.providerId || args.providerId),
    providerType,
    providerLabel: s(provider.label || provider.providerId || args.providerId),
    workspacePath,
    status: "running",
    latencyMs,
    throughputKbps,
    adapterMap: defaultRemoteDebugAdapters(providerType, host),
    cacheDir,
    filesSynced: Math.max(0, sync.filesWritten),
    bytesSynced: Math.max(0, sync.bytesWritten),
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    stopRequested: false,
    nextSeq: 0,
    logTruncated: false,
    logs: [],
  };
  pushRemoteSessionLog(session, "system", `Remote session started for provider ${session.providerId}.`);
  pushRemoteSessionLog(
    session,
    "telemetry",
    `latency=${latencyMs}ms throughput=${session.throughputKbps}kbps files=${session.filesSynced} bytes=${session.bytesSynced}`
  );
  if (sync.warnings.length) {
    for (const warn of sync.warnings) {
      pushRemoteSessionLog(session, "system", `[sync] ${warn}`);
    }
  }
  pushRemoteSessionLog(
    session,
    "system",
    `[security] profile=${policy.profile} sandbox=${policy.sandboxMode} network=${policy.networkPolicy}`
  );
  remoteSessions.set(session.id, session);
  remoteSessionByProject.set(key, session.id);
  await persistRemoteSessionSnapshot(session).catch(() => {});
  await publishCavcodeEvent(ctx, "remote.session.start", {
    sessionId: session.id,
    providerId: session.providerId,
    providerType: session.providerType,
    latencyMs: session.latencyMs,
    throughputKbps: session.throughputKbps,
    filesSynced: session.filesSynced,
  });
  await recordReliabilitySnapshot(ctx, {
    kind: "remote-session",
    scopeId: session.id,
    status: session.status,
    payload: remoteSessionView(session),
  }).catch(() => {});
  await recordDeterministicReplay(ctx, {
    category: "remote",
    sessionId: session.id,
    action: "remote.session.start",
    payload: remoteSessionView(session),
  }).catch(() => {});
  return session;
}

async function listRemotePortForwards(
  ctx: ExecContext,
  sessionId?: string | null
): Promise<Array<Record<string, unknown>>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for port forwards.", 400);
  await ensureCavcodeInfraTables();
  const sid = s(sessionId || "");
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    sid
      ? Prisma.sql`
          SELECT
            "id",
            "sessionId",
            "localPort",
            "remoteHost",
            "remotePort",
            "protocol",
            "status",
            "createdAt",
            "updatedAt",
            "closedAt"
          FROM "CavCodeRemotePortForward"
          WHERE "accountId" = ${ctx.accountId}
            AND "projectId" = ${ctx.project.id}
            AND "sessionId" = ${sid}
          ORDER BY "updatedAt" DESC
          LIMIT 240
        `
      : Prisma.sql`
          SELECT
            "id",
            "sessionId",
            "localPort",
            "remoteHost",
            "remotePort",
            "protocol",
            "status",
            "createdAt",
            "updatedAt",
            "closedAt"
          FROM "CavCodeRemotePortForward"
          WHERE "accountId" = ${ctx.accountId}
            AND "projectId" = ${ctx.project.id}
          ORDER BY "updatedAt" DESC
          LIMIT 240
        `
  );
  return rows;
}

async function addRemotePortForward(
  ctx: ExecContext,
  args: {
    sessionId: string;
    localPort: number;
    remoteHost: string;
    remotePort: number;
    protocol: string;
  }
): Promise<Record<string, unknown>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for port forward.", 400);
  const session = assertRemoteSessionAccess(ctx, args.sessionId);
  if (!sessionActive(session.status)) throw new CavtoolsExecError("REMOTE_SESSION_INACTIVE", "Remote session is not active.", 409);
  await ensureCavcodeInfraTables();
  const localPort = Math.max(1, Math.min(65535, Math.trunc(args.localPort)));
  const remotePort = Math.max(1, Math.min(65535, Math.trunc(args.remotePort)));
  const remoteHost = s(args.remoteHost || "127.0.0.1") || "127.0.0.1";
  const protocol = s(args.protocol || "tcp").toLowerCase() === "udp" ? "udp" : "tcp";
  const status: RemotePortForwardStatus = "active";
  const forwardId = `fwd_${crypto.randomUUID()}`;
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeRemotePortForward" (
        "id",
        "sessionId",
        "accountId",
        "projectId",
        "userId",
        "localPort",
        "remoteHost",
        "remotePort",
        "protocol",
        "status"
      ) VALUES (
        ${forwardId},
        ${session.id},
        ${ctx.accountId},
        ${ctx.project.id},
        ${ctx.userId},
        ${localPort},
        ${remoteHost},
        ${remotePort},
        ${protocol},
        ${status}
      )
    `
  );
  pushRemoteSessionLog(session, "system", `Port forward ${forwardId}: localhost:${localPort} -> ${remoteHost}:${remotePort}/${protocol}`);
  await persistRemoteSessionSnapshot(session).catch(() => {});
  await publishCavcodeEvent(ctx, "remote.port.forward", {
    sessionId: session.id,
    forwardId,
    localPort,
    remoteHost,
    remotePort,
    protocol,
  });
  return {
    id: forwardId,
    sessionId: session.id,
    localPort,
    remoteHost,
    remotePort,
    protocol,
    status,
  };
}

async function closeRemotePortForward(ctx: ExecContext, forwardIdRaw: string): Promise<boolean> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for port forward.", 400);
  const forwardId = s(forwardIdRaw || "");
  if (!forwardId) return false;
  await ensureCavcodeInfraTables();
  const result = await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "CavCodeRemotePortForward"
      SET
        "status" = 'closed',
        "closedAt" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "id" = ${forwardId}
        AND "status" = 'active'
    `
  );
  return Number(result) > 0;
}

function reliabilityActorFromContext(ctx: ExecContext): ReliabilityActor | null {
  const projectId = Number(ctx.project?.id || 0);
  if (!Number.isFinite(projectId) || projectId <= 0) return null;
  return {
    accountId: s(ctx.accountId || ""),
    userId: s(ctx.userId || ""),
    projectId: Math.trunc(projectId),
  };
}

function reliabilityActorFromSession(session: { accountId: string; userId: string; projectId: number }): ReliabilityActor | null {
  const projectId = Number(session.projectId || 0);
  if (!Number.isFinite(projectId) || projectId <= 0) return null;
  return {
    accountId: s(session.accountId || ""),
    userId: s(session.userId || ""),
    projectId: Math.trunc(projectId),
  };
}

async function writeReliabilitySnapshot(
  actor: ReliabilityActor,
  args: {
    kind: string;
    scopeId: string;
    status: string;
    payload?: Record<string, unknown> | null;
  }
): Promise<void> {
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeReliabilitySnapshot" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "kind",
        "scopeId",
        "status",
        "payload"
      ) VALUES (
        ${`relsnap_${crypto.randomUUID()}`},
        ${actor.accountId},
        ${actor.projectId},
        ${actor.userId},
        ${s(args.kind) || "unknown"},
        ${s(args.scopeId) || "scope"},
        ${s(args.status) || "unknown"},
        CAST(${JSON.stringify(args.payload && typeof args.payload === "object" ? args.payload : {})} AS jsonb)
      )
    `
  );
}

async function writeCrashRecord(
  actor: ReliabilityActor,
  args: {
    kind: string;
    scopeId: string;
    error: string;
    stack?: string | null;
    payload?: Record<string, unknown> | null;
  }
): Promise<string> {
  await ensureCavcodeInfraTables();
  const id = `crash_${crypto.randomUUID()}`;
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeCrashRecord" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "kind",
        "scopeId",
        "error",
        "stack",
        "payload"
      ) VALUES (
        ${id},
        ${actor.accountId},
        ${actor.projectId},
        ${actor.userId},
        ${s(args.kind) || "unknown"},
        ${s(args.scopeId) || "scope"},
        ${s(args.error) || "unknown error"},
        ${s(args.stack || "") || null},
        CAST(${JSON.stringify(args.payload && typeof args.payload === "object" ? args.payload : {})} AS jsonb)
      )
    `
  );
  return id;
}

async function writeDeterministicReplay(
  actor: ReliabilityActor,
  args: {
    category: string;
    sessionId: string;
    action: string;
    payload?: Record<string, unknown> | null;
  }
): Promise<void> {
  await ensureCavcodeInfraTables();
  const seqRows = await prisma.$queryRaw<Array<{ nextSeq: bigint | number }>>(
    Prisma.sql`
      SELECT COALESCE(MAX("seq"), 0) + 1 AS "nextSeq"
      FROM "CavCodeDeterministicReplay"
      WHERE "accountId" = ${actor.accountId}
        AND "projectId" = ${actor.projectId}
        AND "category" = ${s(args.category || "default")}
        AND "sessionId" = ${s(args.sessionId || "session")}
    `
  );
  const seq = Number(seqRows[0]?.nextSeq || 1);
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeDeterministicReplay" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "category",
        "sessionId",
        "seq",
        "action",
        "payload"
      ) VALUES (
        ${`replay_${crypto.randomUUID()}`},
        ${actor.accountId},
        ${actor.projectId},
        ${actor.userId},
        ${s(args.category) || "default"},
        ${s(args.sessionId) || "session"},
        ${seq},
        ${s(args.action) || "action"},
        CAST(${JSON.stringify(args.payload && typeof args.payload === "object" ? args.payload : {})} AS jsonb)
      )
    `
  );
}

async function recordReliabilitySnapshot(
  ctx: ExecContext,
  args: {
    kind: string;
    scopeId: string;
    status: string;
    payload?: Record<string, unknown> | null;
  }
): Promise<void> {
  const actor = reliabilityActorFromContext(ctx);
  if (!actor) return;
  await writeReliabilitySnapshot(actor, args);
}

async function listReliabilitySnapshots(
  ctx: ExecContext,
  args?: { kind?: string | null; limit?: number }
): Promise<Array<Record<string, unknown>>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for reliability snapshots.", 400);
  await ensureCavcodeInfraTables();
  const kind = s(args?.kind || "");
  const limit = Number.isFinite(Number(args?.limit)) ? Math.max(1, Math.min(400, Math.trunc(Number(args?.limit)))) : 80;
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    kind
      ? Prisma.sql`
          SELECT
            "id",
            "kind",
            "scopeId",
            "status",
            "payload",
            "createdAt"
          FROM "CavCodeReliabilitySnapshot"
          WHERE "accountId" = ${ctx.accountId}
            AND "projectId" = ${ctx.project.id}
            AND "kind" = ${kind}
          ORDER BY "createdAt" DESC
          LIMIT ${limit}
        `
      : Prisma.sql`
          SELECT
            "id",
            "kind",
            "scopeId",
            "status",
            "payload",
            "createdAt"
          FROM "CavCodeReliabilitySnapshot"
          WHERE "accountId" = ${ctx.accountId}
            AND "projectId" = ${ctx.project.id}
          ORDER BY "createdAt" DESC
          LIMIT ${limit}
        `
  );
  return rows;
}

async function recordCrashRecord(
  ctx: ExecContext,
  args: {
    kind: string;
    scopeId: string;
    error: string;
    stack?: string | null;
    payload?: Record<string, unknown> | null;
  }
): Promise<string> {
  const actor = reliabilityActorFromContext(ctx);
  if (!actor) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for crash record.", 400);
  const id = await writeCrashRecord(actor, args);
  await publishCavcodeEvent(ctx, "reliability.crash.record", {
    crashId: id,
    kind: s(args.kind),
    scopeId: s(args.scopeId),
    error: s(args.error),
  });
  return id;
}

async function listCrashRecords(ctx: ExecContext, limit = 80): Promise<Array<Record<string, unknown>>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for crash records.", 400);
  await ensureCavcodeInfraTables();
  const max = Math.max(1, Math.min(300, Math.trunc(Number(limit)) || 80));
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "id",
        "kind",
        "scopeId",
        "error",
        "stack",
        "payload",
        "createdAt",
        "resolvedAt"
      FROM "CavCodeCrashRecord"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
      ORDER BY "createdAt" DESC
      LIMIT ${max}
    `
  );
  return rows;
}

async function resolveCrashRecord(ctx: ExecContext, crashIdRaw: string): Promise<boolean> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for crash records.", 400);
  const crashId = s(crashIdRaw || "");
  if (!crashId) return false;
  await ensureCavcodeInfraTables();
  const result = await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "CavCodeCrashRecord"
      SET "resolvedAt" = CURRENT_TIMESTAMP
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "id" = ${crashId}
        AND "resolvedAt" IS NULL
    `
  );
  return Number(result) > 0;
}

async function recordDeterministicReplay(
  ctx: ExecContext,
  args: {
    category: string;
    sessionId: string;
    action: string;
    payload?: Record<string, unknown> | null;
  }
): Promise<void> {
  const actor = reliabilityActorFromContext(ctx);
  if (!actor) return;
  await writeDeterministicReplay(actor, args);
}

async function listDeterministicReplay(
  ctx: ExecContext,
  args: {
    category?: string | null;
    sessionId?: string | null;
    afterSeq?: number;
    limit?: number;
  }
): Promise<Array<Record<string, unknown>>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for deterministic replay.", 400);
  await ensureCavcodeInfraTables();
  const category = s(args.category || "");
  const sessionId = s(args.sessionId || "");
  const afterSeq = Number.isFinite(Number(args.afterSeq)) ? Math.max(0, Math.trunc(Number(args.afterSeq))) : 0;
  const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Math.min(600, Math.trunc(Number(args.limit)))) : 200;
  const whereParts: Prisma.Sql[] = [
    Prisma.sql`"accountId" = ${ctx.accountId}`,
    Prisma.sql`"projectId" = ${ctx.project.id}`,
    Prisma.sql`"seq" > ${afterSeq}`,
  ];
  if (category) whereParts.push(Prisma.sql`"category" = ${category}`);
  if (sessionId) whereParts.push(Prisma.sql`"sessionId" = ${sessionId}`);
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "category",
        "sessionId",
        "seq",
        "action",
        "payload",
        "createdAt"
      FROM "CavCodeDeterministicReplay"
      WHERE ${Prisma.join(whereParts, " AND ")}
      ORDER BY "seq" ASC
      LIMIT ${limit}
    `
  );
  return rows;
}

function reliabilityBudgetDefaults(): ReliabilityBudgetConfig {
  return {
    targetAvailability: RELIABILITY_DEFAULT_SLO,
    errorBudgetPct: Math.max(0, 100 - RELIABILITY_DEFAULT_SLO),
    burnAlertPct: 50,
    p95LatencyMs: 1200,
    updatedAtISO: nowISO(),
  };
}

function normalizeReliabilityBudgetRow(row: Record<string, unknown> | null): ReliabilityBudgetConfig {
  const defaults = reliabilityBudgetDefaults();
  if (!row) return defaults;
  return {
    targetAvailability: Math.max(90, Math.min(100, Number(row.targetAvailability || defaults.targetAvailability))),
    errorBudgetPct: Math.max(0, Math.min(10, Number(row.errorBudgetPct || defaults.errorBudgetPct))),
    burnAlertPct: Math.max(1, Math.min(100, Number(row.burnAlertPct || defaults.burnAlertPct))),
    p95LatencyMs: Math.max(100, Math.min(60000, Math.trunc(Number(row.p95LatencyMs || defaults.p95LatencyMs)) || defaults.p95LatencyMs)),
    updatedAtISO: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : (s(row.updatedAt || "") || defaults.updatedAtISO),
  };
}

async function readReliabilityBudget(ctx: ExecContext): Promise<ReliabilityBudgetConfig> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for reliability budget.", 400);
  await ensureCavcodeInfraTables();
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "targetAvailability",
        "errorBudgetPct",
        "burnAlertPct",
        "p95LatencyMs",
        "updatedAt"
      FROM "CavCodeReliabilityBudget"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
      LIMIT 1
    `
  );
  const picked = asRecord(rows[0]);
  if (picked) return normalizeReliabilityBudgetRow(picked);
  const defaults = reliabilityBudgetDefaults();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeReliabilityBudget" (
        "accountId",
        "projectId",
        "targetAvailability",
        "errorBudgetPct",
        "burnAlertPct",
        "p95LatencyMs",
        "updatedBy"
      ) VALUES (
        ${ctx.accountId},
        ${ctx.project.id},
        ${defaults.targetAvailability},
        ${defaults.errorBudgetPct},
        ${defaults.burnAlertPct},
        ${defaults.p95LatencyMs},
        ${ctx.userId}
      )
      ON CONFLICT ("accountId", "projectId") DO NOTHING
    `
  );
  return defaults;
}

async function upsertReliabilityBudget(
  ctx: ExecContext,
  patch: Partial<ReliabilityBudgetConfig>
): Promise<ReliabilityBudgetConfig> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for reliability budget.", 400);
  const current = await readReliabilityBudget(ctx);
  const merged: ReliabilityBudgetConfig = {
    targetAvailability: patch.targetAvailability != null ? Math.max(90, Math.min(100, Number(patch.targetAvailability))) : current.targetAvailability,
    errorBudgetPct: patch.errorBudgetPct != null ? Math.max(0, Math.min(10, Number(patch.errorBudgetPct))) : current.errorBudgetPct,
    burnAlertPct: patch.burnAlertPct != null ? Math.max(1, Math.min(100, Number(patch.burnAlertPct))) : current.burnAlertPct,
    p95LatencyMs: patch.p95LatencyMs != null ? Math.max(100, Math.min(60000, Math.trunc(Number(patch.p95LatencyMs)))) : current.p95LatencyMs,
    updatedAtISO: nowISO(),
  };
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeReliabilityBudget" (
        "accountId",
        "projectId",
        "targetAvailability",
        "errorBudgetPct",
        "burnAlertPct",
        "p95LatencyMs",
        "updatedBy"
      ) VALUES (
        ${ctx.accountId},
        ${ctx.project.id},
        ${merged.targetAvailability},
        ${merged.errorBudgetPct},
        ${merged.burnAlertPct},
        ${merged.p95LatencyMs},
        ${ctx.userId}
      )
      ON CONFLICT ("accountId", "projectId")
      DO UPDATE SET
        "targetAvailability" = EXCLUDED."targetAvailability",
        "errorBudgetPct" = EXCLUDED."errorBudgetPct",
        "burnAlertPct" = EXCLUDED."burnAlertPct",
        "p95LatencyMs" = EXCLUDED."p95LatencyMs",
        "updatedBy" = EXCLUDED."updatedBy",
        "updatedAt" = CURRENT_TIMESTAMP
    `
  );
  return merged;
}

async function reliabilitySloMetrics(ctx: ExecContext, days = RELIABILITY_EVENT_WINDOW_DAYS): Promise<Record<string, unknown>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for reliability metrics.", 400);
  const windowStart = new Date(Date.now() - Math.max(1, Math.trunc(days)) * 24 * 60 * 60 * 1000);
  await ensureCavcodeInfraTables();
  const countsRows = await prisma.$queryRaw<Array<{ total: bigint | number; failures: bigint | number }>>(
    Prisma.sql`
      SELECT
        COUNT(*) AS "total",
        COUNT(*) FILTER (WHERE "decision" = 'deny') AS "failures"
      FROM "CavCodeSecurityAudit"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "createdAt" >= ${windowStart}
    `
  );
  const crashRows = await prisma.$queryRaw<Array<{ openCrashes: bigint | number; totalCrashes: bigint | number }>>(
    Prisma.sql`
      SELECT
        COUNT(*) FILTER (WHERE "resolvedAt" IS NULL) AS "openCrashes",
        COUNT(*) AS "totalCrashes"
      FROM "CavCodeCrashRecord"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "createdAt" >= ${windowStart}
    `
  );
  const runtimeRows = await prisma.$queryRaw<Array<{ totalRuntime: bigint | number; failedRuntime: bigint | number }>>(
    Prisma.sql`
      SELECT
        COUNT(*) AS "totalRuntime",
        COUNT(*) FILTER (WHERE "status" = 'failed') AS "failedRuntime"
      FROM "CavCodeTaskRun"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "createdAt" >= ${windowStart}
    `
  );
  const total = Number(countsRows[0]?.total || 0);
  const failures = Number(countsRows[0]?.failures || 0);
  const openCrashes = Number(crashRows[0]?.openCrashes || 0);
  const totalCrashes = Number(crashRows[0]?.totalCrashes || 0);
  const totalRuntime = Number(runtimeRows[0]?.totalRuntime || 0);
  const failedRuntime = Number(runtimeRows[0]?.failedRuntime || 0);
  const availability = total > 0 ? Math.max(0, ((total - failures) / total) * 100) : 100;
  const runtimeSuccessRate = totalRuntime > 0 ? Math.max(0, ((totalRuntime - failedRuntime) / totalRuntime) * 100) : 100;
  return {
    windowDays: days,
    windowStartISO: windowStart.toISOString(),
    availability,
    runtimeSuccessRate,
    totalSecurityDecisions: total,
    deniedSecurityDecisions: failures,
    openCrashes,
    totalCrashes,
    totalTaskRuns: totalRuntime,
    failedTaskRuns: failedRuntime,
  };
}

function isLikelyTextFileForCheckpoint(relPath: string): boolean {
  const lower = s(relPath).toLowerCase();
  if (!lower) return false;
  if (lower.startsWith("node_modules/") || lower.startsWith(".git/")) return false;
  return /\.(ts|tsx|js|jsx|mjs|cjs|css|scss|html|md|txt|json|yaml|yml|toml|ini|sql|sh|bash|zsh|py|go|rs|java|kt|swift|rb|php|env|xml)$/.test(lower);
}

async function captureAiCheckpoint(
  ctx: ExecContext,
  labelRaw: string
): Promise<{ checkpointId: string; label: string; fileCount: number; byteCount: number }> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for AI checkpoint.", 400);
  await ensureCavcodeInfraTables();
  const label = s(labelRaw || "") || `checkpoint-${new Date().toISOString()}`;
  const stage = await materializeRuntimeWorkspace(ctx);
  let fileCount = 0;
  let byteCount = 0;
  const files: Array<{ path: string; content: string; sha256: string; bytes: number }> = [];
  try {
    const relFiles = await collectLocalWorkspaceFiles(stage.workspaceDir);
    for (const rel of relFiles) {
      if (!isLikelyTextFileForCheckpoint(rel)) continue;
      if (fileCount >= AI_CHECKPOINT_MAX_FILES) break;
      const abs = path.join(stage.workspaceDir, rel);
      let stats;
      try {
        stats = await stat(abs);
      } catch {
        continue;
      }
      if (stats.size > AI_CHECKPOINT_MAX_FILE_BYTES) continue;
      if (byteCount + stats.size > AI_CHECKPOINT_MAX_BYTES) break;
      let content = "";
      try {
        content = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      const bytes = Buffer.byteLength(content, "utf8");
      if (bytes + byteCount > AI_CHECKPOINT_MAX_BYTES) break;
      fileCount += 1;
      byteCount += bytes;
      const cavPath = normalizePath(`/cavcode/${rel}`);
      files.push({
        path: cavPath,
        content,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
        bytes,
      });
    }
  } finally {
    try {
      await rm(stage.workspaceDir, { recursive: true, force: true });
    } catch {}
  }
  const checkpointId = `ckpt_${crypto.randomUUID()}`;
  const snapshot = {
    version: 1,
    capturedAtISO: nowISO(),
    fileCount,
    byteCount,
    files,
  };
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeAiCheckpoint" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "label",
        "snapshot",
        "fileCount",
        "byteCount"
      ) VALUES (
        ${checkpointId},
        ${ctx.accountId},
        ${ctx.project.id},
        ${ctx.userId},
        ${label},
        CAST(${JSON.stringify(snapshot)} AS jsonb),
        ${fileCount},
        ${byteCount}
      )
    `
  );
  await recordDeterministicReplay(ctx, {
    category: "ai",
    sessionId: checkpointId,
    action: "checkpoint.capture",
    payload: { label, fileCount, byteCount },
  }).catch(() => {});
  return { checkpointId, label, fileCount, byteCount };
}

async function listAiCheckpoints(ctx: ExecContext, limit = 40): Promise<Array<Record<string, unknown>>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for AI checkpoints.", 400);
  await ensureCavcodeInfraTables();
  const max = Math.max(1, Math.min(240, Math.trunc(Number(limit)) || 40));
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "id",
        "label",
        "snapshot",
        "fileCount",
        "byteCount",
        "createdAt"
      FROM "CavCodeAiCheckpoint"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
      ORDER BY "createdAt" DESC
      LIMIT ${max}
    `
  );
  return rows;
}

async function readAiCheckpointSnapshot(ctx: ExecContext, checkpointIdRaw: string): Promise<Record<string, unknown> | null> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for AI checkpoints.", 400);
  const checkpointId = s(checkpointIdRaw || "");
  if (!checkpointId) return null;
  await ensureCavcodeInfraTables();
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT
        "id",
        "label",
        "snapshot",
        "fileCount",
        "byteCount",
        "createdAt"
      FROM "CavCodeAiCheckpoint"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "id" = ${checkpointId}
      LIMIT 1
    `
  );
  return asRecord(rows[0]);
}

async function restoreAiCheckpoint(
  ctx: ExecContext,
  checkpointIdRaw: string
): Promise<{ restored: number; failed: number; warnings: string[] }> {
  const row = await readAiCheckpointSnapshot(ctx, checkpointIdRaw);
  if (!row) throw new CavtoolsExecError("AI_CHECKPOINT_NOT_FOUND", `Checkpoint not found: ${checkpointIdRaw}`, 404);
  const snapshot = asRecord(row.snapshot) || {};
  const files = Array.isArray(snapshot.files) ? snapshot.files : [];
  let restored = 0;
  let failed = 0;
  const warnings: string[] = [];
  for (const item of files) {
    const rec = asRecord(item);
    const pathValue = normalizePath(s(rec?.path || ""));
    const content = String(rec?.content || "");
    if (!pathValue.startsWith("/cavcode/")) {
      failed += 1;
      continue;
    }
    try {
      await writeCavcodeText(ctx, pathValue, content, null, null);
      restored += 1;
    } catch (error) {
      failed += 1;
      warnings.push(`${pathValue}: ${s((error as Error | null)?.message || "restore failed")}`);
      if (warnings.length > 50) break;
    }
  }
  await recordDeterministicReplay(ctx, {
    category: "ai",
    sessionId: s(row.id || checkpointIdRaw),
    action: "checkpoint.restore",
    payload: { restored, failed, warnings: warnings.slice(0, 12) },
  }).catch(() => {});
  return { restored, failed, warnings };
}

async function saveWorkbenchState(
  ctx: ExecContext,
  stateKeyRaw: string,
  state: Record<string, unknown>
): Promise<void> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for workbench state.", 400);
  await ensureCavcodeInfraTables();
  const stateKey = s(stateKeyRaw || "");
  if (!stateKey) throw new CavtoolsExecError("WORKBENCH_STATE_KEY_REQUIRED", "Workbench state key is required.", 400);
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeWorkbenchState" (
        "accountId",
        "projectId",
        "userId",
        "stateKey",
        "state",
        "updatedAt"
      ) VALUES (
        ${ctx.accountId},
        ${ctx.project.id},
        ${ctx.userId},
        ${stateKey},
        CAST(${JSON.stringify(state && typeof state === "object" ? state : {})} AS jsonb),
        CURRENT_TIMESTAMP
      )
      ON CONFLICT ("accountId", "projectId", "userId", "stateKey")
      DO UPDATE SET
        "state" = EXCLUDED."state",
        "updatedAt" = CURRENT_TIMESTAMP
    `
  );
}

async function loadWorkbenchState(ctx: ExecContext, stateKeyRaw: string): Promise<Record<string, unknown> | null> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for workbench state.", 400);
  await ensureCavcodeInfraTables();
  const stateKey = s(stateKeyRaw || "");
  if (!stateKey) return null;
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT "stateKey", "state", "updatedAt"
      FROM "CavCodeWorkbenchState"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "userId" = ${ctx.userId}
        AND "stateKey" = ${stateKey}
      LIMIT 1
    `
  );
  return asRecord(rows[0]) || null;
}

async function listWorkbenchStates(ctx: ExecContext): Promise<Array<Record<string, unknown>>> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for workbench state.", 400);
  await ensureCavcodeInfraTables();
  const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
    Prisma.sql`
      SELECT "stateKey", "state", "updatedAt"
      FROM "CavCodeWorkbenchState"
      WHERE "accountId" = ${ctx.accountId}
        AND "projectId" = ${ctx.project.id}
        AND "userId" = ${ctx.userId}
      ORDER BY "updatedAt" DESC
      LIMIT 120
    `
  );
  return rows;
}

async function applyDeterministicRepairHeuristics(
  ctx: ExecContext,
  files: string[]
): Promise<Array<{ path: string; changes: string[] }>> {
  const touched: Array<{ path: string; changes: string[] }> = [];
  const unique = Array.from(new Set(files.map((item) => normalizePath(item)).filter((item) => item.startsWith("/cavcode/"))));
  for (const pathValue of unique.slice(0, 12)) {
    let file: CavtoolsFileReadOutput | null = null;
    try {
      file = await readFileText(ctx, pathValue);
    } catch {
      file = null;
    }
    if (!file?.ok) continue;
    const original = String(file.content || "");
    if (!original) continue;
    const changes: string[] = [];
    let next = original;

    const trimmed = next
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/g, ""))
      .join("\n");
    if (trimmed !== next) {
      next = trimmed;
      changes.push("trim_trailing_whitespace");
    }

    const normalizedNewlines = next.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (normalizedNewlines !== next) {
      next = normalizedNewlines;
      changes.push("normalize_newlines");
    }

    const collapsedBlanks = next.replace(/\n{4,}/g, "\n\n\n");
    if (collapsedBlanks !== next) {
      next = collapsedBlanks;
      changes.push("collapse_blank_runs");
    }

    if (next && !next.endsWith("\n")) {
      next = `${next}\n`;
      changes.push("ensure_terminal_newline");
    }

    if (next === original || !changes.length) continue;
    try {
      await writeFileText(ctx, pathValue, next, file.mimeType, file.sha256 || null);
      touched.push({ path: pathValue, changes });
    } catch {
      continue;
    }
  }
  return touched;
}

async function runDeterministicAiRepairLoop(
  ctx: ExecContext,
  args: {
    goal: string;
    maxCycles: number;
    testTaskLabel?: string | null;
    rollbackOnFail?: boolean;
  }
): Promise<Record<string, unknown>> {
  const checkpoint = await captureAiCheckpoint(ctx, `loop:${s(args.goal || "goal")}`);
  const baseline = await runCavcodeWorkspaceDiagnostics(ctx);
  const baselineErrors = baseline.summary.errors;
  const baselineWarnings = baseline.summary.warnings;
  const debugState = Array.from(debugSessions.values())
    .filter((row) => row.accountId === ctx.accountId && row.projectId === (ctx.project?.id || 0))
    .map((row) => ({
      sessionId: row.id,
      status: row.status,
      entryPath: row.entryCavcodePath,
      currentLocation: row.currentLocation,
    }));
  const scopedFiles = Array.from(new Set(
    baseline.diagnostics
      .filter((diag) => diag.severity === "error" || diag.severity === "warn")
      .map((diag) => normalizePath(diag.file))
      .filter((file) => file.startsWith("/cavcode/"))
  )).slice(0, 24);
  const cycles = Math.max(1, Math.min(8, Math.trunc(Number(args.maxCycles || 3)) || 3));
  const cycleRows: Array<Record<string, unknown>> = [];
  let currentSummary = baseline.summary;
  let repairedCount = 0;
  let testStatus: Record<string, unknown> | null = null;

  for (let i = 0; i < cycles; i += 1) {
    const cycleNo = i + 1;
    const touched = await applyDeterministicRepairHeuristics(ctx, scopedFiles);
    repairedCount += touched.length;
    const after = await runCavcodeWorkspaceDiagnostics(ctx);
    currentSummary = after.summary;
    let taskWarnings: string[] = [];
    if (args.testTaskLabel) {
      try {
        const taskRun = await runDebugTaskForContext(ctx, args.testTaskLabel);
        taskWarnings = taskRun.warnings;
        testStatus = {
          task: args.testTaskLabel,
          warnings: taskWarnings,
          ok: true,
        };
      } catch (error) {
        const message = s((error as Error | null)?.message || "task failed");
        taskWarnings = [message];
        testStatus = {
          task: args.testTaskLabel,
          warnings: taskWarnings,
          ok: false,
        };
      }
    }
    const deltaErrors = currentSummary.errors - baselineErrors;
    const deltaWarnings = currentSummary.warnings - baselineWarnings;
    const row = {
      cycle: cycleNo,
      touchedFiles: touched.length,
      touches: touched,
      summary: currentSummary,
      deltaErrors,
      deltaWarnings,
      testStatus,
      taskWarnings,
    };
    cycleRows.push(row);
    await recordDeterministicReplay(ctx, {
      category: "ai",
      sessionId: checkpoint.checkpointId,
      action: "loop.cycle",
      payload: row,
    }).catch(() => {});
    if (touched.length === 0) break;
    if (currentSummary.errors <= baselineErrors && currentSummary.warnings <= baselineWarnings) break;
  }

  let rollback = null as null | { restored: number; failed: number; warnings: string[] };
  const worsened =
    currentSummary.errors > baselineErrors
    || (currentSummary.errors === baselineErrors && currentSummary.warnings > baselineWarnings);
  if (worsened && args.rollbackOnFail) {
    rollback = await restoreAiCheckpoint(ctx, checkpoint.checkpointId);
    currentSummary = (await runCavcodeWorkspaceDiagnostics(ctx)).summary;
  }

  const result = {
    type: "cav_loop_run_v2",
    goal: s(args.goal),
    checkpoint,
    scopedFiles,
    baseline: baseline.summary,
    final: currentSummary,
    cycles: cycleRows,
    repairedCount,
    rollback,
    debugState,
    testStatus,
  };
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeAiLoopRun" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "goal",
        "result"
      ) VALUES (
        ${`loop_${crypto.randomUUID()}`},
        ${ctx.accountId},
        ${ctx.project?.id || 0},
        ${ctx.userId},
        ${s(args.goal) || "loop"},
        CAST(${JSON.stringify(result)} AS jsonb)
      )
    `
  );
  await publishCavcodeEvent(ctx, "loop.run", {
    goal: s(args.goal),
    checkpointId: checkpoint.checkpointId,
    baselineErrors,
    finalErrors: currentSummary.errors,
    baselineWarnings,
    finalWarnings: currentSummary.warnings,
    cycles: cycleRows.length,
    rollback: Boolean(rollback),
  });
  return result;
}

function toWorkspaceRelative(virtualPath: string): string | null {
  const normalized = normalizePath(virtualPath);
  if (!normalized.startsWith("/cavcode/")) return null;
  const rel = normalized.slice("/cavcode/".length);
  if (!rel) return null;
  const parts = rel.split("/").filter(Boolean);
  if (!parts.length) return null;
  if (parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
}

async function collectLocalWorkspaceFiles(rootDir: string, prefix = ""): Promise<string[]> {
  const rows = await readdir(rootDir, { withFileTypes: true });
  const out: string[] = [];
  for (const row of rows) {
    if (row.name === ".git") continue;
    const rel = prefix ? `${prefix}/${row.name}` : row.name;
    const abs = path.join(rootDir, row.name);
    if (row.isDirectory()) {
      const nested = await collectLocalWorkspaceFiles(abs, rel);
      out.push(...nested);
      continue;
    }
    if (row.isFile()) out.push(rel);
  }
  return out;
}

async function removeLocalFileIfExists(absPath: string) {
  try {
    await rm(absPath, { recursive: false, force: true });
  } catch {}
}

async function pruneEmptyLocalDirs(rootDir: string, dirRel = "") {
  const abs = dirRel ? path.join(rootDir, dirRel) : rootDir;
  const rows = await readdir(abs, { withFileTypes: true }).catch(() => []);
  for (const row of rows) {
    if (!row.isDirectory()) continue;
    if (row.name === ".git") continue;
    const childRel = dirRel ? `${dirRel}/${row.name}` : row.name;
    await pruneEmptyLocalDirs(rootDir, childRel);
  }
  if (!dirRel) return;
  const left = await readdir(abs).catch(() => []);
  if (!left.length) {
    try {
      await rm(abs, { recursive: true, force: true });
    } catch {}
  }
}

async function syncMountedWorkspaceToDirectory(
  ctx: ExecContext,
  workspaceDir: string
): Promise<{ filesWritten: number; filesRemoved: number; bytesWritten: number; warnings: string[] }> {
  await mkdir(workspaceDir, { recursive: true });
  const collect = await collectRuntimeMaterializedFiles(ctx);
  const warnings: string[] = [];
  if (collect.truncatedByFileLimit) warnings.push("Workspace file sync truncated by file-count limit.");
  if (collect.truncatedByByteLimit) warnings.push("Workspace file sync truncated by total-byte limit.");

  const keep = new Set<string>();
  let filesWritten = 0;
  let bytesWritten = 0;

  for (const file of collect.files) {
    const rel = toRuntimeRelativePath(file.path);
    if (!rel) continue;
    keep.add(rel);
    const absPath = path.join(workspaceDir, rel);
    const normalizedAbs = path.normalize(absPath);
    if (!normalizedAbs.startsWith(path.normalize(workspaceDir))) continue;
    const stream =
      file.sourceType === "CAVCLOUD"
        ? await getCavcloudObjectStream({ objectKey: file.objectKey })
        : await getCavsafeObjectStream({ objectKey: file.objectKey });
    if (!stream) continue;
    const buffer = await readObjectBuffer(stream.body, MAX_RUNTIME_FILE_BYTES);
    await mkdir(path.dirname(normalizedAbs), { recursive: true });
    await writeFile(normalizedAbs, buffer);
    filesWritten += 1;
    bytesWritten += buffer.byteLength;
  }

  const localFiles = await collectLocalWorkspaceFiles(workspaceDir);
  let filesRemoved = 0;
  for (const rel of localFiles) {
    if (keep.has(rel)) continue;
    const abs = path.join(workspaceDir, rel);
    await removeLocalFileIfExists(abs);
    filesRemoved += 1;
  }
  await pruneEmptyLocalDirs(workspaceDir);

  return {
    filesWritten,
    filesRemoved,
    bytesWritten,
    warnings,
  };
}

async function runCommandWithCapturedOutput(args: {
  bin: string;
  argv: string[];
  cwd: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  stdinText?: string | null;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeoutMs = Number.isFinite(Number(args.timeoutMs)) ? Math.max(1000, Math.trunc(Number(args.timeoutMs))) : 60_000;
  return await new Promise((resolve) => {
    const child = spawn(args.bin, args.argv, {
      cwd: args.cwd,
      env: args.env || process.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    try {
      if (args.stdinText != null) {
        child.stdin?.write(String(args.stdinText));
      }
      child.stdin?.end();
    } catch {}

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
      if (stdout.length > 1_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000);
    });

    let done = false;
    const finish = (code: number) => {
      if (done) return;
      done = true;
      resolve({
        code,
        stdout: stdout.replace(/\r/g, ""),
        stderr: stderr.replace(/\r/g, ""),
      });
    };

    const timer = setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {}
      setTimeout(() => {
        try {
          if (child.exitCode == null) child.kill("SIGKILL");
        } catch {}
      }, 1_500).unref?.();
      finish(124);
    }, timeoutMs);
    timer.unref?.();

    child.on("error", () => {
      clearTimeout(timer);
      finish(1);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      finish(Number.isFinite(Number(code)) ? Math.trunc(Number(code)) : 1);
    });
  });
}

async function runGitCommand(args: {
  cwd: string;
  argv: string[];
  timeoutMs?: number;
  allowNonZero?: boolean;
  stdinText?: string | null;
}): Promise<{ code: number; stdout: string; stderr: string }> {
  const result = await runCommandWithCapturedOutput({
    bin: "git",
    argv: args.argv,
    cwd: args.cwd,
    timeoutMs: args.timeoutMs,
    stdinText: args.stdinText,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_OPTIONAL_LOCKS: "0",
    },
  });
  if (!args.allowNonZero && result.code !== 0) {
    throw new CavtoolsExecError(
      "GIT_COMMAND_FAILED",
      `git ${args.argv.join(" ")} failed (${result.code}): ${s(result.stderr || result.stdout) || "command failed"}`,
      400
    );
  }
  return result;
}

async function ensureScmWorkspace(ctx: ExecContext): Promise<{
  repoDir: string;
  sync: { filesWritten: number; filesRemoved: number; bytesWritten: number; warnings: string[] };
}> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for SCM.", 400);
  const repoDir = path.join(CAVCODE_SCM_ROOT, ctx.accountId, String(ctx.project.id), "repo");
  await mkdir(repoDir, { recursive: true });
  const sync = await syncMountedWorkspaceToDirectory(ctx, repoDir);

  const gitDir = path.join(repoDir, ".git");
  const hasGit = await pathExists(gitDir);
  if (!hasGit) {
    const init = await runGitCommand({ cwd: repoDir, argv: ["init"], allowNonZero: true });
    if (init.code !== 0) {
      throw new CavtoolsExecError("GIT_UNAVAILABLE", "Git is unavailable in this runtime environment.", 500);
    }
    await runGitCommand({
      cwd: repoDir,
      argv: ["config", "user.name", `CavCode ${ctx.userId.slice(0, 8)}`],
      allowNonZero: true,
    });
    await runGitCommand({
      cwd: repoDir,
      argv: ["config", "user.email", `${ctx.userId.slice(0, 8)}@cavcode.local`],
      allowNonZero: true,
    });
    await runGitCommand({ cwd: repoDir, argv: ["add", "-A"], allowNonZero: true });
    await runGitCommand({
      cwd: repoDir,
      argv: ["commit", "-m", "Initial workspace import", "--no-gpg-sign"],
      allowNonZero: true,
    });
  }

  return { repoDir, sync };
}

function parseGitPorcelainStatus(stdout: string): Array<Record<string, string>> {
  const rows: Array<Record<string, string>> = [];
  const lines = String(stdout || "").split("\n").map((line) => line.trimEnd()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith("##")) {
      rows.push({
        type: "branch",
        summary: line.replace(/^##\s*/, ""),
      });
      continue;
    }
    if (line.length < 4) continue;
    const indexStatus = line.slice(0, 1);
    const worktreeStatus = line.slice(1, 2);
    const pathValue = line.slice(3).trim();
    rows.push({
      type: "file",
      path: pathValue,
      index: indexStatus,
      worktree: worktreeStatus,
      status: `${indexStatus}${worktreeStatus}`,
    });
  }
  return rows;
}

function parseGitBranchHeader(summary: string): {
  branch: string;
  upstream: string | null;
  ahead: number;
  behind: number;
  detached: boolean;
} {
  const line = s(summary || "");
  const out = {
    branch: "",
    upstream: null as string | null,
    ahead: 0,
    behind: 0,
    detached: false,
  };
  if (!line) return out;
  const stripped = line.replace(/^##\s*/, "");
  const [headPart, trailingRaw] = stripped.split("...", 2);
  const branch = s(headPart || "");
  out.branch = branch || "HEAD";
  out.detached = branch.toUpperCase() === "HEAD" || branch.includes("(no branch)");
  if (trailingRaw) {
    const trailing = s(trailingRaw || "");
    const bracketIdx = trailing.indexOf("[");
    if (bracketIdx >= 0) {
      out.upstream = s(trailing.slice(0, bracketIdx)) || null;
      const statChunk = trailing.slice(bracketIdx + 1).replace(/\]$/, "");
      const aheadMatch = statChunk.match(/ahead\s+(\d+)/i);
      const behindMatch = statChunk.match(/behind\s+(\d+)/i);
      if (aheadMatch) out.ahead = Math.max(0, Math.trunc(Number(aheadMatch[1]) || 0));
      if (behindMatch) out.behind = Math.max(0, Math.trunc(Number(behindMatch[1]) || 0));
    } else {
      out.upstream = trailing || null;
    }
  }
  return out;
}

async function readGitRemotes(repoDir: string): Promise<Array<{ name: string; fetch: string; push: string }>> {
  const result = await runGitCommand({ cwd: repoDir, argv: ["remote", "-v"], allowNonZero: true });
  const rows = String(result.stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const byName = new Map<string, { name: string; fetch: string; push: string }>();
  for (const row of rows) {
    const match = row.match(/^([^\s]+)\s+([^\s]+)\s+\((fetch|push)\)$/);
    if (!match) continue;
    const name = s(match[1]);
    const url = s(match[2]);
    const kind = s(match[3]);
    const existing = byName.get(name) || { name, fetch: "", push: "" };
    if (kind === "fetch") existing.fetch = url;
    if (kind === "push") existing.push = url;
    byName.set(name, existing);
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

async function readGitAheadBehindCounts(repoDir: string): Promise<{ ahead: number; behind: number }> {
  const result = await runGitCommand({
    cwd: repoDir,
    argv: ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"],
    allowNonZero: true,
  });
  if (result.code !== 0) return { ahead: 0, behind: 0 };
  const text = s(result.stdout || "");
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return { ahead: 0, behind: 0 };
  const behind = Number(parts[0]);
  const ahead = Number(parts[1]);
  return {
    ahead: Number.isFinite(ahead) ? Math.max(0, Math.trunc(ahead)) : 0,
    behind: Number.isFinite(behind) ? Math.max(0, Math.trunc(behind)) : 0,
  };
}

async function readGitConflictPaths(repoDir: string): Promise<string[]> {
  const result = await runGitCommand({
    cwd: repoDir,
    argv: ["diff", "--name-only", "--diff-filter=U"],
    allowNonZero: true,
  });
  return String(result.stdout || "")
    .split("\n")
    .map((line) => s(line))
    .filter(Boolean);
}

function isGitAuthFailure(text: string): boolean {
  const lower = s(text || "").toLowerCase();
  if (!lower) return false;
  return (
    lower.includes("authentication failed")
    || lower.includes("could not read username")
    || lower.includes("could not read password")
    || lower.includes("permission denied")
    || lower.includes("repository not found")
    || lower.includes("terminal prompts disabled")
    || lower.includes("fatal: could not")
  );
}

type GitUnifiedDiffHunk = {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  body: string[];
};

type GitUnifiedDiffFile = {
  header: string[];
  hunks: GitUnifiedDiffHunk[];
};

function parseGitUnifiedDiff(diffText: string): GitUnifiedDiffFile[] {
  const lines = String(diffText || "").replace(/\r/g, "").split("\n");
  const files: GitUnifiedDiffFile[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith("diff --git ")) {
      i += 1;
      continue;
    }
    const header: string[] = [lines[i]];
    i += 1;
    while (i < lines.length && !lines[i].startsWith("@@ ") && !lines[i].startsWith("diff --git ")) {
      header.push(lines[i]);
      i += 1;
    }
    const hunks: GitUnifiedDiffHunk[] = [];
    while (i < lines.length && !lines[i].startsWith("diff --git ")) {
      if (!lines[i].startsWith("@@ ")) {
        header.push(lines[i]);
        i += 1;
        continue;
      }
      const headerLine = lines[i];
      i += 1;
      const match = headerLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      const oldStart = Number(match?.[1] || 0);
      const oldCount = Number(match?.[2] || "1");
      const newStart = Number(match?.[3] || 0);
      const newCount = Number(match?.[4] || "1");
      const body: string[] = [];
      while (i < lines.length && !lines[i].startsWith("@@ ") && !lines[i].startsWith("diff --git ")) {
        body.push(lines[i]);
        i += 1;
      }
      hunks.push({
        header: headerLine,
        oldStart: Number.isFinite(oldStart) ? Math.max(0, Math.trunc(oldStart)) : 0,
        oldCount: Number.isFinite(oldCount) ? Math.max(0, Math.trunc(oldCount)) : 0,
        newStart: Number.isFinite(newStart) ? Math.max(0, Math.trunc(newStart)) : 0,
        newCount: Number.isFinite(newCount) ? Math.max(0, Math.trunc(newCount)) : 0,
        body,
      });
    }
    files.push({ header, hunks });
  }
  return files;
}

function gitHunkIntersectsLineRange(hunk: GitUnifiedDiffHunk, startLine: number, endLine: number): boolean {
  const start = Math.max(1, Math.trunc(startLine || 1));
  const end = Math.max(start, Math.trunc(endLine || start));
  let oldLine = hunk.oldStart || 1;
  let newLine = hunk.newStart || 1;
  if (hunk.body.length === 0) {
    const minLine = Math.min(oldLine, newLine);
    const maxLine = Math.max(oldLine + Math.max(0, hunk.oldCount - 1), newLine + Math.max(0, hunk.newCount - 1));
    return !(maxLine < start || minLine > end);
  }
  for (const row of hunk.body) {
    const lead = row.slice(0, 1);
    if (lead === "+") {
      if (newLine >= start && newLine <= end) return true;
      newLine += 1;
      continue;
    }
    if (lead === "-") {
      if (oldLine >= start && oldLine <= end) return true;
      oldLine += 1;
      continue;
    }
    if (lead === " ") {
      if (newLine >= start && newLine <= end) return true;
      oldLine += 1;
      newLine += 1;
    }
  }
  return false;
}

function buildGitSelectivePatch(diffText: string, startLine: number, endLine: number): string | null {
  const parsed = parseGitUnifiedDiff(diffText);
  const chunks: string[] = [];
  for (const file of parsed) {
    const selectedHunks = file.hunks.filter((hunk) => gitHunkIntersectsLineRange(hunk, startLine, endLine));
    if (!selectedHunks.length) continue;
    chunks.push(...file.header);
    for (const hunk of selectedHunks) {
      chunks.push(hunk.header);
      chunks.push(...hunk.body);
    }
  }
  if (!chunks.length) return null;
  return `${chunks.join("\n")}\n`;
}

function resolveGitConflictMarkersKeepBoth(content: string): string {
  const lines = String(content || "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!lines[i].startsWith("<<<<<<<")) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    i += 1;
    const ours: string[] = [];
    while (i < lines.length && !lines[i].startsWith("=======")) {
      ours.push(lines[i]);
      i += 1;
    }
    if (i < lines.length && lines[i].startsWith("=======")) i += 1;
    const theirs: string[] = [];
    while (i < lines.length && !lines[i].startsWith(">>>>>>>")) {
      theirs.push(lines[i]);
      i += 1;
    }
    if (i < lines.length && lines[i].startsWith(">>>>>>>")) i += 1;
    out.push(...ours);
    if (ours.length && theirs.length && ours[ours.length - 1] !== "") out.push("");
    out.push(...theirs);
  }
  return `${out.join("\n")}${content.endsWith("\n") ? "\n" : ""}`;
}

function isIndexableFilePath(relPath: string): boolean {
  const lower = relPath.toLowerCase();
  if (lower.startsWith(".git/")) return false;
  if (lower.includes("/node_modules/")) return false;
  if (lower.includes("/.next/")) return false;
  if (lower.includes("/dist/") || lower.includes("/build/") || lower.includes("/coverage/")) return false;
  return /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/i.test(lower);
}

function toRefContext(node: ts.Identifier): "read" | "write" | "type" {
  const parent = node.parent;
  if (!parent) return "read";
  if (ts.isTypeReferenceNode(parent) || ts.isExpressionWithTypeArguments(parent) || ts.isTypeQueryNode(parent)) return "type";
  if (
    ts.isParameter(parent)
    || ts.isVariableDeclaration(parent)
    || ts.isPropertyDeclaration(parent)
    || ts.isPropertySignature(parent)
    || ts.isBindingElement(parent)
    || ts.isFunctionDeclaration(parent)
    || ts.isClassDeclaration(parent)
    || ts.isInterfaceDeclaration(parent)
    || ts.isTypeAliasDeclaration(parent)
    || ts.isEnumDeclaration(parent)
  ) {
    return "write";
  }
  return "read";
}

function lineColFromPos(sf: ts.SourceFile, pos: number): { line: number; col: number } {
  const lc = sf.getLineAndCharacterOfPosition(Math.max(0, pos));
  return {
    line: (lc?.line || 0) + 1,
    col: (lc?.character || 0) + 1,
  };
}

function indexShardKey(filePath: string): string {
  const rel = normalizePath(filePath).replace(/^\/cavcode\/?/, "");
  const first = rel.split("/").filter(Boolean)[0];
  return first || "__root__";
}

type CavcodeIndexerFilePayload = {
  filePath: string;
  symbols: CavcodeIndexerSymbol[];
  references: CavcodeIndexerReference[];
  calls: CavcodeIndexerCall[];
  dependencies: CavcodeIndexerDependencyEdge[];
};

function coerceIndexerFilePayload(value: unknown): CavcodeIndexerFilePayload | null {
  const rec = asRecord(value);
  if (!rec) return null;
  const filePath = normalizePath(s(rec.filePath || ""));
  if (!filePath.startsWith("/cavcode/")) return null;
  const symbols = Array.isArray(rec.symbols) ? rec.symbols as CavcodeIndexerSymbol[] : [];
  const references = Array.isArray(rec.references) ? rec.references as CavcodeIndexerReference[] : [];
  const calls = Array.isArray(rec.calls) ? rec.calls as CavcodeIndexerCall[] : [];
  const dependencies = Array.isArray(rec.dependencies) ? rec.dependencies as CavcodeIndexerDependencyEdge[] : [];
  return {
    filePath,
    symbols,
    references,
    calls,
    dependencies,
  };
}

function buildIndexerFilePayload(filePath: string, raw: string): CavcodeIndexerFilePayload {
  const sf = ts.createSourceFile(filePath, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const symbols: CavcodeIndexerSymbol[] = [];
  const references: CavcodeIndexerReference[] = [];
  const calls: CavcodeIndexerCall[] = [];
  const dependencies: CavcodeIndexerDependencyEdge[] = [];

  const pushSymbol = (name: string, kind: string, node: ts.Node, exported: boolean) => {
    if (!name) return;
    if (symbols.length >= CAVCODE_INDEX_MAX_FILES * 20) return;
    const at = lineColFromPos(sf, node.getStart(sf));
    symbols.push({
      name,
      kind,
      file: filePath,
      line: at.line,
      col: at.col,
      exported,
    });
  };

  const pushReference = (name: string, node: ts.Identifier) => {
    if (!name) return;
    if (references.length >= CAVCODE_INDEX_MAX_FILES * 80) return;
    const at = lineColFromPos(sf, node.getStart(sf));
    references.push({
      name,
      file: filePath,
      line: at.line,
      col: at.col,
      context: toRefContext(node),
    });
  };

  const pushCall = (name: string, node: ts.Node) => {
    if (!name) return;
    if (calls.length >= CAVCODE_INDEX_MAX_FILES * 40) return;
    const at = lineColFromPos(sf, node.getStart(sf));
    calls.push({
      callee: name,
      file: filePath,
      line: at.line,
      col: at.col,
    });
  };

  const isNodeExported = (node: ts.Node): boolean => {
    const flags = ts.getCombinedModifierFlags(node as ts.Declaration);
    return (flags & ts.ModifierFlags.Export) !== 0 || (flags & ts.ModifierFlags.Default) !== 0;
  };

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const spec = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)
        ? s(node.moduleSpecifier.text)
        : "";
      if (spec) dependencies.push({ from: filePath, to: spec });
    }
    if (ts.isFunctionDeclaration(node) && node.name) pushSymbol(node.name.text, "function", node.name, isNodeExported(node));
    if (ts.isClassDeclaration(node) && node.name) pushSymbol(node.name.text, "class", node.name, isNodeExported(node));
    if (ts.isInterfaceDeclaration(node) && node.name) pushSymbol(node.name.text, "interface", node.name, isNodeExported(node));
    if (ts.isTypeAliasDeclaration(node) && node.name) pushSymbol(node.name.text, "type", node.name, isNodeExported(node));
    if (ts.isEnumDeclaration(node) && node.name) pushSymbol(node.name.text, "enum", node.name, isNodeExported(node));
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const parent = node.parent?.parent;
      pushSymbol(node.name.text, "variable", node.name, parent ? isNodeExported(parent) : false);
    }
    if (ts.isCallExpression(node)) {
      const expr = node.expression;
      if (ts.isIdentifier(expr)) pushCall(expr.text, expr);
      else if (ts.isPropertyAccessExpression(expr)) pushCall(expr.getText(sf), expr);
    }
    if (ts.isIdentifier(node)) {
      pushReference(node.text, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return {
    filePath,
    symbols,
    references,
    calls,
    dependencies,
  };
}

async function readIndexerShardRows(args: {
  accountId: string;
  projectId: number;
}): Promise<Array<{
  filePath: string;
  fileHash: string;
  shardKey: string;
  payload: unknown;
}>> {
  await ensureCavcodeInfraTables();
  return await prisma.$queryRaw<Array<{
    filePath: string;
    fileHash: string;
    shardKey: string;
    payload: unknown;
  }>>(
    Prisma.sql`
      SELECT "filePath", "fileHash", "shardKey", "payload"
      FROM "CavCodeIndexShard"
      WHERE "accountId" = ${args.accountId}
        AND "projectId" = ${args.projectId}
    `
  );
}

async function upsertIndexerShardRow(args: {
  accountId: string;
  projectId: number;
  filePath: string;
  fileHash: string;
  shardKey: string;
  payload: CavcodeIndexerFilePayload;
}): Promise<void> {
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeIndexShard" (
        "accountId",
        "projectId",
        "filePath",
        "fileHash",
        "shardKey",
        "payload"
      ) VALUES (
        ${args.accountId},
        ${args.projectId},
        ${args.filePath},
        ${args.fileHash},
        ${args.shardKey},
        CAST(${JSON.stringify(args.payload)} AS jsonb)
      )
      ON CONFLICT ("accountId", "projectId", "filePath")
      DO UPDATE SET
        "fileHash" = EXCLUDED."fileHash",
        "shardKey" = EXCLUDED."shardKey",
        "payload" = EXCLUDED."payload",
        "updatedAt" = CURRENT_TIMESTAMP
    `
  );
}

async function deleteIndexerShardRows(args: {
  accountId: string;
  projectId: number;
  filePaths: string[];
}): Promise<void> {
  if (!args.filePaths.length) return;
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      DELETE FROM "CavCodeIndexShard"
      WHERE "accountId" = ${args.accountId}
        AND "projectId" = ${args.projectId}
        AND "filePath" = ANY(${args.filePaths}::text[])
    `
  );
}

async function buildIndexerSnapshotFromWorkspaceDir(
  workspaceDir: string,
  opts?: { accountId?: string; projectId?: number }
): Promise<CavcodeIndexerSnapshot> {
  const allFiles = await collectLocalWorkspaceFiles(workspaceDir);
  const files = allFiles.filter((rel) => isIndexableFilePath(rel)).slice(0, CAVCODE_INDEX_MAX_FILES);
  const hasShardCache = Boolean(opts?.accountId && Number.isFinite(Number(opts?.projectId)) && Number(opts?.projectId) > 0);
  const existingRows = hasShardCache
    ? await readIndexerShardRows({
        accountId: String(opts?.accountId || ""),
        projectId: Math.trunc(Number(opts?.projectId || 0)),
      })
    : [];
  const existingByPath = new Map(existingRows.map((row) => [normalizePath(s(row.filePath || "")), row]));
  let bytesIndexed = 0;
  let changedFiles = 0;
  let unchangedFiles = 0;
  const symbols: CavcodeIndexerSymbol[] = [];
  const references: CavcodeIndexerReference[] = [];
  const calls: CavcodeIndexerCall[] = [];
  const dependencies: CavcodeIndexerDependencyEdge[] = [];
  const seenPaths = new Set<string>();
  const shardStats = new Map<string, { files: number; symbols: number; references: number; calls: number; dependencies: number }>();

  for (const rel of files) {
    if (bytesIndexed >= CAVCODE_INDEX_MAX_BYTES) break;
    const abs = path.join(workspaceDir, rel);
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue;
    }
    const size = Number.isFinite(Number(st.size)) ? Math.max(0, Math.trunc(Number(st.size))) : 0;
    if (size <= 0 || size > CAVCODE_INDEX_MAX_FILE_BYTES) continue;
    if (bytesIndexed + size > CAVCODE_INDEX_MAX_BYTES) break;
    bytesIndexed += size;
    const filePath = normalizePath(`/cavcode/${rel.replace(/\\/g, "/")}`);
    seenPaths.add(filePath);
    const fileHash = `${size}:${Math.max(0, Math.trunc(Number(st.mtimeMs || 0)))}`;
    let payload: CavcodeIndexerFilePayload | null = null;
    const cached = existingByPath.get(filePath);
    if (cached && s(cached.fileHash) === fileHash) {
      payload = coerceIndexerFilePayload(cached.payload);
      if (payload) unchangedFiles += 1;
    }
    if (!payload) {
      let raw = "";
      try {
        raw = await readFile(abs, "utf8");
      } catch {
        continue;
      }
      payload = buildIndexerFilePayload(filePath, raw);
      changedFiles += 1;
      if (hasShardCache) {
        await upsertIndexerShardRow({
          accountId: String(opts?.accountId || ""),
          projectId: Math.trunc(Number(opts?.projectId || 0)),
          filePath,
          fileHash,
          shardKey: indexShardKey(filePath),
          payload,
        });
      }
    }
    symbols.push(...payload.symbols);
    references.push(...payload.references);
    calls.push(...payload.calls);
    dependencies.push(...payload.dependencies);
    const shardKey = indexShardKey(filePath);
    const shard = shardStats.get(shardKey) || { files: 0, symbols: 0, references: 0, calls: 0, dependencies: 0 };
    shard.files += 1;
    shard.symbols += payload.symbols.length;
    shard.references += payload.references.length;
    shard.calls += payload.calls.length;
    shard.dependencies += payload.dependencies.length;
    shardStats.set(shardKey, shard);
  }

  let removedFiles = 0;
  if (hasShardCache) {
    const removed = Array.from(existingByPath.keys()).filter((filePath) => !seenPaths.has(filePath));
    removedFiles = removed.length;
    await deleteIndexerShardRows({
      accountId: String(opts?.accountId || ""),
      projectId: Math.trunc(Number(opts?.projectId || 0)),
      filePaths: removed,
    });
  }

  return {
    generatedAtISO: nowISO(),
    fileCount: allFiles.length,
    filesIndexed: files.length,
    bytesIndexed,
    symbols,
    references,
    calls,
    dependencies,
    shards: Array.from(shardStats.entries())
      .map(([key, row]) => ({
        key,
        files: row.files,
        symbols: row.symbols,
        references: row.references,
        calls: row.calls,
        dependencies: row.dependencies,
      }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    incremental: {
      changedFiles,
      unchangedFiles,
      removedFiles,
      shardCount: shardStats.size,
    },
  };
}

function indexSnapshotHash(snapshot: CavcodeIndexerSnapshot): string {
  const h = crypto.createHash("sha256");
  h.update(String(snapshot.generatedAtISO || ""));
  h.update(String(snapshot.filesIndexed || 0));
  h.update(String(snapshot.bytesIndexed || 0));
  h.update(String(snapshot.symbols.length || 0));
  h.update(String(snapshot.references.length || 0));
  h.update(String(snapshot.calls.length || 0));
  for (const sym of snapshot.symbols.slice(0, 4000)) {
    h.update(`${sym.name}|${sym.kind}|${sym.file}|${sym.line}|${sym.col}|${sym.exported ? "1" : "0"};`);
  }
  return h.digest("hex");
}

async function persistIndexerSnapshot(args: {
  accountId: string;
  projectId: number;
  snapshot: CavcodeIndexerSnapshot;
}): Promise<string> {
  await ensureCavcodeInfraTables();
  const hash = indexSnapshotHash(args.snapshot);
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeIndexSnapshot" (
        "accountId",
        "projectId",
        "hash",
        "snapshot"
      ) VALUES (
        ${args.accountId},
        ${args.projectId},
        ${hash},
        CAST(${JSON.stringify(args.snapshot)} AS jsonb)
      )
      ON CONFLICT ("accountId", "projectId")
      DO UPDATE SET
        "hash" = EXCLUDED."hash",
        "snapshot" = EXCLUDED."snapshot",
        "updatedAt" = CURRENT_TIMESTAMP
    `
  );
  return hash;
}

async function readIndexerSnapshot(args: {
  accountId: string;
  projectId: number;
}): Promise<{ hash: string; snapshot: CavcodeIndexerSnapshot } | null> {
  await ensureCavcodeInfraTables();
  const rows = await prisma.$queryRaw<Array<{ hash: string; snapshot: unknown }>>(
    Prisma.sql`
      SELECT "hash", "snapshot"
      FROM "CavCodeIndexSnapshot"
      WHERE "accountId" = ${args.accountId}
        AND "projectId" = ${args.projectId}
      LIMIT 1
    `
  );
  const row = rows[0];
  if (!row) return null;
  const snapshot = row.snapshot && typeof row.snapshot === "object" && !Array.isArray(row.snapshot)
    ? (row.snapshot as CavcodeIndexerSnapshot)
    : null;
  if (!snapshot) return null;
  return {
    hash: s(row.hash),
    snapshot,
  };
}

function parseNamedFlag(tokens: string[], name: string): string | null {
  const plain = `--${name}`;
  const equals = `--${name}=`;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = s(tokens[i] || "");
    if (!token) continue;
    if (token === plain) return s(tokens[i + 1] || "") || null;
    if (token.startsWith(equals)) return s(token.slice(equals.length)) || null;
  }
  return null;
}

function semanticTokens(input: string): string[] {
  return s(input)
    .toLowerCase()
    .split(/[^a-z0-9_]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function semanticScore(queryTokens: string[], target: string): number {
  if (!queryTokens.length) return 0;
  const targetTokens = semanticTokens(target);
  if (!targetTokens.length) return 0;
  let score = 0;
  for (const token of queryTokens) {
    if (targetTokens.includes(token)) score += 5;
    else {
      for (const candidate of targetTokens) {
        if (candidate.startsWith(token) || token.startsWith(candidate)) {
          score += 2;
          break;
        }
      }
      if (target.includes(token)) score += 1;
    }
  }
  return score;
}

async function runRipgrepSearch(args: {
  ctx: ExecContext;
  repoDir: string;
  pattern: string;
  relPath: string;
  glob?: string | null;
  maxMatches: number;
}): Promise<{
  matches: Array<{ file: string; line: number; col: number; text: string }>;
  elapsedMs: number;
  exitCode: number;
  stderr: string;
  streamedChunks: number;
}> {
  const started = Date.now();
  const argv = ["--json", "--line-number", "--column", "--color", "never"];
  if (args.glob) {
    argv.push("--glob", String(args.glob));
  }
  argv.push(args.pattern);
  if (args.relPath && args.relPath !== ".") argv.push(args.relPath);
  const child = spawn("rg", argv, {
    cwd: args.repoDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  const matches: Array<{ file: string; line: number; col: number; text: string }> = [];
  let stdoutPartial = "";
  let stderrBuffer = "";
  let streamedChunks = 0;
  let killedByLimit = false;

  const publishChunk = (force = false) => {
    if (!matches.length) return;
    if (!force && matches.length % 40 !== 0) return;
    streamedChunks += 1;
    const tail = matches.slice(Math.max(0, matches.length - 40)).map((row) => ({
      file: row.file,
      line: row.line,
      col: row.col,
      text: row.text,
    }));
    void publishCavcodeEvent(args.ctx, "search.rg.chunk", {
      pattern: args.pattern,
      relPath: args.relPath,
      count: matches.length,
      chunk: tail,
      chunkSeq: streamedChunks,
    });
  };

  const parseLine = (line: string) => {
    if (!line.trim()) return;
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = s(parsed.type || "");
    if (type !== "match") return;
    const data = asRecord(parsed.data);
    const pathText = s(asRecord(data?.path)?.text || "");
    if (!pathText) return;
    const lineNum = Number(data?.line_number);
    const submatches = Array.isArray(data?.submatches) ? data?.submatches : [];
    const firstMatch = asRecord(submatches[0]);
    const start = Number(firstMatch?.start);
    const lineText = s(asRecord(data?.lines)?.text || "");
    const result = {
      file: normalizePath(`/cavcode/${pathText.replace(/\\/g, "/").replace(/^\/+/, "")}`),
      line: Number.isFinite(lineNum) && Number.isInteger(lineNum) && lineNum > 0 ? Math.trunc(lineNum) : 1,
      col: Number.isFinite(start) && Number.isInteger(start) ? Math.max(1, Math.trunc(start) + 1) : 1,
      text: lineText,
    };
    matches.push(result);
    if (matches.length >= args.maxMatches) {
      killedByLimit = true;
      try { child.kill("SIGTERM"); } catch {}
    }
    publishChunk(false);
  };

  const processStdoutChunk = (chunk: Buffer | string) => {
    const text = String(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk || "");
    const joined = `${stdoutPartial}${text}`.replace(/\r/g, "");
    const lines = joined.split("\n");
    stdoutPartial = lines.pop() || "";
    for (const line of lines) {
      parseLine(line);
    }
  };

  child.stdout?.on("data", (chunk) => {
    processStdoutChunk(chunk);
  });
  child.stderr?.on("data", (chunk) => {
    stderrBuffer += String(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk || "");
  });

  const exitCode = await new Promise<number>((resolve) => {
    child.on("error", () => resolve(2));
    child.on("exit", (code) => resolve(Number.isFinite(Number(code)) ? Math.trunc(Number(code)) : 2));
    child.on("close", () => {
      const trailing = stdoutPartial.replace(/\r/g, "");
      stdoutPartial = "";
      if (trailing) parseLine(trailing);
      publishChunk(true);
    });
  });

  return {
    matches,
    elapsedMs: Date.now() - started,
    exitCode: killedByLimit && exitCode > 1 ? 0 : exitCode,
    stderr: stderrBuffer.replace(/\r/g, "").trim(),
    streamedChunks,
  };
}

type CavcodeTemplateSpec = {
  id: "website" | "software" | "game";
  label: string;
  files: Array<{ relPath: string; mimeType: string; content: string }>;
};

const CAVCODE_TEMPLATES: CavcodeTemplateSpec[] = [
  {
    id: "website",
    label: "Website Starter",
    files: [
      {
        relPath: "package.json",
        mimeType: "application/json",
        content: JSON.stringify({
          name: "cavcode-website",
          private: true,
          scripts: {
            dev: "vite",
            build: "vite build",
            test: "echo \"No tests yet\"",
          },
          devDependencies: {
            vite: "^5.4.0",
          },
        }, null, 2),
      },
      {
        relPath: "index.html",
        mimeType: "text/html; charset=utf-8",
        content: "<!doctype html>\n<html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><title>CavCode Website</title><link rel=\"stylesheet\" href=\"./src/styles.css\"></head><body><main id=\"app\"></main><script type=\"module\" src=\"./src/main.js\"></script></body></html>\n",
      },
      {
        relPath: "src/main.js",
        mimeType: "text/javascript; charset=utf-8",
        content: "const root = document.getElementById('app');\nif (root) root.innerHTML = '<h1>CavCode Website Starter</h1><p>Edit src/main.js to begin.</p>';\n",
      },
      {
        relPath: "src/styles.css",
        mimeType: "text/css; charset=utf-8",
        content: "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:2rem;background:#f4f5f7;color:#1b1f24}h1{margin:.2rem 0}\n",
      },
    ],
  },
  {
    id: "software",
    label: "Node Software Starter",
    files: [
      {
        relPath: "package.json",
        mimeType: "application/json",
        content: JSON.stringify({
          name: "cavcode-software",
          private: true,
          type: "module",
          scripts: {
            dev: "node src/index.js",
            build: "echo \"No build step\"",
            test: "node --test",
          },
        }, null, 2),
      },
      {
        relPath: "src/index.js",
        mimeType: "text/javascript; charset=utf-8",
        content: "export function boot(){return 'CavCode Software starter online';}\nif (import.meta.url === `file://${process.argv[1]}`) console.log(boot());\n",
      },
      {
        relPath: "test/basic.test.js",
        mimeType: "text/javascript; charset=utf-8",
        content: "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { boot } from '../src/index.js';\n\ntest('boot()', () => {\n  assert.equal(boot(), 'CavCode Software starter online');\n});\n",
      },
    ],
  },
  {
    id: "game",
    label: "Canvas Game Starter",
    files: [
      {
        relPath: "package.json",
        mimeType: "application/json",
        content: JSON.stringify({
          name: "cavcode-game",
          private: true,
          scripts: {
            dev: "vite",
            build: "vite build",
            test: "echo \"No tests yet\"",
          },
          devDependencies: {
            vite: "^5.4.0",
          },
        }, null, 2),
      },
      {
        relPath: "index.html",
        mimeType: "text/html; charset=utf-8",
        content: "<!doctype html>\n<html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>CavCode Game</title></head><body><canvas id=\"game\" width=\"960\" height=\"540\"></canvas><script type=\"module\" src=\"./src/main.js\"></script></body></html>\n",
      },
      {
        relPath: "src/main.js",
        mimeType: "text/javascript; charset=utf-8",
        content: "const canvas = document.getElementById('game');\nconst ctx = canvas?.getContext('2d');\nlet x = 40;\nfunction frame(){\n  if(!ctx||!canvas) return;\n  ctx.fillStyle = '#0f172a';\n  ctx.fillRect(0,0,canvas.width,canvas.height);\n  ctx.fillStyle = '#22d3ee';\n  ctx.fillRect(x,220,60,60);\n  x = (x + 2) % (canvas.width + 60);\n  requestAnimationFrame(frame);\n}\nframe();\n",
      },
    ],
  },
];

function pickTemplateById(raw: string): CavcodeTemplateSpec | null {
  const id = s(raw).toLowerCase();
  return CAVCODE_TEMPLATES.find((item) => item.id === id) || null;
}

async function getCloudNodeByPath(accountId: string, sourcePath: string): Promise<CloudNode> {
  const path = normalizePath(sourcePath);
  const [folder, file] = await Promise.all([
    prisma.cavCloudFolder.findFirst({
      where: {
        accountId,
        path,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        path: true,
        parentId: true,
        updatedAt: true,
        createdAt: true,
      },
    }),
    prisma.cavCloudFile.findFirst({
      where: {
        accountId,
        path,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        path: true,
        folderId: true,
        mimeType: true,
        r2Key: true,
        bytes: true,
        updatedAt: true,
        sha256: true,
      },
    }),
  ]);

  return { folder, file };
}

async function getSafeNodeByPath(accountId: string, sourcePath: string): Promise<SafeNode> {
  const path = normalizePath(sourcePath);
  if (path === "/") {
    await cavsafeGetRootFolder({ accountId });
  }
  const [folder, file] = await Promise.all([
    prisma.cavSafeFolder.findFirst({
      where: {
        accountId,
        path,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        path: true,
        parentId: true,
        updatedAt: true,
        createdAt: true,
      },
    }),
    prisma.cavSafeFile.findFirst({
      where: {
        accountId,
        path,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        path: true,
        folderId: true,
        mimeType: true,
        r2Key: true,
        bytes: true,
        updatedAt: true,
        sha256: true,
      },
    }),
  ]);

  return { folder, file };
}

function assertCavsafeOwnerOnly(ctx: ExecContext) {
  if (ctx.memberRole !== "OWNER") {
    throw new CavtoolsExecError(
      "CAVSAFE_OWNER_ONLY",
      "CavSafe in CavTools is restricted to the workspace owner.",
      403,
      "CAVSAFE_OWNER_ONLY"
    );
  }
}

async function requireCloudPermission(ctx: ExecContext, args: {
  action:
    | "CREATE_FOLDER"
    | "UPLOAD_FILE"
    | "EDIT_FILE_CONTENT"
    | "RENAME_MOVE_FILE"
    | "RENAME_MOVE_FOLDER"
    | "DELETE_TO_TRASH"
    | "SHARE_READ_ONLY"
    | "PUBLISH_ARTIFACT"
    | "MOUNT_CAVCODE";
  resourceType?: "FILE" | "FOLDER" | "PROJECT";
  resourceId?: string | number;
  neededPermission?: CavEffectivePermission;
}) {
  await assertCavCloudActionAllowed({
    accountId: ctx.accountId,
    userId: ctx.userId,
    action: args.action,
    resourceType: args.resourceType,
    resourceId: args.resourceId,
    neededPermission: args.neededPermission,
    errorCode: "UNAUTHORIZED",
  });
}

async function ensureCavsafeEntitlement(ctx: ExecContext) {
  assertCavsafeOwnerOnly(ctx);
  if (!ctx.includeCavsafe) {
    // Fallback verification in case request context was initialized before a plan upgrade.
    try {
      await requirePremiumEntitlement({ accountId: ctx.accountId });
    } catch {
      throw new CavtoolsExecError(
        "CAVSAFE_PLAN_REQUIRED",
        "CavSafe access requires a Premium or Premium Plus workspace plan.",
        403,
        "CAVSAFE_PLAN_REQUIRED"
      );
    }
  }
}

async function requireSafeRole(ctx: ExecContext, itemId: string, minRole: "VIEWER" | "EDITOR" | "OWNER") {
  void itemId;
  void minRole;
  await ensureCavsafeEntitlement(ctx);
  // CavTools command plane is owner-authorized for CavSafe.
  // Owner has full access to their own secure namespace.
  return { role: "OWNER" as const };
}

async function cavcloudList(ctx: ExecContext, virtualPath: string): Promise<{ cwd: string; items: CavtoolsFsItem[] }> {
  const sourcePath = toSourcePath("/cavcloud", virtualPath);
  const node = await getCloudNodeByPath(ctx.accountId, sourcePath);

  if (node.file) {
    await requireCloudPermission(ctx, {
      action: "EDIT_FILE_CONTENT",
      resourceType: "FILE",
      resourceId: node.file.id,
      neededPermission: "VIEW",
    });

    return {
      cwd: toNamespacePath("/cavcloud", sourcePath),
      items: [
        {
          type: "file",
          namespace: "cavcloud",
          name: node.file.name,
          path: toNamespacePath("/cavcloud", node.file.path),
          sizeBytes: toSafeNumber(node.file.bytes),
          mimeType: node.file.mimeType,
          updatedAtISO: node.file.updatedAt.toISOString(),
        },
      ],
    };
  }

  if (!node.folder) {
    throw new CavtoolsExecError("PATH_NOT_FOUND", `Path not found: ${virtualPath}`, 404);
  }

  await requireCloudPermission(ctx, {
    action: "EDIT_FILE_CONTENT",
    resourceType: "FOLDER",
    resourceId: node.folder.id,
    neededPermission: "VIEW",
  });

  const tree = await cavcloudTreeLite({
    accountId: ctx.accountId,
    folderPath: sourcePath,
  });

  const items: CavtoolsFsItem[] = [
    ...tree.folders.map((folder) => ({
      type: "folder" as const,
      namespace: "cavcloud" as const,
      name: folder.name,
      path: toNamespacePath("/cavcloud", folder.path),
      updatedAtISO: folder.updatedAtISO,
    })),
    ...tree.files.map((file) => ({
      type: "file" as const,
      namespace: "cavcloud" as const,
      name: file.name,
      path: toNamespacePath("/cavcloud", file.path),
      sizeBytes: Number(file.bytes),
      mimeType: file.mimeType,
      updatedAtISO: file.updatedAtISO,
    })),
  ];

  items.sort((left, right) => {
    if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  return {
    cwd: toNamespacePath("/cavcloud", tree.folder.path),
    items: items.slice(0, MAX_LIST_ROWS),
  };
}

async function cavsafeList(ctx: ExecContext, virtualPath: string): Promise<{ cwd: string; items: CavtoolsFsItem[] }> {
  await ensureCavsafeEntitlement(ctx);
  const sourcePath = toSourcePath("/cavsafe", virtualPath);
  const node = await getSafeNodeByPath(ctx.accountId, sourcePath);

  if (node.file) {
    return {
      cwd: toNamespacePath("/cavsafe", sourcePath),
      items: [
        {
          type: "file",
          namespace: "cavsafe",
          name: node.file.name,
          path: toNamespacePath("/cavsafe", node.file.path),
          sizeBytes: toSafeNumber(node.file.bytes),
          mimeType: node.file.mimeType,
          updatedAtISO: node.file.updatedAt.toISOString(),
        },
      ],
    };
  }

  if (!node.folder) {
    throw new CavtoolsExecError(
      "PATH_NOT_FOUND",
      `Path not found: ${virtualPath}`,
      404
    );
  }

  const tree = await cavsafeTreeLite({
    accountId: ctx.accountId,
    folderPath: sourcePath,
  });

  const items = [
    ...tree.folders.map((folder) => ({
      type: "folder" as const,
      namespace: "cavsafe" as const,
      name: folder.name,
      path: toNamespacePath("/cavsafe", folder.path),
      updatedAtISO: folder.updatedAtISO,
    })),
    ...tree.files.map((file) => ({
      type: "file" as const,
      namespace: "cavsafe" as const,
      name: file.name,
      path: toNamespacePath("/cavsafe", file.path),
      sizeBytes: Number(file.bytes),
      mimeType: file.mimeType,
      updatedAtISO: file.updatedAtISO,
    })),
  ].sort((left, right) => {
    if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  return {
    cwd: toNamespacePath("/cavsafe", tree.folder.path),
    items: items.slice(0, MAX_LIST_ROWS),
  };
}

function normalizeMountPath(path: string): string {
  const normalized = normalizePath(path);
  if (normalized === "/") return "/";
  return normalized.replace(/\/+$/, "");
}

async function cavcodeMounts(ctx: ExecContext): Promise<MountRow[]> {
  if (!ctx.project?.id) return [];
  const mountsRaw = await loadProjectMounts(ctx.accountId, ctx.project.id, {
    includeCavsafe: ctx.includeCavsafe,
  });
  const mounts = (mountsRaw as unknown as MountRow[])
    .filter((mount) => !!mount.folder && !mount.folder?.deletedAt)
    .sort((left, right) => {
      const len = normalizeMountPath(right.mountPath).length - normalizeMountPath(left.mountPath).length;
      if (len !== 0) return len;
      const pr = Number(right.priority || 0) - Number(left.priority || 0);
      if (pr !== 0) return pr;
      return s(left.id).localeCompare(s(right.id));
    });
  return mounts;
}

function sourcePathFromMount(mount: MountRow, relPath: string): string {
  const base = normalizePath(mount.folder?.path || "/");
  const rel = normalizePath(relPath || "/");
  if (rel === "/") return base;
  if (base === "/") return normalizePath(rel);
  return normalizePath(`${base}${rel}`);
}

function virtualPathFromMount(mount: MountRow, sourcePath: string): string {
  const mountPath = normalizeMountPath(mount.mountPath);
  const base = normalizePath(mount.folder?.path || "/");
  const src = normalizePath(sourcePath || "/");

  let suffix = "";
  if (base === "/") {
    suffix = src;
  } else if (src === base) {
    suffix = "/";
  } else if (src.startsWith(`${base}/`)) {
    suffix = src.slice(base.length);
  } else {
    suffix = "/";
  }

  const joined = mountPath === "/"
    ? suffix
    : suffix === "/"
    ? mountPath
    : `${mountPath}${suffix}`;

  const normalized = normalizePath(joined || "/");
  if (normalized === "/") return "/cavcode";
  return `/cavcode${normalized}`;
}

function findMountForVirtualPath(mounts: MountRow[], virtualSubPath: string): ResolvedMountPath | null {
  const target = normalizePath(virtualSubPath || "/");

  for (const mount of mounts) {
    const mountPath = normalizeMountPath(mount.mountPath);
    const match = mountPath === "/"
      ? target.startsWith("/")
      : target === mountPath || target.startsWith(`${mountPath}/`);

    if (!match) continue;

    const rel = mountPath === "/"
      ? target
      : target === mountPath
      ? "/"
      : target.slice(mountPath.length);

    return {
      mount,
      sourceType: mount.sourceType,
      relPath: normalizePath(rel || "/"),
      sourcePath: sourcePathFromMount(mount, rel || "/"),
    };
  }

  return null;
}

function listVirtualMountChildren(mounts: MountRow[], parentSubPath: string): CavtoolsFsItem[] {
  const parent = normalizePath(parentSubPath || "/");
  const names = new Map<string, string>();

  for (const mount of mounts) {
    const mountPath = normalizeMountPath(mount.mountPath);
    if (parent !== "/" && !(mountPath === parent || mountPath.startsWith(`${parent}/`))) {
      continue;
    }

    let rest = "";
    if (parent === "/") {
      rest = mountPath;
    } else if (mountPath === parent) {
      continue;
    } else {
      rest = mountPath.slice(parent.length);
    }

    const seg = rest.split("/").filter(Boolean)[0];
    if (!seg) continue;
    names.set(seg, seg);
  }

  return Array.from(names.values())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => {
      const path = parent === "/" ? `/cavcode/${name}` : `/cavcode${parent}/${name}`;
      return {
        type: "folder" as const,
        namespace: "cavcode" as const,
        name,
        path: normalizePath(path),
      };
    });
}

async function listCavcode(ctx: ExecContext, virtualPath: string): Promise<{ cwd: string; items: CavtoolsFsItem[] }> {
  if (!ctx.project?.id) {
    throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for /cavcode.", 400);
  }

  await assertCavCodeProjectAccess({
    accountId: ctx.accountId,
    userId: ctx.userId,
    projectId: ctx.project.id,
    needed: "VIEW",
    errorCode: "UNAUTHORIZED",
  });

  const mounts = await cavcodeMounts(ctx);
  const sub = normalizePath(virtualPath === "/cavcode" ? "/" : virtualPath.slice("/cavcode".length));

  const mountMatch = findMountForVirtualPath(mounts, sub);
  if (!mountMatch) {
    return {
      cwd: normalizePath(virtualPath),
      items: listVirtualMountChildren(mounts, sub),
    };
  }

  const mountPath = normalizeMountPath(mountMatch.mount.mountPath);
  if (sub !== mountPath && !sub.startsWith(`${mountPath}/`) && mountPath !== "/") {
    return {
      cwd: normalizePath(virtualPath),
      items: listVirtualMountChildren(mounts, sub),
    };
  }

  const sourceType = mountMatch.sourceType;
  const sourcePath = mountMatch.sourcePath;

  if (sourceType === "CAVCLOUD") {
    const tree = await cavcloudTreeLite({
      accountId: ctx.accountId,
      folderPath: sourcePath,
    });

    const folderNode = await prisma.cavCloudFolder.findFirst({
      where: {
        accountId: ctx.accountId,
        path: sourcePath,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (folderNode?.id) {
      await requireCloudPermission(ctx, {
        action: "EDIT_FILE_CONTENT",
        resourceType: "FOLDER",
        resourceId: folderNode.id,
        neededPermission: "VIEW",
      });
    }

    const items: CavtoolsFsItem[] = [
      ...tree.folders.map((folder) => ({
        type: "folder" as const,
        namespace: "cavcode" as const,
        name: folder.name,
        path: virtualPathFromMount(mountMatch.mount, folder.path),
        updatedAtISO: folder.updatedAtISO,
        readOnly: mountMatch.mount.mode !== "READ_WRITE",
      })),
      ...tree.files.map((file) => ({
        type: "file" as const,
        namespace: "cavcode" as const,
        name: file.name,
        path: virtualPathFromMount(mountMatch.mount, file.path),
        sizeBytes: Number(file.bytes),
        mimeType: file.mimeType,
        updatedAtISO: file.updatedAtISO,
        readOnly: mountMatch.mount.mode !== "READ_WRITE",
      })),
    ].sort((left, right) => {
      if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
      return left.name.localeCompare(right.name);
    });

    return {
      cwd: virtualPathFromMount(mountMatch.mount, tree.folder.path),
      items: items.slice(0, MAX_LIST_ROWS),
    };
  }

  await ensureCavsafeEntitlement(ctx);
  const safeTree = await cavsafeTreeLite({
    accountId: ctx.accountId,
    folderPath: sourcePath,
  });

  const rootFolder = await prisma.cavSafeFolder.findFirst({
    where: {
      accountId: ctx.accountId,
      path: sourcePath,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });
  if (rootFolder?.id) {
    await requireSafeRole(ctx, rootFolder.id, "VIEWER");
  }

  const safeItems: CavtoolsFsItem[] = [];
  for (const folder of safeTree.folders) {
    try {
      await requireSafeRole(ctx, folder.id, "VIEWER");
      safeItems.push({
        type: "folder",
        namespace: "cavcode",
        name: folder.name,
        path: virtualPathFromMount(mountMatch.mount, folder.path),
        updatedAtISO: folder.updatedAtISO,
        readOnly: true,
      });
    } catch {
      // hidden by ACL
    }
  }

  for (const file of safeTree.files) {
    try {
      await requireSafeRole(ctx, file.id, "VIEWER");
      safeItems.push({
        type: "file",
        namespace: "cavcode",
        name: file.name,
        path: virtualPathFromMount(mountMatch.mount, file.path),
        sizeBytes: Number(file.bytes),
        mimeType: file.mimeType,
        updatedAtISO: file.updatedAtISO,
        readOnly: true,
      });
    } catch {
      // hidden by ACL
    }
  }

  safeItems.sort((left, right) => {
    if (left.type !== right.type) return left.type === "folder" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });

  return {
    cwd: virtualPathFromMount(mountMatch.mount, safeTree.folder.path),
    items: safeItems.slice(0, MAX_LIST_ROWS),
  };
}

async function listForPath(ctx: ExecContext, path: string): Promise<{ cwd: string; items: CavtoolsFsItem[] }> {
  const normalized = normalizePath(path);
  const root = pathRoot(normalized);

  if (!root) throw new CavtoolsExecError("UNKNOWN_NAMESPACE", `Unknown namespace: ${path}`, 400);

  if (root === "/cavcloud") return cavcloudList(ctx, normalized);
  if (root === "/cavsafe") return cavsafeList(ctx, normalized);
  if (root === "/cavcode") return listCavcode(ctx, normalized);

  if (root === "/telemetry") {
    const items: CavtoolsFsItem[] = [
      "summary",
      "routes",
      "errors",
      "seo",
      "a11y",
      "geo",
      "scans",
      "export",
    ].map((name) => ({
      type: "file",
      namespace: "telemetry",
      name,
      path: `/telemetry/${name}`,
      readOnly: true,
    }));
    return { cwd: "/telemetry", items };
  }

  const workspaceItems: CavtoolsFsItem[] = [
    "status",
    "sites",
    "members",
    "guardrails",
    "notices",
  ].map((name) => ({
    type: "file",
    namespace: "workspace",
    name,
    path: `/workspace/${name}`,
    readOnly: true,
  }));

  return {
    cwd: "/workspace",
    items: workspaceItems,
  };
}

async function readCloudFileText(ctx: ExecContext, virtualPath: string): Promise<CavtoolsFileReadOutput> {
  const sourcePath = toSourcePath("/cavcloud", virtualPath);
  const node = await getCloudNodeByPath(ctx.accountId, sourcePath);
  if (!node.file) throw new CavtoolsExecError("FILE_NOT_FOUND", `File not found: ${virtualPath}`, 404);

  await requireCloudPermission(ctx, {
    action: "EDIT_FILE_CONTENT",
    resourceType: "FILE",
    resourceId: node.file.id,
    neededPermission: "VIEW",
  });

  if (!maybeTextMimeType(node.file.mimeType)) {
    throw new CavtoolsExecError(
      "BINARY_FILE",
      `${virtualPath} is binary (${node.file.mimeType}). Use open to stream/download this file.`,
      400
    );
  }

  const stream = await getCavcloudObjectStream({ objectKey: node.file.r2Key });
  if (!stream) throw new CavtoolsExecError("FILE_NOT_FOUND", `File content missing for ${virtualPath}.`, 404);

  const content = await readObjectText(stream.body);
  const latestVersion = await prisma.cavCloudFileVersion.findFirst({
    where: {
      accountId: ctx.accountId,
      fileId: node.file.id,
    },
    orderBy: {
      versionNumber: "desc",
    },
    select: {
      versionNumber: true,
    },
  });
  const versionNumber = Number.isFinite(Number(latestVersion?.versionNumber))
    ? Math.max(1, Math.trunc(Number(latestVersion?.versionNumber)))
    : null;

  return {
    ok: true,
    path: toNamespacePath("/cavcloud", node.file.path),
    mimeType: node.file.mimeType,
    readOnly: false,
    content,
    updatedAtISO: node.file.updatedAt.toISOString(),
    sha256: node.file.sha256 || null,
    versionNumber,
    etag: node.file.sha256 || null,
  };
}

async function readSafeFileText(ctx: ExecContext, virtualPath: string): Promise<CavtoolsFileReadOutput> {
  const sourcePath = toSourcePath("/cavsafe", virtualPath);
  const node = await getSafeNodeByPath(ctx.accountId, sourcePath);
  if (!node.file) throw new CavtoolsExecError("FILE_NOT_FOUND", `File not found: ${virtualPath}`, 404);

  await requireSafeRole(ctx, node.file.id, "VIEWER");

  const file = await cavsafeGetFileById({
    accountId: ctx.accountId,
    fileId: node.file.id,
    enforceReadTimelock: true,
  });

  if (!maybeTextMimeType(file.mimeType)) {
    throw new CavtoolsExecError(
      "BINARY_FILE",
      `${virtualPath} is binary (${file.mimeType}). Use open to stream/download this file.`,
      400
    );
  }

  const stream = await getCavsafeObjectStream({ objectKey: file.r2Key });
  if (!stream) throw new CavtoolsExecError("FILE_NOT_FOUND", `File content missing for ${virtualPath}.`, 404);
  const content = await readObjectText(stream.body);

  return {
    ok: true,
    path: toNamespacePath("/cavsafe", file.path),
    mimeType: file.mimeType,
    readOnly: true,
    content,
    updatedAtISO: file.updatedAtISO,
    sha256: file.sha256 || null,
    versionNumber: null,
    etag: file.sha256 || null,
  };
}

async function readCavcodeFileText(ctx: ExecContext, virtualPath: string): Promise<CavtoolsFileReadOutput> {
  if (!ctx.project?.id) {
    throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for /cavcode.", 400);
  }

  await assertCavCodeProjectAccess({
    accountId: ctx.accountId,
    userId: ctx.userId,
    projectId: ctx.project.id,
    needed: "VIEW",
    errorCode: "UNAUTHORIZED",
  });

  const mounts = await cavcodeMounts(ctx);
  const sub = normalizePath(virtualPath === "/cavcode" ? "/" : virtualPath.slice("/cavcode".length));
  const match = findMountForVirtualPath(mounts, sub);
  if (!match) throw new CavtoolsExecError("FILE_NOT_FOUND", `File not found: ${virtualPath}`, 404);

  if (match.sourceType === "CAVCLOUD") {
    const cloudVirtual = toNamespacePath("/cavcloud", match.sourcePath);
    const cloudRead = await readCloudFileText(ctx, cloudVirtual);
    return {
      ...cloudRead,
      path: virtualPath,
      readOnly: match.mount.mode !== "READ_WRITE",
      sha256: cloudRead.sha256 || null,
      versionNumber: cloudRead.versionNumber ?? null,
      etag: cloudRead.etag || cloudRead.sha256 || null,
    };
  }

  const safeVirtual = toNamespacePath("/cavsafe", match.sourcePath);
  const safeRead = await readSafeFileText(ctx, safeVirtual);
  return {
    ...safeRead,
    path: virtualPath,
    readOnly: true,
    sha256: safeRead.sha256 || null,
    versionNumber: safeRead.versionNumber ?? null,
    etag: safeRead.etag || safeRead.sha256 || null,
  };
}

async function writeCloudText(
  ctx: ExecContext,
  virtualPath: string,
  content: string,
  mimeType?: string | null,
  baseSha256?: string | null
): Promise<CavtoolsFileWriteOutput> {
  const sourcePath = toSourcePath("/cavcloud", virtualPath);
  const name = basename(sourcePath);
  if (!name) throw new CavtoolsExecError("BAD_PATH", `Invalid file path: ${virtualPath}`, 400);

  const node = await getCloudNodeByPath(ctx.accountId, sourcePath);
  if (node.file) {
    await requireCloudPermission(ctx, {
      action: "EDIT_FILE_CONTENT",
      resourceType: "FILE",
      resourceId: node.file.id,
      neededPermission: "EDIT",
    });
  } else {
    const parentPath = dirname(sourcePath);
    const parent = await prisma.cavCloudFolder.findFirst({
      where: {
        accountId: ctx.accountId,
        path: parentPath,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
    if (!parent?.id) throw new CavtoolsExecError("PARENT_NOT_FOUND", `Parent folder not found: ${parentPath}`, 404);
    await requireCloudPermission(ctx, {
      action: "UPLOAD_FILE",
      resourceType: "FOLDER",
      resourceId: parent.id,
      neededPermission: "EDIT",
    });
  }

  const normalizedBaseSha =
    typeof baseSha256 === "string" && /^[a-f0-9]{64}$/i.test(baseSha256.trim()) ? baseSha256.trim().toLowerCase() : null;

  if (node.file?.id) {
    try {
      const replaced = await cavcloudReplaceFileContent({
        accountId: ctx.accountId,
        operatorUserId: ctx.userId,
        fileId: node.file.id,
        mimeType: s(mimeType) || node.file.mimeType || "text/plain; charset=utf-8",
        body: Buffer.from(String(content || ""), "utf8"),
        baseSha256: normalizedBaseSha,
      });
      return {
        ok: true,
        path: toNamespacePath("/cavcloud", replaced.path),
        mimeType: replaced.mimeType,
        updatedAtISO: replaced.updatedAtISO,
        sha256: replaced.sha256 || null,
        versionNumber: Number.isFinite(Number(replaced.versionNumber))
          ? Math.max(1, Math.trunc(Number(replaced.versionNumber)))
          : null,
        etag: replaced.sha256 || null,
      };
    } catch (error) {
      const code = s((error as { code?: unknown })?.code).toUpperCase();
      if (code === "FILE_EDIT_CONFLICT") {
        const latestSha256 = s((error as { latestSha256?: unknown })?.latestSha256 || "").toLowerCase() || null;
        const latestVersionRaw = Number((error as { latestVersionNumber?: unknown })?.latestVersionNumber);
        const latestVersionNumber = Number.isFinite(latestVersionRaw) ? Math.max(1, Math.trunc(latestVersionRaw)) : null;
        const conflict = new CavtoolsExecError("FILE_EDIT_CONFLICT", "File changed since your last read.", 409);
        (conflict as CavtoolsExecError & { latestSha256?: string | null; latestVersionNumber?: number | null }).latestSha256 = latestSha256;
        (conflict as CavtoolsExecError & { latestSha256?: string | null; latestVersionNumber?: number | null }).latestVersionNumber =
          latestVersionNumber;
        throw conflict;
      }
      throw error;
    }
  }

  const saved = await cavcloudUpsertTextFile({
    accountId: ctx.accountId,
    operatorUserId: ctx.userId,
    folderPath: dirname(sourcePath),
    name,
    mimeType: s(mimeType) || "text/plain; charset=utf-8",
    content,
    source: "cavtools",
  });

  return {
    ok: true,
    path: toNamespacePath("/cavcloud", saved.path),
    mimeType: saved.mimeType,
    updatedAtISO: saved.updatedAtISO,
    sha256: saved.sha256 || null,
    versionNumber: null,
    etag: saved.sha256 || null,
  };
}

async function writeSafeText(ctx: ExecContext, virtualPath: string, content: string, mimeType?: string | null): Promise<CavtoolsFileWriteOutput> {
  await ensureCavsafeEntitlement(ctx);
  const sourcePath = toSourcePath("/cavsafe", virtualPath);
  const name = basename(sourcePath);
  if (!name) throw new CavtoolsExecError("BAD_PATH", `Invalid file path: ${virtualPath}`, 400);

  const node = await getSafeNodeByPath(ctx.accountId, sourcePath);
  if (node.file) {
    await requireSafeRole(ctx, node.file.id, "EDITOR");
  } else {
    const parentPath = dirname(sourcePath);
    const parent = await prisma.cavSafeFolder.findFirst({
      where: {
        accountId: ctx.accountId,
        path: parentPath,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!parent?.id) throw new CavtoolsExecError("PARENT_NOT_FOUND", `Parent folder not found: ${parentPath}`, 404);
    await requireSafeRole(ctx, parent.id, "EDITOR");
  }

  const saved = await cavsafeUpsertTextFile({
    accountId: ctx.accountId,
    operatorUserId: ctx.userId,
    folderPath: dirname(sourcePath),
    name,
    mimeType: s(mimeType) || "text/plain; charset=utf-8",
    content,
    source: "cavtools",
  });

  return {
    ok: true,
    path: toNamespacePath("/cavsafe", saved.path),
    mimeType: saved.mimeType,
    updatedAtISO: saved.updatedAtISO,
    sha256: saved.sha256 || null,
    versionNumber: null,
    etag: saved.sha256 || null,
  };
}

async function writeCavcodeText(
  ctx: ExecContext,
  virtualPath: string,
  content: string,
  mimeType?: string | null,
  baseSha256?: string | null
): Promise<CavtoolsFileWriteOutput> {
  if (!ctx.project?.id) {
    throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for /cavcode.", 400);
  }

  await assertCavCodeProjectAccess({
    accountId: ctx.accountId,
    userId: ctx.userId,
    projectId: ctx.project.id,
    needed: "EDIT",
    errorCode: "UNAUTHORIZED",
  });

  const mounts = await cavcodeMounts(ctx);
  const sub = normalizePath(virtualPath === "/cavcode" ? "/" : virtualPath.slice("/cavcode".length));
  const match = findMountForVirtualPath(mounts, sub);
  if (!match) throw new CavtoolsExecError("PATH_NOT_MOUNTED", `Path is not mounted in /cavcode: ${virtualPath}`, 404);

  if (match.mount.mode !== "READ_WRITE") {
    throw new CavtoolsExecError(
      "MOUNT_READ_ONLY",
      `Mount ${match.mount.mountPath} is read-only. Switch mount mode to READ_WRITE to edit files.`,
      403,
      "ROLE_BLOCKED"
    );
  }

  if (match.sourceType === "CAVCLOUD") {
    const written = await writeCloudText(ctx, toNamespacePath("/cavcloud", match.sourcePath), content, mimeType, baseSha256);
    return {
      ...written,
      path: virtualPath,
    };
  }

  const written = await writeSafeText(ctx, toNamespacePath("/cavsafe", match.sourcePath), content, mimeType);
  return {
    ...written,
    path: virtualPath,
  };
}

async function readFileText(ctx: ExecContext, path: string): Promise<CavtoolsFileReadOutput> {
  const normalized = normalizePath(path);
  const root = pathRoot(normalized);
  if (!root) throw new CavtoolsExecError("UNKNOWN_NAMESPACE", `Unknown namespace: ${path}`, 400);

  if (root === "/cavcloud") return readCloudFileText(ctx, normalized);
  if (root === "/cavsafe") return readSafeFileText(ctx, normalized);
  if (root === "/cavcode") return readCavcodeFileText(ctx, normalized);

  if (root === "/telemetry") {
    const sectionKey = s(normalized.slice("/telemetry".length).replace(/^\/+/, "") || "summary").toLowerCase();
    const section = await telemetrySection(ctx, sectionKey === "export" ? "summary" : sectionKey);
    const payload = sectionKey === "export"
      ? {
          exportedAtISO: nowISO(),
          projectId: ctx.project?.id || null,
          siteOrigin: ctx.siteOrigin || null,
          data: section,
        }
      : section;

    return {
      ok: true,
      path: normalized,
      mimeType: "application/json",
      readOnly: true,
      content: JSON.stringify(payload, null, 2),
      updatedAtISO: nowISO(),
    };
  }

  if (root === "/workspace") {
    const sectionKey = s(normalized.slice("/workspace".length).replace(/^\/+/, "") || "status").toLowerCase();
    let payload: unknown;
    if (sectionKey === "status") payload = await workspaceStatus(ctx);
    else if (sectionKey === "sites") payload = await workspaceSites(ctx);
    else if (sectionKey === "members") payload = await workspaceMembers(ctx);
    else if (sectionKey === "guardrails") payload = await workspaceGuardrails(ctx);
    else if (sectionKey === "notices") payload = await workspaceNotices(ctx);
    else throw new CavtoolsExecError("READ_NOT_SUPPORTED", `Cannot read ${normalized}.`, 400);

    return {
      ok: true,
      path: normalized,
      mimeType: "application/json",
      readOnly: true,
      content: JSON.stringify(payload, null, 2),
      updatedAtISO: nowISO(),
    };
  }

  throw new CavtoolsExecError("READ_NOT_SUPPORTED", `Cannot read ${normalized}.`, 400);
}

async function writeFileText(
  ctx: ExecContext,
  path: string,
  content: string,
  mimeType?: string | null,
  baseSha256?: string | null
): Promise<CavtoolsFileWriteOutput> {
  const normalized = normalizePath(path);
  const root = pathRoot(normalized);
  if (!root) throw new CavtoolsExecError("UNKNOWN_NAMESPACE", `Unknown namespace: ${path}`, 400);

  if (root === "/cavcloud") return writeCloudText(ctx, normalized, content, mimeType, baseSha256);
  if (root === "/cavsafe") return writeSafeText(ctx, normalized, content, mimeType);
  if (root === "/cavcode") {
    const out = await writeCavcodeText(ctx, normalized, content, mimeType, baseSha256);
    await publishCavcodeEvent(ctx, "file.write", {
      path: normalized,
      mimeType: out.mimeType,
      versionNumber: out.versionNumber || null,
      sha256: out.sha256 || null,
    });
    return out;
  }

  throw new CavtoolsExecError("WRITE_NOT_SUPPORTED", `Cannot write to ${normalized}.`, 400);
}

async function cloudMkdir(ctx: ExecContext, virtualPath: string): Promise<CavtoolsFsItem> {
  const sourcePath = toSourcePath("/cavcloud", virtualPath);
  const parentPath = dirname(sourcePath);
  const folderName = basename(sourcePath);
  if (!folderName) throw new CavtoolsExecError("BAD_PATH", `Invalid folder path: ${virtualPath}`, 400);

  const parent = await prisma.cavCloudFolder.findFirst({
    where: {
      accountId: ctx.accountId,
      path: parentPath,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });
  if (!parent?.id) throw new CavtoolsExecError("PARENT_NOT_FOUND", `Parent folder not found: ${parentPath}`, 404);

  await requireCloudPermission(ctx, {
    action: "CREATE_FOLDER",
    resourceType: "FOLDER",
    resourceId: parent.id,
    neededPermission: "EDIT",
  });

  const created = await cavcloudCreateFolder({
    accountId: ctx.accountId,
    operatorUserId: ctx.userId,
    parentPath,
    name: folderName,
  });

  return {
    type: "folder",
    namespace: "cavcloud",
    name: created.name,
    path: toNamespacePath("/cavcloud", created.path),
    updatedAtISO: created.updatedAtISO,
  };
}

async function safeMkdir(ctx: ExecContext, virtualPath: string): Promise<CavtoolsFsItem> {
  await ensureCavsafeEntitlement(ctx);
  const sourcePath = toSourcePath("/cavsafe", virtualPath);
  const parentPath = dirname(sourcePath);
  const folderName = basename(sourcePath);
  if (!folderName) throw new CavtoolsExecError("BAD_PATH", `Invalid folder path: ${virtualPath}`, 400);

  const parent = await prisma.cavSafeFolder.findFirst({
    where: {
      accountId: ctx.accountId,
      path: parentPath,
      deletedAt: null,
    },
    select: {
      id: true,
    },
  });
  if (!parent?.id) throw new CavtoolsExecError("PARENT_NOT_FOUND", `Parent folder not found: ${parentPath}`, 404);

  await requireSafeRole(ctx, parent.id, "EDITOR");

  const created = await cavsafeCreateFolder({
    accountId: ctx.accountId,
    operatorUserId: ctx.userId,
    parentPath,
    name: folderName,
  });

  return {
    type: "folder",
    namespace: "cavsafe",
    name: created.name,
    path: toNamespacePath("/cavsafe", created.path),
    updatedAtISO: created.updatedAtISO,
  };
}

async function cavcodeMkdir(ctx: ExecContext, virtualPath: string): Promise<CavtoolsFsItem> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found.", 400);
  await assertCavCodeProjectAccess({
    accountId: ctx.accountId,
    userId: ctx.userId,
    projectId: ctx.project.id,
    needed: "EDIT",
    errorCode: "UNAUTHORIZED",
  });

  const mounts = await cavcodeMounts(ctx);
  const sub = normalizePath(virtualPath === "/cavcode" ? "/" : virtualPath.slice("/cavcode".length));
  const match = findMountForVirtualPath(mounts, sub);
  if (!match) throw new CavtoolsExecError("PATH_NOT_MOUNTED", `Path is not mounted in /cavcode: ${virtualPath}`, 404);
  if (match.mount.mode !== "READ_WRITE") {
    throw new CavtoolsExecError("MOUNT_READ_ONLY", `Mount ${match.mount.mountPath} is read-only.`, 403, "ROLE_BLOCKED");
  }

  if (match.sourceType === "CAVCLOUD") {
    const created = await cloudMkdir(ctx, toNamespacePath("/cavcloud", match.sourcePath));
    return {
      ...created,
      namespace: "cavcode",
      path: virtualPath,
    };
  }

  const created = await safeMkdir(ctx, toNamespacePath("/cavsafe", match.sourcePath));
  return {
    ...created,
    namespace: "cavcode",
    path: virtualPath,
  };
}

async function rmPath(ctx: ExecContext, path: string): Promise<{ kind: "file" | "folder"; path: string }> {
  const normalized = normalizePath(path);
  const root = pathRoot(normalized);
  if (!root) throw new CavtoolsExecError("UNKNOWN_NAMESPACE", `Unknown namespace: ${path}`, 400);

  if (root === "/cavcloud") {
    const sourcePath = toSourcePath("/cavcloud", normalized);
    const node = await getCloudNodeByPath(ctx.accountId, sourcePath);
    if (node.file) {
      await requireCloudPermission(ctx, {
        action: "DELETE_TO_TRASH",
        resourceType: "FILE",
        resourceId: node.file.id,
        neededPermission: "EDIT",
      });
      await cavcloudSoftDeleteFile({
        accountId: ctx.accountId,
        operatorUserId: ctx.userId,
        fileId: node.file.id,
      });
      return { kind: "file", path: normalized };
    }
    if (node.folder) {
      await requireCloudPermission(ctx, {
        action: "DELETE_TO_TRASH",
        resourceType: "FOLDER",
        resourceId: node.folder.id,
        neededPermission: "EDIT",
      });
      await cavcloudSoftDeleteFolder({
        accountId: ctx.accountId,
        operatorUserId: ctx.userId,
        folderId: node.folder.id,
      });
      return { kind: "folder", path: normalized };
    }
    throw new CavtoolsExecError("PATH_NOT_FOUND", `Path not found: ${normalized}`, 404);
  }

  if (root === "/cavsafe") {
    const sourcePath = toSourcePath("/cavsafe", normalized);
    const node = await getSafeNodeByPath(ctx.accountId, sourcePath);
    if (node.file) {
      await requireSafeRole(ctx, node.file.id, "EDITOR");
      await cavsafeSoftDeleteFile({
        accountId: ctx.accountId,
        operatorUserId: ctx.userId,
        fileId: node.file.id,
      });
      return { kind: "file", path: normalized };
    }
    if (node.folder) {
      await requireSafeRole(ctx, node.folder.id, "EDITOR");
      await cavsafeSoftDeleteFolder({
        accountId: ctx.accountId,
        operatorUserId: ctx.userId,
        folderId: node.folder.id,
      });
      return { kind: "folder", path: normalized };
    }
    throw new CavtoolsExecError("PATH_NOT_FOUND", `Path not found: ${normalized}`, 404);
  }

  if (root === "/cavcode") {
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found.", 400);
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    const mounts = await cavcodeMounts(ctx);
    const sub = normalizePath(normalized === "/cavcode" ? "/" : normalized.slice("/cavcode".length));
    const match = findMountForVirtualPath(mounts, sub);
    if (!match) throw new CavtoolsExecError("PATH_NOT_MOUNTED", `Path is not mounted in /cavcode: ${normalized}`, 404);
    if (match.mount.mode !== "READ_WRITE") {
      throw new CavtoolsExecError("MOUNT_READ_ONLY", `Mount ${match.mount.mountPath} is read-only.`, 403, "ROLE_BLOCKED");
    }

    const namespacedPath = match.sourceType === "CAVCLOUD"
      ? toNamespacePath("/cavcloud", match.sourcePath)
      : toNamespacePath("/cavsafe", match.sourcePath);
    await rmPath(ctx, namespacedPath);
    return {
      kind: "file",
      path: normalized,
    };
  }

  throw new CavtoolsExecError("RM_UNSUPPORTED", `rm is not supported for ${root}.`, 400);
}

async function movePath(ctx: ExecContext, sourcePathArg: string, destPathArg: string): Promise<{ from: string; to: string }> {
  const sourcePath = normalizePath(sourcePathArg);
  const destPath = normalizePath(destPathArg);
  const sourceRoot = pathRoot(sourcePath);
  const destRoot = pathRoot(destPath);
  if (!sourceRoot || !destRoot || sourceRoot !== destRoot) {
    throw new CavtoolsExecError("MOVE_SCOPE_MISMATCH", "mv source and destination must be in the same namespace.", 400);
  }

  if (sourceRoot === "/cavcloud") {
    const srcSourcePath = toSourcePath("/cavcloud", sourcePath);
    const dstSourcePath = toSourcePath("/cavcloud", destPath);

    const srcNode = await getCloudNodeByPath(ctx.accountId, srcSourcePath);
    if (!srcNode.file && !srcNode.folder) throw new CavtoolsExecError("PATH_NOT_FOUND", `Path not found: ${sourcePath}`, 404);

    const targetAsFolder = await prisma.cavCloudFolder.findFirst({
      where: {
        accountId: ctx.accountId,
        path: dstSourcePath,
        deletedAt: null,
      },
      select: {
        id: true,
        path: true,
      },
    });

    const finalTargetPath = targetAsFolder
      ? normalizePath(`${dstSourcePath}/${srcNode.file?.name || srcNode.folder?.name || ""}`)
      : dstSourcePath;

    const finalParentPath = dirname(finalTargetPath);
    const finalName = basename(finalTargetPath);

    const parentFolder = await prisma.cavCloudFolder.findFirst({
      where: {
        accountId: ctx.accountId,
        path: finalParentPath,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!parentFolder?.id) {
      throw new CavtoolsExecError("PARENT_NOT_FOUND", `Destination parent folder not found: ${finalParentPath}`, 404);
    }

    if (srcNode.file) {
      await requireCloudPermission(ctx, {
        action: "RENAME_MOVE_FILE",
        resourceType: "FILE",
        resourceId: srcNode.file.id,
        neededPermission: "EDIT",
      });
      await requireCloudPermission(ctx, {
        action: "RENAME_MOVE_FILE",
        resourceType: "FOLDER",
        resourceId: parentFolder.id,
        neededPermission: "EDIT",
      });

      await cavcloudUpdateFile({
        accountId: ctx.accountId,
        operatorUserId: ctx.userId,
        fileId: srcNode.file.id,
        folderId: parentFolder.id,
        name: finalName,
      });
    } else if (srcNode.folder) {
      await requireCloudPermission(ctx, {
        action: "RENAME_MOVE_FOLDER",
        resourceType: "FOLDER",
        resourceId: srcNode.folder.id,
        neededPermission: "EDIT",
      });
      await requireCloudPermission(ctx, {
        action: "RENAME_MOVE_FOLDER",
        resourceType: "FOLDER",
        resourceId: parentFolder.id,
        neededPermission: "EDIT",
      });

      await cavcloudUpdateFolder({
        accountId: ctx.accountId,
        operatorUserId: ctx.userId,
        folderId: srcNode.folder.id,
        parentId: parentFolder.id,
        name: finalName,
      });
    }

    return { from: sourcePath, to: toNamespacePath("/cavcloud", finalTargetPath) };
  }

  if (sourceRoot === "/cavsafe") {
    const srcSourcePath = toSourcePath("/cavsafe", sourcePath);
    const dstSourcePath = toSourcePath("/cavsafe", destPath);

    const srcNode = await getSafeNodeByPath(ctx.accountId, srcSourcePath);
    if (!srcNode.file && !srcNode.folder) throw new CavtoolsExecError("PATH_NOT_FOUND", `Path not found: ${sourcePath}`, 404);

    const targetAsFolder = await prisma.cavSafeFolder.findFirst({
      where: {
        accountId: ctx.accountId,
        path: dstSourcePath,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    const finalTargetPath = targetAsFolder
      ? normalizePath(`${dstSourcePath}/${srcNode.file?.name || srcNode.folder?.name || ""}`)
      : dstSourcePath;

    const finalParentPath = dirname(finalTargetPath);
    const finalName = basename(finalTargetPath);

    const parentFolder = await prisma.cavSafeFolder.findFirst({
      where: {
        accountId: ctx.accountId,
        path: finalParentPath,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });

    if (!parentFolder?.id) {
      throw new CavtoolsExecError("PARENT_NOT_FOUND", `Destination parent folder not found: ${finalParentPath}`, 404);
    }

    if (srcNode.file) {
      await requireSafeRole(ctx, srcNode.file.id, "EDITOR");
      await requireSafeRole(ctx, parentFolder.id, "EDITOR");

      await cavsafeUpdateFile({
        accountId: ctx.accountId,
        operatorUserId: ctx.userId,
        fileId: srcNode.file.id,
        folderId: parentFolder.id,
        name: finalName,
      });
    } else if (srcNode.folder) {
      await requireSafeRole(ctx, srcNode.folder.id, "EDITOR");
      await requireSafeRole(ctx, parentFolder.id, "EDITOR");

      await cavsafeUpdateFolder({
        accountId: ctx.accountId,
        operatorUserId: ctx.userId,
        folderId: srcNode.folder.id,
        parentId: parentFolder.id,
        name: finalName,
      });
    }

    return { from: sourcePath, to: toNamespacePath("/cavsafe", finalTargetPath) };
  }

  if (sourceRoot === "/cavcode") {
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found.", 400);
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    const mounts = await cavcodeMounts(ctx);
    const sourceSub = normalizePath(sourcePath === "/cavcode" ? "/" : sourcePath.slice("/cavcode".length));
    const destSub = normalizePath(destPath === "/cavcode" ? "/" : destPath.slice("/cavcode".length));
    const srcMount = findMountForVirtualPath(mounts, sourceSub);
    const dstMount = findMountForVirtualPath(mounts, destSub);
    if (!srcMount || !dstMount || srcMount.mount.id !== dstMount.mount.id) {
      throw new CavtoolsExecError("MOVE_SCOPE_MISMATCH", "mv in /cavcode must stay inside a single mount.", 400);
    }
    if (srcMount.mount.mode !== "READ_WRITE") {
      throw new CavtoolsExecError("MOUNT_READ_ONLY", `Mount ${srcMount.mount.mountPath} is read-only.`, 403, "ROLE_BLOCKED");
    }

    const fromNs = srcMount.sourceType === "CAVCLOUD"
      ? toNamespacePath("/cavcloud", srcMount.sourcePath)
      : toNamespacePath("/cavsafe", srcMount.sourcePath);
    const toNs = dstMount.sourceType === "CAVCLOUD"
      ? toNamespacePath("/cavcloud", dstMount.sourcePath)
      : toNamespacePath("/cavsafe", dstMount.sourcePath);

    await movePath(ctx, fromNs, toNs);
    return {
      from: sourcePath,
      to: destPath,
    };
  }

  throw new CavtoolsExecError("MOVE_UNSUPPORTED", `mv is not supported for ${sourceRoot}.`, 400);
}

async function copyPath(ctx: ExecContext, sourcePathArg: string, destPathArg: string): Promise<{ from: string; to: string }> {
  const sourcePath = normalizePath(sourcePathArg);
  const destPath = normalizePath(destPathArg);
  const sourceRoot = pathRoot(sourcePath);
  const destRoot = pathRoot(destPath);
  if (!sourceRoot || !destRoot || sourceRoot !== destRoot) {
    throw new CavtoolsExecError("COPY_SCOPE_MISMATCH", "cp source and destination must be in the same namespace.", 400);
  }

  if (sourceRoot === "/cavcloud") {
    const srcSourcePath = toSourcePath("/cavcloud", sourcePath);
    const dstSourcePath = toSourcePath("/cavcloud", destPath);

    const srcNode = await getCloudNodeByPath(ctx.accountId, srcSourcePath);
    if (!srcNode.file) {
      throw new CavtoolsExecError("COPY_ONLY_FILE", "cp currently supports files only.", 400);
    }

    await requireCloudPermission(ctx, {
      action: "EDIT_FILE_CONTENT",
      resourceType: "FILE",
      resourceId: srcNode.file.id,
      neededPermission: "EDIT",
    });

    const duplicate = await cavcloudDuplicateFile({
      accountId: ctx.accountId,
      operatorUserId: ctx.userId,
      fileId: srcNode.file.id,
    });

    const targetFolder = await prisma.cavCloudFolder.findFirst({
      where: {
        accountId: ctx.accountId,
        path: dirname(dstSourcePath),
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
    if (!targetFolder?.id) throw new CavtoolsExecError("PARENT_NOT_FOUND", `Destination parent folder not found: ${dirname(dstSourcePath)}`, 404);

    await cavcloudUpdateFile({
      accountId: ctx.accountId,
      operatorUserId: ctx.userId,
      fileId: duplicate.id,
      folderId: targetFolder.id,
      name: basename(dstSourcePath),
    });

    return {
      from: sourcePath,
      to: toNamespacePath("/cavcloud", dstSourcePath),
    };
  }

  if (sourceRoot === "/cavsafe") {
    const srcSourcePath = toSourcePath("/cavsafe", sourcePath);
    const dstSourcePath = toSourcePath("/cavsafe", destPath);

    const srcNode = await getSafeNodeByPath(ctx.accountId, srcSourcePath);
    if (!srcNode.file) throw new CavtoolsExecError("COPY_ONLY_FILE", "cp currently supports files only.", 400);

    await requireSafeRole(ctx, srcNode.file.id, "EDITOR");

    const duplicate = await cavsafeDuplicateFile({
      accountId: ctx.accountId,
      operatorUserId: ctx.userId,
      fileId: srcNode.file.id,
    });

    const targetFolder = await prisma.cavSafeFolder.findFirst({
      where: {
        accountId: ctx.accountId,
        path: dirname(dstSourcePath),
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
    if (!targetFolder?.id) throw new CavtoolsExecError("PARENT_NOT_FOUND", `Destination parent folder not found: ${dirname(dstSourcePath)}`, 404);

    await cavsafeUpdateFile({
      accountId: ctx.accountId,
      operatorUserId: ctx.userId,
      fileId: duplicate.id,
      folderId: targetFolder.id,
      name: basename(dstSourcePath),
    });

    return {
      from: sourcePath,
      to: toNamespacePath("/cavsafe", dstSourcePath),
    };
  }

  if (sourceRoot === "/cavcode") {
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found.", 400);
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    const mounts = await cavcodeMounts(ctx);
    const sourceSub = normalizePath(sourcePath === "/cavcode" ? "/" : sourcePath.slice("/cavcode".length));
    const destSub = normalizePath(destPath === "/cavcode" ? "/" : destPath.slice("/cavcode".length));
    const srcMount = findMountForVirtualPath(mounts, sourceSub);
    const dstMount = findMountForVirtualPath(mounts, destSub);
    if (!srcMount || !dstMount || srcMount.mount.id !== dstMount.mount.id) {
      throw new CavtoolsExecError("COPY_SCOPE_MISMATCH", "cp in /cavcode must stay inside a single mount.", 400);
    }
    if (srcMount.mount.mode !== "READ_WRITE") {
      throw new CavtoolsExecError("MOUNT_READ_ONLY", `Mount ${srcMount.mount.mountPath} is read-only.`, 403, "ROLE_BLOCKED");
    }

    const fromNs = srcMount.sourceType === "CAVCLOUD"
      ? toNamespacePath("/cavcloud", srcMount.sourcePath)
      : toNamespacePath("/cavsafe", srcMount.sourcePath);
    const toNs = dstMount.sourceType === "CAVCLOUD"
      ? toNamespacePath("/cavcloud", dstMount.sourcePath)
      : toNamespacePath("/cavsafe", dstMount.sourcePath);
    await copyPath(ctx, fromNs, toNs);

    return {
      from: sourcePath,
      to: destPath,
    };
  }

  throw new CavtoolsExecError("COPY_UNSUPPORTED", `cp is not supported for ${sourceRoot}.`, 400);
}

async function ensureProjectKey(ctx: ExecContext): Promise<string> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for telemetry commands.", 400);
  if (!ctx.project.serverKeyEnc || !ctx.project.serverKeyEncIv) {
    throw new CavtoolsExecError("PROJECT_KEY_MISSING", "Project key is missing for telemetry command execution.", 409);
  }

  const decrypted = await decryptAesGcm({
    enc: ctx.project.serverKeyEnc,
    iv: ctx.project.serverKeyEncIv,
  });
  const key = s(decrypted);
  if (!key) throw new CavtoolsExecError("PROJECT_KEY_DECRYPT_FAILED", "Project key decryption failed.", 500);
  return key;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function pickNumber(record: unknown, paths: string[]): number | null {
  const r = asRecord(record);
  if (!r) return null;

  for (const path of paths) {
    const parts = path.split(".");
    let cursor: unknown = r;
    let valid = true;
    for (const part of parts) {
      const obj = asRecord(cursor);
      if (!obj || !(part in obj)) {
        valid = false;
        break;
      }
      cursor = obj[part];
    }
    if (!valid) continue;
    const n = Number(cursor);
    if (Number.isFinite(n)) return n;
  }

  return null;
}

async function telemetrySummary(ctx: ExecContext, range: "7d" | "30d") {
  const projectKey = await ensureProjectKey(ctx);
  const summary = await getProjectSummaryForTenant({
    projectId: ctx.project?.id || 0,
    range,
    siteOrigin: ctx.siteOrigin || undefined,
    projectKey,
    requestId: `cavtools_${Date.now()}`,
  });

  const summaryRecord = asRecord(summary) || {};

  return {
    projectId: ctx.project?.id || null,
    project: ctx.project?.name || null,
    range,
    siteOrigin: ctx.siteOrigin || null,
    updatedAtISO: s(summaryRecord.updatedAtISO || summaryRecord.updatedAt || "") || null,
    metrics: {
      sessions: pickNumber(summaryRecord, ["metrics.sessions", "summary.sessions", "sessions"]),
      pageViews: pickNumber(summaryRecord, ["metrics.pageViews", "summary.pageViews", "metrics.page_views"]),
      jsErrors: pickNumber(summaryRecord, ["metrics.jsErrors", "errors.totals.jsErrors", "diagnostics.errors.totals.jsErrors"]),
      apiErrors: pickNumber(summaryRecord, ["metrics.apiErrors", "errors.totals.apiErrors", "diagnostics.errors.totals.apiErrors"]),
      views404: pickNumber(summaryRecord, ["metrics.views404", "errors.totals.views404", "routes.views404"]),
    },
    raw: summary,
  };
}

async function telemetrySection(ctx: ExecContext, key: string) {
  const summary = await telemetrySummary(ctx, "7d");
  const raw = asRecord(summary.raw) || {};
  const diagnostics = asRecord(raw.diagnostics) || {};
  const metrics = asRecord(raw.metrics) || {};

  if (key === "summary") return summary;
  if (key === "routes") return diagnostics.routes || raw.routes || metrics.routes || {};
  if (key === "errors") return diagnostics.errors || raw.errors || metrics.errors || {};
  if (key === "seo") return diagnostics.seo || raw.seo || raw.seoIntelligence || metrics.seo || {};
  if (key === "a11y") return diagnostics.a11y || raw.a11y || raw.accessibility || metrics.a11y || {};
  if (key === "geo") return raw.geo || metrics.geo || diagnostics.geo || {};
  if (key === "scans") {
    const scanRows = await prisma.scanJob.findMany({
      where: {
        projectId: ctx.project?.id || 0,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 24,
      select: {
        id: true,
        status: true,
        pagesScanned: true,
        issuesFound: true,
        overallScore: true,
        createdAt: true,
        startedAt: true,
        finishedAt: true,
      },
    });

    return {
      jobs: scanRows.map((row) => ({
        id: row.id,
        status: row.status,
        pagesScanned: row.pagesScanned,
        issuesFound: row.issuesFound,
        overallScore: row.overallScore,
        createdAtISO: row.createdAt.toISOString(),
        startedAtISO: row.startedAt?.toISOString() || null,
        finishedAtISO: row.finishedAt?.toISOString() || null,
      })),
    };
  }

  return summary.raw;
}

async function workspaceStatus(ctx: ExecContext) {
  const [account, projectCount, siteCount] = await Promise.all([
    prisma.account.findUnique({
      where: {
        id: ctx.accountId,
      },
      select: {
        id: true,
        slug: true,
        name: true,
        tier: true,
      },
    }),
    prisma.project.count({
      where: {
        accountId: ctx.accountId,
        isActive: true,
      },
    }),
    prisma.site.count({
      where: {
        project: {
          accountId: ctx.accountId,
        },
        isActive: true,
      },
    }),
  ]);

  return {
    accountId: account?.id || ctx.accountId,
    accountSlug: account?.slug || null,
    accountName: account?.name || null,
    memberRole: ctx.memberRole,
    planId: ctx.planId,
    projectId: ctx.project?.id || null,
    projectName: ctx.project?.name || null,
    activeProjects: projectCount,
    activeSites: siteCount,
  };
}

async function workspaceSites(ctx: ExecContext) {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found.", 400);

  const sites = await prisma.site.findMany({
    where: {
      projectId: ctx.project.id,
      isActive: true,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      origin: true,
      label: true,
      createdAt: true,
      verifiedAt: true,
      status: true,
    },
  });

  return sites.map((site) => ({
    id: site.id,
    origin: site.origin,
    label: site.label,
    status: site.status,
    isVerified: Boolean(site.verifiedAt),
    verifiedAtISO: site.verifiedAt ? site.verifiedAt.toISOString() : null,
    createdAtISO: site.createdAt.toISOString(),
  }));
}

async function workspaceMembers(ctx: ExecContext) {
  const members = await prisma.membership.findMany({
    where: {
      accountId: ctx.accountId,
    },
    orderBy: {
      createdAt: "asc",
    },
    select: {
      role: true,
      createdAt: true,
      user: {
        select: {
          id: true,
          username: true,
          email: true,
          displayName: true,
        },
      },
    },
  });

  return members.map((member) => ({
    userId: member.user.id,
    username: member.user.username || null,
    displayName: member.user.displayName || null,
    email: member.user.email || null,
    role: member.role,
    joinedAtISO: member.createdAt.toISOString(),
  }));
}

async function workspaceGuardrails(ctx: ExecContext) {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found.", 400);

  const row = await prisma.projectGuardrails.findUnique({
    where: {
      projectId: ctx.project.id,
    },
  });

  return row || {};
}

async function workspaceNotices(ctx: ExecContext) {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found.", 400);

  const notices = await prisma.projectNotice.findMany({
    where: {
      projectId: ctx.project.id,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: 30,
  });

  return notices.map((notice) => ({
    id: notice.id,
    tone: notice.tone,
    title: notice.title,
    body: notice.body,
    createdAtISO: notice.createdAt.toISOString(),
  }));
}

function appOrigin(req: Request): string {
  const byEnv = normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL || process.env.CAVBOT_APP_ORIGIN || "");
  if (byEnv) return byEnv;
  const byReq = normalizeOrigin(req.url);
  if (byReq) return byReq;
  return getAppOrigin();
}

async function cavCloudShareByPath(ctx: ExecContext, path: string, expiresInDays: number): Promise<{ shareId: string; shareUrl: string; expiresAtISO: string }> {
  const normalized = normalizePath(path);
  const sourcePath = toSourcePath("/cavcloud", normalized);
  const node = await getCloudNodeByPath(ctx.accountId, sourcePath);
  if (!node.file && !node.folder) throw new CavtoolsExecError("PATH_NOT_FOUND", `Path not found: ${normalized}`, 404);

  const kind = node.file ? "file" : "folder";
  const id = node.file?.id || node.folder?.id || "";

  await requireCloudPermission(ctx, {
    action: "SHARE_READ_ONLY",
    resourceType: kind === "file" ? "FILE" : "FOLDER",
    resourceId: id,
    neededPermission: "VIEW",
  });

  const settings = await getCavCloudSettings({
    accountId: ctx.accountId,
    userId: ctx.userId,
  });

  const days = [1, 7, 30].includes(expiresInDays) ? expiresInDays : Number(settings.shareDefaultExpiryDays || 7);
  const accessPolicy = (settings.shareAccessPolicy || "anyone") as "anyone" | "cavbotUsers" | "workspaceMembers";

  const share = await prisma.cavCloudStorageShare.create({
    data: {
      accountId: ctx.accountId,
      mode: "READ_ONLY" as CavCloudShareMode,
      fileId: node.file?.id || null,
      folderId: node.folder?.id || null,
      accessPolicy,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      createdByUserId: ctx.userId,
    },
    select: {
      id: true,
      expiresAt: true,
    },
  });

  return {
    shareId: share.id,
    shareUrl: `${appOrigin(ctx.request)}/cavcloud/share/${share.id}`,
    expiresAtISO: share.expiresAt.toISOString(),
  };
}

function safeFilename(name: string): string {
  const cleaned = s(name).replace(/[\\/\u0000\r\n"]/g, "_").slice(0, 180);
  return cleaned || "artifact";
}

function typeLabelForFilename(fileName: string): string {
  const leaf = safeFilename(fileName);
  const idx = leaf.lastIndexOf(".");
  if (idx === -1) return "FILE";
  const ext = leaf.slice(idx + 1).toUpperCase();
  return ext || "FILE";
}

async function cavCloudPublishByPath(ctx: ExecContext, path: string): Promise<{ artifactId: string; artifactUrl: string; visibility: PublicArtifactVisibility }> {
  const normalized = normalizePath(path);
  const sourcePath = toSourcePath("/cavcloud", normalized);
  const node = await getCloudNodeByPath(ctx.accountId, sourcePath);
  if (!node.file && !node.folder) throw new CavtoolsExecError("PATH_NOT_FOUND", `Path not found: ${normalized}`, 404);

  const kind = node.file ? "file" : "folder";
  const id = node.file?.id || node.folder?.id || "";

  await requireCloudPermission(ctx, {
    action: "PUBLISH_ARTIFACT",
    resourceType: kind === "file" ? "FILE" : "FOLDER",
    resourceId: id,
    neededPermission: "VIEW",
  });

  const visibility: PublicArtifactVisibility = "LINK_ONLY";
  const publishedAt = new Date();

  const artifact = await prisma.publicArtifact.upsert({
    where: {
      userId_sourcePath: {
        userId: ctx.userId,
        sourcePath,
      },
    },
    create: {
      userId: ctx.userId,
      sourcePath,
      displayTitle: node.file?.name || node.folder?.name || "Artifact",
      type: node.file ? typeLabelForFilename(node.file.name) : "FOLDER",
      storageKey: node.file?.r2Key || "",
      mimeType: node.file?.mimeType || "application/x-directory",
      sizeBytes: node.file ? Math.min(toSafeNumber(node.file.bytes), 2147483647) : 0,
      sha256: node.file?.sha256 || null,
      visibility,
      publishedAt,
      expiresAt: null,
    },
    update: {
      displayTitle: node.file?.name || node.folder?.name || "Artifact",
      type: node.file ? typeLabelForFilename(node.file.name) : "FOLDER",
      storageKey: node.file?.r2Key || "",
      mimeType: node.file?.mimeType || "application/x-directory",
      sizeBytes: node.file ? Math.min(toSafeNumber(node.file.bytes), 2147483647) : 0,
      sha256: node.file?.sha256 || null,
      visibility,
      publishedAt,
      expiresAt: null,
    },
    select: {
      id: true,
      visibility: true,
    },
  });

  return {
    artifactId: artifact.id,
    artifactUrl: `${appOrigin(ctx.request)}/p/${artifact.id}`,
    visibility: artifact.visibility,
  };
}

async function cavCloudUnpublishByPath(ctx: ExecContext, path: string): Promise<{ artifactId: string | null; visibility: PublicArtifactVisibility | null }> {
  const normalized = normalizePath(path);
  const sourcePath = toSourcePath("/cavcloud", normalized);

  const artifact = await prisma.publicArtifact.findFirst({
    where: {
      userId: ctx.userId,
      sourcePath,
    },
    select: {
      id: true,
      visibility: true,
    },
  });

  if (!artifact?.id) {
    return { artifactId: null, visibility: null };
  }

  const updated = await prisma.publicArtifact.update({
    where: {
      id: artifact.id,
    },
    data: {
      visibility: "PRIVATE",
      publishedAt: null,
      expiresAt: null,
    },
    select: {
      id: true,
      visibility: true,
    },
  });

  return {
    artifactId: updated.id,
    visibility: updated.visibility,
  };
}

async function cavsafeItemIdByPath(accountId: string, path: string): Promise<string> {
  const normalized = normalizePath(path);
  const [file, folder] = await Promise.all([
    prisma.cavSafeFile.findFirst({
      where: {
        accountId,
        path: normalized,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    }),
    prisma.cavSafeFolder.findFirst({
      where: {
        accountId,
        path: normalized,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    }),
  ]);

  return s(file?.id || folder?.id);
}

async function cavsafeInviteByPath(ctx: ExecContext, path: string, inviteeRaw: string, roleRaw: string | null): Promise<Record<string, unknown>> {
  await ensureCavsafeEntitlement(ctx);
  const sourcePath = toSourcePath("/cavsafe", normalizePath(path));
  const itemId = await cavsafeItemIdByPath(ctx.accountId, sourcePath);
  if (!itemId) throw new CavtoolsExecError("PATH_NOT_FOUND", `Path not found: ${path}`, 404);

  const invitee = s(inviteeRaw);
  if (!invitee) throw new CavtoolsExecError("INVITEE_REQUIRED", "Invitee is required.", 400);

  const role = (() => {
    const v = s(roleRaw).toLowerCase();
    if (v === "owner" || v === "editor" || v === "viewer") return v;
    return "viewer";
  })() as "owner" | "editor" | "viewer";

  const identity = invitee.includes("@")
    ? { email: invitee }
    : invitee.startsWith("user_")
    ? { userId: invitee }
    : { username: invitee.replace(/^@/, "") };

  const invite = await createCavSafeInvite({
    request: ctx.request,
    accountId: ctx.accountId,
    inviterUserId: ctx.userId,
    itemId,
    role,
    invitee: identity,
    expiresInDays: 7,
  });

  return {
    reused: invite.reused,
    invite: invite.invite,
    item: {
      itemId: invite.item.itemId,
      kind: invite.item.kind,
      name: invite.item.name,
      path: invite.item.path,
    },
  };
}

async function cavsafeRevokeByPath(ctx: ExecContext, path: string, targetUserId: string): Promise<Record<string, unknown>> {
  await ensureCavsafeEntitlement(ctx);
  const sourcePath = toSourcePath("/cavsafe", normalizePath(path));
  const itemId = await cavsafeItemIdByPath(ctx.accountId, sourcePath);
  if (!itemId) throw new CavtoolsExecError("PATH_NOT_FOUND", `Path not found: ${path}`, 404);

  const userId = s(targetUserId);
  if (!userId) throw new CavtoolsExecError("TARGET_REQUIRED", "targetUserId is required.", 400);

  const revoked = await revokeCavSafeAccess({
    request: ctx.request,
    accountId: ctx.accountId,
    actorUserId: ctx.userId,
    itemId,
    targetUserId: userId,
  });

  return {
    item: {
      itemId: revoked.item.itemId,
      kind: revoked.item.kind,
    },
  };
}

async function cavsafeAudit(ctx: ExecContext, limitArg: string | null): Promise<Array<Record<string, unknown>>> {
  await ensureCavsafeEntitlement(ctx);
  const limitRaw = Number(limitArg);
  const limit = Number.isFinite(limitRaw) && Number.isInteger(limitRaw) && limitRaw > 0
    ? Math.min(500, limitRaw)
    : 100;

  const rows = await prisma.cavSafeOperationLog.findMany({
    where: {
      accountId: ctx.accountId,
    },
    orderBy: {
      createdAt: "desc",
    },
    take: limit,
    select: {
      id: true,
      kind: true,
      subjectType: true,
      subjectId: true,
      label: true,
      operatorUserId: true,
      meta: true,
      createdAt: true,
    },
  });

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    label: row.label,
    operatorUserId: row.operatorUserId,
    meta: row.meta,
    createdAtISO: row.createdAt.toISOString(),
  }));
}

function tableFromObjects(title: string, rows: Array<Record<string, unknown>>): CavtoolsExecBlock {
  const columnsSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) columnsSet.add(key);
  }
  const columns = Array.from(columnsSet.values());

  const outRows = rows.map((row) => {
    const next: Record<string, string | number | boolean | null> = {};
    for (const col of columns) {
      const value = row[col];
      if (value == null) {
        next[col] = null;
      } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        next[col] = value;
      } else {
        next[col] = JSON.stringify(value);
      }
    }
    return next;
  });

  return {
    kind: "table",
    title,
    columns,
    rows: outRows,
  };
}

type LintWorkspaceFile = {
  path: string;
  content: string;
  mimeType: string;
  sizeBytes: number;
};

type LintWorkspaceSnapshot = {
  files: LintWorkspaceFile[];
  truncatedByFileLimit: boolean;
  truncatedByByteLimit: boolean;
};

const TS_LINT_FILE_RE = /\.(tsx?|mts|cts|jsx?|mjs|cjs)$/i;
const JSON_LINT_FILE_RE = /\.jsonc?$/i;

function normalizeTsPath(pathValue: string): string {
  return normalizePath(String(pathValue || "").replace(/\\/g, "/"));
}

function isLintCandidatePath(pathValue: string, mimeType?: string | null): boolean {
  const normalized = normalizePath(pathValue);
  if (TS_LINT_FILE_RE.test(normalized) || JSON_LINT_FILE_RE.test(normalized)) return true;
  const mime = s(mimeType).toLowerCase();
  return mime.includes("typescript") || mime.includes("javascript") || mime.includes("json");
}

function toDiagnosticSeverity(category: ts.DiagnosticCategory): "error" | "warn" | "info" {
  if (category === ts.DiagnosticCategory.Error) return "error";
  if (category === ts.DiagnosticCategory.Warning) return "warn";
  return "info";
}

function mapTsDiagnostic(
  diagnostic: ts.Diagnostic,
  fallbackFile = "/cavcode/tsconfig.json"
): CavtoolsWorkspaceDiagnostic | null {
  const source = s(diagnostic.source || "typescript") || "typescript";
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").trim();
  if (!message) return null;

  const severity = toDiagnosticSeverity(diagnostic.category);
  const code = Number.isFinite(Number(diagnostic.code)) ? `TS${Math.trunc(Number(diagnostic.code))}` : undefined;

  if (diagnostic.file) {
    const filePath = normalizeTsPath(diagnostic.file.fileName || "");
    if (!filePath.startsWith("/cavcode/")) return null;
    const start = Number.isFinite(Number(diagnostic.start)) ? Math.max(0, Math.trunc(Number(diagnostic.start))) : 0;
    const lc = diagnostic.file.getLineAndCharacterOfPosition(start);
    return {
      file: filePath,
      line: (lc?.line || 0) + 1,
      col: (lc?.character || 0) + 1,
      severity,
      source,
      code,
      message,
      fixReady: Boolean(code),
    };
  }

  const fallback = normalizeTsPath(fallbackFile);
  if (!fallback.startsWith("/cavcode/")) return null;
  return {
    file: fallback,
    line: 1,
    col: 1,
    severity,
    source,
    code,
    message,
    fixReady: Boolean(code),
  };
}

function pushWorkspaceDiagnostic(
  diagnostics: CavtoolsWorkspaceDiagnostic[],
  seen: Set<string>,
  next: CavtoolsWorkspaceDiagnostic
): boolean {
  const key = [
    next.file,
    String(next.line || 1),
    String(next.col || 1),
    next.severity,
    next.source || "",
    next.code || "",
    next.message,
  ].join("|");
  if (seen.has(key)) return false;
  seen.add(key);
  diagnostics.push(next);
  return true;
}

function readTsConfigCompilerOptions(
  files: LintWorkspaceFile[],
  diagnosticsOut: CavtoolsWorkspaceDiagnostic[]
): ts.CompilerOptions {
  const tsconfig = files.find((file) => normalizePath(file.path) === "/cavcode/tsconfig.json");
  if (!tsconfig) return {};

  const parsed = ts.parseConfigFileTextToJson(tsconfig.path, tsconfig.content);
  if (parsed.error) {
    const mapped = mapTsDiagnostic(parsed.error, tsconfig.path);
    if (mapped) diagnosticsOut.push(mapped);
    return {};
  }

  const configRecord =
    parsed.config && typeof parsed.config === "object" && !Array.isArray(parsed.config)
      ? (parsed.config as Record<string, unknown>)
      : {};
  const compilerOptionsRaw =
    configRecord.compilerOptions && typeof configRecord.compilerOptions === "object" && !Array.isArray(configRecord.compilerOptions)
      ? (configRecord.compilerOptions as Record<string, unknown>)
      : {};

  const converted = ts.convertCompilerOptionsFromJson(compilerOptionsRaw, "/cavcode");
  for (const error of converted.errors || []) {
    const mapped = mapTsDiagnostic(error, tsconfig.path);
    if (mapped) diagnosticsOut.push(mapped);
  }

  return converted.options || {};
}

async function collectCavcodeLintFiles(ctx: ExecContext): Promise<LintWorkspaceSnapshot> {
  if (!ctx.project?.id) {
    throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for lint.", 400);
  }

  await assertCavCodeProjectAccess({
    accountId: ctx.accountId,
    userId: ctx.userId,
    projectId: ctx.project.id,
    needed: "VIEW",
    errorCode: "UNAUTHORIZED",
  });

  const mounts = await cavcodeMounts(ctx);
  const pendingByPath = new Map<
    string,
    {
      sourceType: "CAVCLOUD" | "CAVSAFE";
      objectKey: string;
      mimeType: string | null;
      sizeBytes: number;
    }
  >();
  let truncatedByFileLimit = false;

  for (const mount of mounts) {
    if (pendingByPath.size >= MAX_LINT_FILES) {
      truncatedByFileLimit = true;
      break;
    }

    const basePath = normalizePath(mount.folder?.path || "/");
    const startsWithPath = basePath === "/" ? "/" : `${basePath}/`;

    if (mount.sourceType === "CAVCLOUD") {
      const rows = await prisma.cavCloudFile.findMany({
        where: {
          accountId: ctx.accountId,
          deletedAt: null,
          path: {
            startsWith: startsWithPath,
          },
        },
        orderBy: {
          path: "asc",
        },
        take: MAX_LINT_FILES * 3,
        select: {
          path: true,
          mimeType: true,
          r2Key: true,
          bytes: true,
        },
      });

      for (const row of rows) {
        const virtualPath = normalizePath(virtualPathFromMount(mount, row.path));
        if (!virtualPath.startsWith("/cavcode/")) continue;
        if (pendingByPath.has(virtualPath)) continue;
        if (!isLintCandidatePath(virtualPath, row.mimeType)) continue;
        const sizeBytes = toSafeNumber(row.bytes);
        if (sizeBytes <= 0 || sizeBytes > MAX_LINT_FILE_BYTES) continue;
        pendingByPath.set(virtualPath, {
          sourceType: "CAVCLOUD",
          objectKey: row.r2Key,
          mimeType: row.mimeType,
          sizeBytes,
        });
        if (pendingByPath.size >= MAX_LINT_FILES) {
          truncatedByFileLimit = true;
          break;
        }
      }
      if (truncatedByFileLimit) break;
      continue;
    }

    const rows = await prisma.cavSafeFile.findMany({
      where: {
        accountId: ctx.accountId,
        deletedAt: null,
        path: {
          startsWith: startsWithPath,
        },
      },
      orderBy: {
        path: "asc",
      },
      take: MAX_LINT_FILES * 3,
      select: {
        path: true,
        mimeType: true,
        r2Key: true,
        bytes: true,
      },
    });

    for (const row of rows) {
      const virtualPath = normalizePath(virtualPathFromMount(mount, row.path));
      if (!virtualPath.startsWith("/cavcode/")) continue;
      if (pendingByPath.has(virtualPath)) continue;
      if (!isLintCandidatePath(virtualPath, row.mimeType)) continue;
      const sizeBytes = toSafeNumber(row.bytes);
      if (sizeBytes <= 0 || sizeBytes > MAX_LINT_FILE_BYTES) continue;
      pendingByPath.set(virtualPath, {
        sourceType: "CAVSAFE",
        objectKey: row.r2Key,
        mimeType: row.mimeType,
        sizeBytes,
      });
      if (pendingByPath.size >= MAX_LINT_FILES) {
        truncatedByFileLimit = true;
        break;
      }
    }
    if (truncatedByFileLimit) break;
  }

  const files: LintWorkspaceFile[] = [];
  let totalBytes = 0;
  let truncatedByByteLimit = false;

  for (const [virtualPath, pending] of pendingByPath.entries()) {
    if (files.length >= MAX_LINT_FILES) {
      truncatedByFileLimit = true;
      break;
    }
    if (totalBytes >= MAX_LINT_TOTAL_BYTES) {
      truncatedByByteLimit = true;
      break;
    }

    const stream =
      pending.sourceType === "CAVCLOUD"
        ? await getCavcloudObjectStream({ objectKey: pending.objectKey })
        : await getCavsafeObjectStream({ objectKey: pending.objectKey });
    if (!stream) continue;

    const content = await readObjectText(stream.body, MAX_LINT_FILE_BYTES);
    const contentBytes = Buffer.byteLength(content, "utf8");
    if (contentBytes <= 0) continue;
    if (contentBytes > MAX_LINT_FILE_BYTES) continue;
    if (totalBytes + contentBytes > MAX_LINT_TOTAL_BYTES) {
      truncatedByByteLimit = true;
      break;
    }

    files.push({
      path: virtualPath,
      content,
      mimeType: pending.mimeType || "text/plain; charset=utf-8",
      sizeBytes: contentBytes || pending.sizeBytes,
    });
    totalBytes += contentBytes;
  }

  return {
    files,
    truncatedByFileLimit,
    truncatedByByteLimit,
  };
}

async function runCavcodeWorkspaceDiagnostics(
  ctx: ExecContext
): Promise<{ diagnostics: CavtoolsWorkspaceDiagnostic[]; summary: CavtoolsWorkspaceDiagnosticsSummary }> {
  const snapshot = await collectCavcodeLintFiles(ctx);
  const diagnostics: CavtoolsWorkspaceDiagnostic[] = [];
  const seen = new Set<string>();
  let truncatedByDiagnosticLimit = false;

  const push = (next: CavtoolsWorkspaceDiagnostic | null) => {
    if (!next) return;
    if (diagnostics.length >= MAX_LINT_DIAGNOSTICS) {
      truncatedByDiagnosticLimit = true;
      return;
    }
    pushWorkspaceDiagnostic(diagnostics, seen, next);
  };

  const tsFiles = snapshot.files.filter((file) => TS_LINT_FILE_RE.test(file.path));
  const configDiagnostics: CavtoolsWorkspaceDiagnostic[] = [];
  const configuredCompilerOptions = readTsConfigCompilerOptions(snapshot.files, configDiagnostics);
  for (const item of configDiagnostics) push(item);

  if (tsFiles.length) {
    const defaultCompilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      allowJs: true,
      checkJs: false,
      noEmit: true,
      resolveJsonModule: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      skipLibCheck: true,
      strict: true,
      baseUrl: "/cavcode",
      paths: {
        "@/*": ["./*"],
      },
    };

    const compilerOptions: ts.CompilerOptions = {
      ...defaultCompilerOptions,
      ...configuredCompilerOptions,
      noEmit: true,
      skipLibCheck: true,
    };

    const caseSensitive = ts.sys.useCaseSensitiveFileNames;
    const toCanonical = (fileName: string) => (caseSensitive ? fileName : fileName.toLowerCase());
    const memByPath = new Map<string, string>();
    const memDirs = new Set<string>(["/"]);

    for (const file of tsFiles) {
      const normalized = normalizeTsPath(file.path);
      memByPath.set(toCanonical(normalized), file.content);
      let cursor = dirname(normalized);
      while (cursor && !memDirs.has(cursor)) {
        memDirs.add(cursor);
        if (cursor === "/") break;
        cursor = dirname(cursor);
      }
      memDirs.add("/");
      memDirs.add("/cavcode");
    }

    const getMemoryFile = (fileName: string): string | undefined => {
      const normalized = normalizeTsPath(fileName);
      const direct = memByPath.get(toCanonical(normalized));
      if (typeof direct === "string") return direct;
      if (!normalized.startsWith("/")) {
        const abs = normalizePath(`/cavcode/${normalized}`);
        const fromAbs = memByPath.get(toCanonical(abs));
        if (typeof fromAbs === "string") return fromAbs;
      }
      return undefined;
    };

    const host = ts.createCompilerHost(compilerOptions, true);
    const hostReadFile = host.readFile.bind(host);
    const hostFileExists = host.fileExists.bind(host);
    const hostDirectoryExists = host.directoryExists?.bind(host);
    const hostGetDirectories = host.getDirectories?.bind(host);

    host.getCurrentDirectory = () => "/cavcode";
    host.fileExists = (fileName) => {
      if (typeof getMemoryFile(fileName) === "string") return true;
      return hostFileExists(fileName);
    };
    host.readFile = (fileName) => {
      const fromMemory = getMemoryFile(fileName);
      if (typeof fromMemory === "string") return fromMemory;
      return hostReadFile(fileName);
    };
    host.directoryExists = (dirName) => {
      const normalized = normalizeTsPath(dirName);
      if (memDirs.has(normalized)) return true;
      return hostDirectoryExists ? hostDirectoryExists(dirName) : false;
    };
    host.getDirectories = (dirName) => {
      const normalized = normalizeTsPath(dirName);
      const out = new Set<string>();
      for (const dirPath of memDirs) {
        if (!dirPath.startsWith(`${normalized}/`)) continue;
        const rel = dirPath.slice(normalized.length + 1);
        const seg = rel.split("/").filter(Boolean)[0];
        if (seg) out.add(seg);
      }
      const native = hostGetDirectories ? hostGetDirectories(dirName) : [];
      for (const name of native || []) out.add(name);
      return Array.from(out);
    };
    host.realpath = (pathValue) => pathValue;

    const rootNames = tsFiles.map((file) => normalizeTsPath(file.path));
    const program = ts.createProgram({
      rootNames,
      options: compilerOptions,
      host,
    });
    const tsDiagnostics = ts.getPreEmitDiagnostics(program);
    for (const diagnostic of tsDiagnostics) {
      const mapped = mapTsDiagnostic(diagnostic);
      push(mapped);
    }
  }

  for (const file of snapshot.files) {
    if (!JSON_LINT_FILE_RE.test(file.path)) continue;
    const jsonText = ts.parseJsonText(file.path, file.content);
    const parseDiagnostics =
      ((jsonText as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics || []) as ts.Diagnostic[];
    for (const diagnostic of parseDiagnostics) {
      const start = Number.isFinite(Number(diagnostic.start)) ? Math.max(0, Math.trunc(Number(diagnostic.start))) : 0;
      const lc = jsonText.getLineAndCharacterOfPosition(start);
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n").trim();
      if (!message) continue;
      push({
        file: normalizeTsPath(file.path),
        line: (lc?.line || 0) + 1,
        col: (lc?.character || 0) + 1,
        severity: "error",
        source: "json",
        code: Number.isFinite(Number(diagnostic.code)) ? `JSON${Math.trunc(Number(diagnostic.code))}` : undefined,
        message,
        fixReady: false,
      });
    }
  }

  diagnostics.sort((a, b) => {
    const rankA = a.severity === "error" ? 0 : a.severity === "warn" ? 1 : 2;
    const rankB = b.severity === "error" ? 0 : b.severity === "warn" ? 1 : 2;
    if (rankA !== rankB) return rankA - rankB;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    return a.col - b.col;
  });

  const errors = diagnostics.filter((item) => item.severity === "error").length;
  const warnings = diagnostics.filter((item) => item.severity === "warn").length;
  const infos = diagnostics.filter((item) => item.severity === "info").length;

  return {
    diagnostics,
    summary: {
      total: diagnostics.length,
      errors,
      warnings,
      infos,
      filesScanned: snapshot.files.length,
      generatedAtISO: nowISO(),
      truncated:
        Boolean(snapshot.truncatedByFileLimit) ||
        Boolean(snapshot.truncatedByByteLimit) ||
        Boolean(truncatedByDiagnosticLimit),
    },
  };
}

function runtimeProjectKey(accountId: string, projectId: number): string {
  return `${accountId}:${projectId}`;
}

function runtimeSessionView(session: RuntimeSession) {
  return {
    type: "cav_runtime_status_v1",
    sessionId: session.id,
    projectId: session.projectId,
    kind: session.kind,
    command: session.command,
    cwd: session.cwd,
    status: session.status,
    createdAtISO: new Date(session.createdAtMs).toISOString(),
    updatedAtISO: new Date(session.updatedAtMs).toISOString(),
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    nextSeq: session.nextSeq,
    logTruncated: session.logTruncated,
    filesMaterialized: session.filesMaterialized,
    bytesMaterialized: session.bytesMaterialized,
  };
}

function clampRuntimeLine(input: string): string {
  const text = String(input || "").replace(/\r/g, "").trimEnd();
  if (!text) return "";
  return text.length > MAX_RUNTIME_LOG_LINE_CHARS ? `${text.slice(0, MAX_RUNTIME_LOG_LINE_CHARS)}…` : text;
}

function pushRuntimeLogLine(session: RuntimeSession, stream: RuntimeLogStream, line: string) {
  const text = clampRuntimeLine(line);
  if (!text && stream !== "system") return;
  const seq = session.nextSeq + 1;
  session.nextSeq = seq;
  session.updatedAtMs = Date.now();
  session.logs.push({
    seq,
    atISO: nowISO(),
    stream,
    text: text || (stream === "system" ? "(system)" : ""),
  });
  if (session.logs.length > MAX_RUNTIME_LOG_LINES) {
    const drop = session.logs.length - MAX_RUNTIME_LOG_LINES;
    session.logs.splice(0, drop);
    session.logTruncated = true;
  }
}

function appendRuntimeChunk(session: RuntimeSession, stream: "stdout" | "stderr", chunk: Buffer | string) {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const prior = stream === "stdout" ? session.partialStdout : session.partialStderr;
  const all = `${prior}${normalized}`;
  const lines = all.split("\n");
  const tail = lines.pop() || "";

  for (const line of lines) {
    pushRuntimeLogLine(session, stream, line);
  }

  if (stream === "stdout") session.partialStdout = tail;
  else session.partialStderr = tail;
}

function flushRuntimePartials(session: RuntimeSession) {
  if (session.partialStdout) {
    pushRuntimeLogLine(session, "stdout", session.partialStdout);
    session.partialStdout = "";
  }
  if (session.partialStderr) {
    pushRuntimeLogLine(session, "stderr", session.partialStderr);
    session.partialStderr = "";
  }
}

function attachRuntimeProcess(session: RuntimeSession, child: ChildProcess) {
  session.process = child;
  session.status = "starting";
  session.updatedAtMs = Date.now();
  pushRuntimeLogLine(session, "system", `Starting ${session.command}`);
  const actor = reliabilityActorFromSession(session);

  child.stdout?.on("data", (chunk) => {
    appendRuntimeChunk(session, "stdout", chunk);
  });
  child.stderr?.on("data", (chunk) => {
    appendRuntimeChunk(session, "stderr", chunk);
  });

  child.on("spawn", () => {
    session.status = "running";
    session.updatedAtMs = Date.now();
    pushRuntimeLogLine(session, "system", "Process started.");
    if (actor) {
      void writeReliabilitySnapshot(actor, {
        kind: "runtime",
        scopeId: session.id,
        status: session.status,
        payload: runtimeSessionView(session),
      }).catch(() => {});
      void writeDeterministicReplay(actor, {
        category: "runtime",
        sessionId: session.id,
        action: "runtime.spawn",
        payload: runtimeSessionView(session),
      }).catch(() => {});
    }
  });

  child.on("error", (error) => {
    session.status = "failed";
    session.updatedAtMs = Date.now();
    pushRuntimeLogLine(session, "system", `Runtime process error: ${s(error?.message || "Unknown process error")}`);
    if (actor) {
      void writeCrashRecord(actor, {
        kind: "runtime",
        scopeId: session.id,
        error: s(error?.message || "Runtime process error"),
        stack: s((error as Error | null)?.stack || "") || null,
        payload: runtimeSessionView(session),
      }).catch(() => {});
      void writeReliabilitySnapshot(actor, {
        kind: "runtime",
        scopeId: session.id,
        status: session.status,
        payload: runtimeSessionView(session),
      }).catch(() => {});
      void writeDeterministicReplay(actor, {
        category: "runtime",
        sessionId: session.id,
        action: "runtime.error",
        payload: {
          error: s(error?.message || "Runtime process error"),
          status: session.status,
        },
      }).catch(() => {});
    }
  });

  child.on("exit", (code, signal) => {
    flushRuntimePartials(session);
    session.exitCode = Number.isFinite(Number(code)) ? Math.trunc(Number(code)) : null;
    session.exitSignal = s(signal || "") || null;
    session.updatedAtMs = Date.now();
    if (session.stopRequested) {
      session.status = "stopped";
      pushRuntimeLogLine(
        session,
        "system",
        `Runtime stopped${session.exitCode != null ? ` (exit ${session.exitCode})` : session.exitSignal ? ` (${session.exitSignal})` : ""}.`
      );
    } else if (session.exitCode === 0) {
      session.status = "exited";
      pushRuntimeLogLine(session, "system", "Runtime completed successfully.");
    } else {
      session.status = "failed";
      pushRuntimeLogLine(
        session,
        "system",
        `Runtime failed${session.exitCode != null ? ` (exit ${session.exitCode})` : session.exitSignal ? ` (${session.exitSignal})` : ""}.`
      );
    }
    if (actor) {
      void writeReliabilitySnapshot(actor, {
        kind: "runtime",
        scopeId: session.id,
        status: session.status,
        payload: runtimeSessionView(session),
      }).catch(() => {});
      void writeDeterministicReplay(actor, {
        category: "runtime",
        sessionId: session.id,
        action: "runtime.exit",
        payload: {
          status: session.status,
          exitCode: session.exitCode,
          exitSignal: session.exitSignal,
          stopRequested: session.stopRequested,
        },
      }).catch(() => {});
      if (session.status === "failed") {
        void writeCrashRecord(actor, {
          kind: "runtime",
          scopeId: session.id,
          error: `Runtime exited${session.exitCode != null ? ` (exit ${session.exitCode})` : session.exitSignal ? ` (${session.exitSignal})` : ""}`,
          payload: runtimeSessionView(session),
        }).catch(() => {});
      }
    }
  });
}

async function pathExists(absPath: string): Promise<boolean> {
  try {
    await stat(absPath);
    return true;
  } catch {
    return false;
  }
}

function toRuntimeRelativePath(virtualPath: string): string | null {
  const normalized = normalizePath(virtualPath);
  if (!normalized.startsWith("/cavcode/")) return null;
  const rel = normalized.slice("/cavcode/".length);
  if (!rel) return null;
  const parts = rel.split("/").filter(Boolean);
  if (!parts.length) return null;
  if (parts.some((part) => part === "." || part === "..")) return null;
  return parts.join("/");
}

async function cleanupRuntimeSessions() {
  const now = Date.now();
  const staleIds: string[] = [];
  for (const [id, session] of runtimeSessions.entries()) {
    const active = session.status === "starting" || session.status === "running";
    if (active) continue;
    if (now - session.updatedAtMs < RUNTIME_SESSION_RETENTION_MS) continue;
    staleIds.push(id);
  }

  for (const id of staleIds) {
    const session = runtimeSessions.get(id);
    if (!session) continue;
    runtimeSessions.delete(id);
    const activeId = runtimeSessionByProject.get(session.key);
    if (activeId === id) runtimeSessionByProject.delete(session.key);
    try {
      await rm(session.workspaceDir, { recursive: true, force: true });
    } catch {}
  }
}

function assertRuntimeSessionAccess(ctx: ExecContext, sessionId: string): RuntimeSession {
  const session = runtimeSessions.get(sessionId);
  if (!session) throw new CavtoolsExecError("RUNTIME_NOT_FOUND", `Runtime session not found: ${sessionId}`, 404);
  if (session.accountId !== ctx.accountId || session.userId !== ctx.userId) {
    throw new CavtoolsExecError("UNAUTHORIZED", "Runtime session is not accessible for this operator.", 403, "ROLE_BLOCKED");
  }
  return session;
}

async function stopRuntimeSession(session: RuntimeSession, reason = "Stopped by operator.") {
  session.stopRequested = true;
  pushRuntimeLogLine(session, "system", reason);
  const actor = reliabilityActorFromSession(session);
  if (!session.process) {
    session.status = "stopped";
    session.updatedAtMs = Date.now();
    if (actor) {
      await writeReliabilitySnapshot(actor, {
        kind: "runtime",
        scopeId: session.id,
        status: session.status,
        payload: runtimeSessionView(session),
      }).catch(() => {});
      await writeDeterministicReplay(actor, {
        category: "runtime",
        sessionId: session.id,
        action: "runtime.stop",
        payload: {
          reason,
          status: session.status,
        },
      }).catch(() => {});
    }
    return;
  }
  const active = session.status === "starting" || session.status === "running";
  if (!active) return;
  try {
    session.process.kill("SIGTERM");
  } catch {}
  const processRef = session.process;
  const timer = setTimeout(() => {
    try {
      if (processRef.exitCode == null) processRef.kill("SIGKILL");
    } catch {}
  }, 4500);
  timer.unref?.();
}

async function collectRuntimeMaterializedFiles(ctx: ExecContext): Promise<{
  files: Array<{ path: string; sourceType: "CAVCLOUD" | "CAVSAFE"; objectKey: string; sizeBytes: number }>;
  truncatedByFileLimit: boolean;
  truncatedByByteLimit: boolean;
}> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for runtime.", 400);
  await assertCavCodeProjectAccess({
    accountId: ctx.accountId,
    userId: ctx.userId,
    projectId: ctx.project.id,
    needed: "VIEW",
    errorCode: "UNAUTHORIZED",
  });

  const mounts = await cavcodeMounts(ctx);
  const pending = new Map<string, { sourceType: "CAVCLOUD" | "CAVSAFE"; objectKey: string; sizeBytes: number }>();
  let truncatedByFileLimit = false;

  for (const mount of mounts) {
    if (pending.size >= MAX_RUNTIME_FILES) {
      truncatedByFileLimit = true;
      break;
    }
    const basePath = normalizePath(mount.folder?.path || "/");
    const startsWithPath = basePath === "/" ? "/" : `${basePath}/`;

    if (mount.sourceType === "CAVCLOUD") {
      const rows = await prisma.cavCloudFile.findMany({
        where: {
          accountId: ctx.accountId,
          deletedAt: null,
          path: {
            startsWith: startsWithPath,
          },
        },
        orderBy: { path: "asc" },
        take: MAX_RUNTIME_FILES * 3,
        select: { path: true, r2Key: true, bytes: true },
      });
      for (const row of rows) {
        const virtualPath = normalizePath(virtualPathFromMount(mount, row.path));
        if (!virtualPath.startsWith("/cavcode/")) continue;
        if (pending.has(virtualPath)) continue;
        const sizeBytes = toSafeNumber(row.bytes);
        if (sizeBytes <= 0 || sizeBytes > MAX_RUNTIME_FILE_BYTES) continue;
        pending.set(virtualPath, {
          sourceType: "CAVCLOUD",
          objectKey: row.r2Key,
          sizeBytes,
        });
        if (pending.size >= MAX_RUNTIME_FILES) {
          truncatedByFileLimit = true;
          break;
        }
      }
      if (truncatedByFileLimit) break;
      continue;
    }

    const rows = await prisma.cavSafeFile.findMany({
      where: {
        accountId: ctx.accountId,
        deletedAt: null,
        path: {
          startsWith: startsWithPath,
        },
      },
      orderBy: { path: "asc" },
      take: MAX_RUNTIME_FILES * 3,
      select: { path: true, r2Key: true, bytes: true },
    });
    for (const row of rows) {
      const virtualPath = normalizePath(virtualPathFromMount(mount, row.path));
      if (!virtualPath.startsWith("/cavcode/")) continue;
      if (pending.has(virtualPath)) continue;
      const sizeBytes = toSafeNumber(row.bytes);
      if (sizeBytes <= 0 || sizeBytes > MAX_RUNTIME_FILE_BYTES) continue;
      pending.set(virtualPath, {
        sourceType: "CAVSAFE",
        objectKey: row.r2Key,
        sizeBytes,
      });
      if (pending.size >= MAX_RUNTIME_FILES) {
        truncatedByFileLimit = true;
        break;
      }
    }
    if (truncatedByFileLimit) break;
  }

  const files: Array<{ path: string; sourceType: "CAVCLOUD" | "CAVSAFE"; objectKey: string; sizeBytes: number }> = [];
  let totalBytes = 0;
  let truncatedByByteLimit = false;
  for (const [virtualPath, pendingFile] of pending.entries()) {
    if (totalBytes + pendingFile.sizeBytes > MAX_RUNTIME_TOTAL_BYTES) {
      truncatedByByteLimit = true;
      break;
    }
    files.push({
      path: virtualPath,
      sourceType: pendingFile.sourceType,
      objectKey: pendingFile.objectKey,
      sizeBytes: pendingFile.sizeBytes,
    });
    totalBytes += pendingFile.sizeBytes;
  }

  return {
    files,
    truncatedByFileLimit,
    truncatedByByteLimit,
  };
}

async function materializeRuntimeWorkspace(ctx: ExecContext): Promise<{
  workspaceDir: string;
  filesMaterialized: number;
  bytesMaterialized: number;
  packageJsonPaths: string[];
  warnings: string[];
}> {
  const collect = await collectRuntimeMaterializedFiles(ctx);
  const runtimeRoot = path.join(tmpdir(), "cavcode-runtime", ctx.accountId, String(ctx.project?.id || "project"));
  await mkdir(runtimeRoot, { recursive: true });
  const workspaceDir = await mkdtemp(path.join(runtimeRoot, "run-"));
  const warnings: string[] = [];
  if (collect.truncatedByFileLimit) warnings.push("Runtime workspace file list truncated by file-count limit.");
  if (collect.truncatedByByteLimit) warnings.push("Runtime workspace file list truncated by total-byte limit.");

  let filesMaterialized = 0;
  let bytesMaterialized = 0;
  const packageJsonPaths: string[] = [];

  for (const file of collect.files) {
    const rel = toRuntimeRelativePath(file.path);
    if (!rel) continue;
    const absPath = path.join(workspaceDir, rel);
    const normalizedAbs = path.normalize(absPath);
    if (!normalizedAbs.startsWith(path.normalize(workspaceDir))) continue;

    const stream =
      file.sourceType === "CAVCLOUD"
        ? await getCavcloudObjectStream({ objectKey: file.objectKey })
        : await getCavsafeObjectStream({ objectKey: file.objectKey });
    if (!stream) continue;
    const contentBuffer = await readObjectBuffer(stream.body, MAX_RUNTIME_FILE_BYTES);
    await mkdir(path.dirname(normalizedAbs), { recursive: true });
    await writeFile(normalizedAbs, contentBuffer);
    filesMaterialized += 1;
    bytesMaterialized += contentBuffer.byteLength;
    if (rel.toLowerCase().endsWith("/package.json") || rel.toLowerCase() === "package.json") {
      packageJsonPaths.push(rel);
    }
  }

  return {
    workspaceDir,
    filesMaterialized,
    bytesMaterialized,
    packageJsonPaths,
    warnings,
  };
}

async function resolveRuntimeRunCommand(
  workspaceDir: string,
  kind: RuntimeRunKind,
  packageJsonPaths: string[]
): Promise<{ command: string; cwd: string }> {
  const candidates = Array.from(new Set(packageJsonPaths))
    .sort((a, b) => a.split("/").length - b.split("/").length);
  if (!candidates.length) {
    if (await pathExists(path.join(workspaceDir, "package.json"))) candidates.push("package.json");
  }
  if (!candidates.length) {
    throw new CavtoolsExecError("RUNTIME_PACKAGE_MISSING", "No package.json found in mounted codebase. Runtime requires Node scripts.", 400);
  }

  let chosenPackageRel = candidates[0];
  for (const rel of candidates) {
    const abs = path.join(workspaceDir, rel);
    try {
      const parsed = JSON.parse(await readFile(abs, "utf8")) as { scripts?: Record<string, unknown> };
      if (parsed?.scripts && typeof parsed.scripts[kind] === "string" && s(parsed.scripts[kind])) {
        chosenPackageRel = rel;
        break;
      }
    } catch {}
  }

  const packageDir = path.dirname(path.join(workspaceDir, chosenPackageRel));
  const lockPnpm = await pathExists(path.join(packageDir, "pnpm-lock.yaml"));
  const lockYarn = await pathExists(path.join(packageDir, "yarn.lock"));
  const nodeModulesExists = await pathExists(path.join(packageDir, "node_modules"));
  const packageManager: "npm" | "pnpm" | "yarn" = lockPnpm ? "pnpm" : lockYarn ? "yarn" : "npm";
  const runCmd = packageManager === "yarn" ? `yarn ${kind}` : `${packageManager} run ${kind}`;

  if (nodeModulesExists) {
    return {
      command: runCmd,
      cwd: packageDir,
    };
  }

  const installCmd =
    packageManager === "npm"
      ? "npm install --no-audit --no-fund"
      : packageManager === "pnpm"
      ? "pnpm install"
      : "yarn install";

  return {
    command: `${installCmd} && ${runCmd}`,
    cwd: packageDir,
  };
}

async function startRuntimeSession(
  ctx: ExecContext,
  kind: RuntimeRunKind
): Promise<{ session: RuntimeSession; warnings: string[] }> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for runtime.", 400);
  await cleanupRuntimeSessions();
  const policy = await assertExecutionAllowed(ctx, {
    scope: "runtime",
    command: `runtime:${kind}`,
    resource: `/cavcode/runtime/${kind}`,
  });

  const projectKey = runtimeProjectKey(ctx.accountId, ctx.project.id);
  const activeId = runtimeSessionByProject.get(projectKey);
  if (activeId) {
    const existing = runtimeSessions.get(activeId);
    if (existing && (existing.status === "starting" || existing.status === "running")) {
      await stopRuntimeSession(existing, "Stopped previous runtime before starting a new one.");
    }
  }

  const stage = await materializeRuntimeWorkspace(ctx);
  const warnings = [...stage.warnings];
  const scan = await runQuarantineScanForWorkspace({
    ctx,
    workspaceDir: stage.workspaceDir,
    targetKind: "runtime",
    targetPath: "/cavcode",
  });
  if (scan.verdict === "blocked") {
    try {
      await rm(stage.workspaceDir, { recursive: true, force: true });
    } catch {}
    throw new CavtoolsExecError(
      "SECURITY_QUARANTINE_BLOCKED",
      `Quarantine scan blocked runtime start (${scan.findings.length} finding${scan.findings.length === 1 ? "" : "s"}).`,
      403
    );
  }
  if (scan.verdict === "warn") {
    warnings.push(`Quarantine scan reported ${scan.findings.length} warning finding(s).`);
  }
  const runPlan = await resolveRuntimeRunCommand(stage.workspaceDir, kind, stage.packageJsonPaths);
  const sessionId = `rt_${hashCommandId(`${ctx.accountId}:${ctx.userId}:${ctx.project.id}:${kind}`, runPlan.cwd)}`;
  const session: RuntimeSession = {
    id: sessionId,
    key: projectKey,
    accountId: ctx.accountId,
    userId: ctx.userId,
    projectId: ctx.project.id,
    kind,
    command: runPlan.command,
    cwd: runPlan.cwd,
    workspaceDir: stage.workspaceDir,
    process: null,
    status: "starting",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    exitCode: null,
    exitSignal: null,
    stopRequested: false,
    nextSeq: 0,
    logTruncated: false,
    logs: [],
    partialStdout: "",
    partialStderr: "",
    filesMaterialized: stage.filesMaterialized,
    bytesMaterialized: stage.bytesMaterialized,
  };
  const secretEnv = await resolveSecretEnvForScope(ctx, "runtime").catch(() => ({}));

  const child = spawn(runPlan.command, {
    cwd: runPlan.cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...secretEnv,
      FORCE_COLOR: "0",
      CAVCODE_RUNTIME_SESSION_ID: sessionId,
      CAVCODE_RUNTIME_KIND: kind,
      CAVCODE_SECURITY_PROFILE: policy.profile,
      CAVCODE_SECURITY_SANDBOX: policy.sandboxMode,
      CAVCODE_SECURITY_NETWORK: policy.networkPolicy,
    },
  });
  attachRuntimeProcess(session, child);
  runtimeSessions.set(sessionId, session);
  runtimeSessionByProject.set(projectKey, sessionId);
  await recordReliabilitySnapshot(ctx, {
    kind: "runtime",
    scopeId: session.id,
    status: session.status,
    payload: runtimeSessionView(session),
  }).catch(() => {});
  await recordDeterministicReplay(ctx, {
    category: "runtime",
    sessionId: session.id,
    action: "runtime.start",
    payload: runtimeSessionView(session),
  }).catch(() => {});

  return {
    session,
    warnings,
  };
}

function readRuntimeLogs(session: RuntimeSession, afterSeq: number) {
  const after = Number.isFinite(Number(afterSeq)) ? Math.max(0, Math.trunc(Number(afterSeq))) : 0;
  const entries = session.logs
    .filter((entry) => entry.seq > after)
    .slice(0, RUNTIME_POLL_BATCH);
  const nextSeq = entries.length ? entries[entries.length - 1].seq : after;
  return {
    type: "cav_runtime_logs_v1",
    sessionId: session.id,
    status: session.status,
    kind: session.kind,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    nextSeq,
    logTruncated: session.logTruncated,
    entries,
  };
}

function clampTaskLine(input: string): string {
  const text = String(input || "").replace(/\r/g, "").trimEnd();
  if (!text) return "";
  return text.length > MAX_TASK_LOG_LINE_CHARS ? `${text.slice(0, MAX_TASK_LOG_LINE_CHARS)}…` : text;
}

function pushTaskLogLine(session: TaskSession, stream: TaskLogStream, line: string) {
  const text = clampTaskLine(line);
  if (!text && stream !== "system") return;
  const seq = session.nextSeq + 1;
  session.nextSeq = seq;
  session.updatedAtMs = Date.now();
  session.logs.push({
    seq,
    atISO: nowISO(),
    stream,
    text: text || (stream === "system" ? "(system)" : ""),
  });
  if (session.logs.length > MAX_TASK_LOG_LINES) {
    const drop = session.logs.length - MAX_TASK_LOG_LINES;
    session.logs.splice(0, drop);
    session.logTruncated = true;
  }
}

function toTaskStatusPayload(session: TaskSession) {
  return {
    type: "cav_task_status_v1",
    sessionId: session.id,
    taskId: session.taskId,
    taskLabel: session.label,
    command: session.command,
    cwd: session.cwd,
    status: session.status,
    isBackground: session.isBackground,
    createdAtISO: new Date(session.createdAtMs).toISOString(),
    updatedAtISO: new Date(session.updatedAtMs).toISOString(),
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    nextSeq: session.nextSeq,
    diagnostics: session.diagnostics.slice(0, 200),
  };
}

function readTaskLogs(session: TaskSession, afterSeq: number) {
  const after = Number.isFinite(Number(afterSeq)) ? Math.max(0, Math.trunc(Number(afterSeq))) : 0;
  const entries = session.logs
    .filter((entry) => entry.seq > after)
    .slice(0, TASK_POLL_BATCH);
  const nextSeq = entries.length ? entries[entries.length - 1].seq : after;
  return {
    type: "cav_task_logs_v1",
    sessionId: session.id,
    status: session.status,
    taskId: session.taskId,
    taskLabel: session.label,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    nextSeq,
    logTruncated: session.logTruncated,
    diagnostics: session.diagnostics.slice(0, 200),
    entries,
  };
}

function taskProblemSeverity(
  matchValue: string,
  fallback: "error" | "warn" | "info"
): "error" | "warn" | "info" {
  const v = s(matchValue).toLowerCase();
  if (v === "error" || v === "err") return "error";
  if (v === "warning" || v === "warn") return "warn";
  if (v === "info" || v === "information") return "info";
  return fallback;
}

function pushTaskDiagnostic(session: TaskSession, next: CavtoolsWorkspaceDiagnostic) {
  if (!next.message) return;
  const key = [
    next.file,
    String(next.line || 1),
    String(next.col || 1),
    next.severity,
    next.source || "",
    next.code || "",
    next.message,
  ].join("|");
  for (let i = 0; i < session.diagnostics.length; i += 1) {
    const row = session.diagnostics[i];
    const rowKey = [
      row.file,
      String(row.line || 1),
      String(row.col || 1),
      row.severity,
      row.source || "",
      row.code || "",
      row.message,
    ].join("|");
    if (rowKey === key) return;
  }
  session.diagnostics.push(next);
  if (session.diagnostics.length > 1600) {
    session.diagnostics.splice(0, session.diagnostics.length - 1600);
  }
}

function applyTaskProblemMatchers(session: TaskSession, line: string) {
  const text = String(line || "");
  for (const matcher of session.problemMatchers) {
    if (matcher.backgroundBegins && matcher.backgroundBegins.test(text)) {
      pushTaskLogLine(session, "system", `[task:${session.label}] background active`);
    }
    if (matcher.backgroundEnds && matcher.backgroundEnds.test(text)) {
      pushTaskLogLine(session, "system", `[task:${session.label}] background ready`);
    }
    if (!matcher.pattern) continue;
    const m = matcher.pattern.regex.exec(text);
    if (!m) continue;
    const fileToken = s(m[matcher.pattern.fileGroup] || "");
    if (!fileToken) continue;
    const fileAbs = path.isAbsolute(fileToken)
      ? path.normalize(fileToken)
      : path.normalize(path.join(session.cwd, fileToken));
    const file = toCavcodePathFromWorkspace(session.workspaceDir, fileAbs);
    const lineNum = Number(m[matcher.pattern.lineGroup] || "1");
    const colNum = Number(m[matcher.pattern.columnGroup] || "1");
    const message = s(m[matcher.pattern.messageGroup] || "");
    if (!message) continue;
    const severity = taskProblemSeverity(String(m[matcher.pattern.severityGroup] || ""), matcher.severity);
    const code = s(m[matcher.pattern.codeGroup] || "") || undefined;
    pushTaskDiagnostic(session, {
      file,
      line: Number.isFinite(lineNum) && Number.isInteger(lineNum) && lineNum > 0 ? Math.trunc(lineNum) : 1,
      col: Number.isFinite(colNum) && Number.isInteger(colNum) && colNum > 0 ? Math.trunc(colNum) : 1,
      severity,
      source: matcher.source || matcher.owner || "task",
      code,
      message,
      fixReady: Boolean(code),
    });
  }
}

function appendTaskChunk(session: TaskSession, stream: "stdout" | "stderr", chunk: Buffer | string) {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const prior = stream === "stdout" ? session.partialStdout : session.partialStderr;
  const all = `${prior}${normalized}`;
  const lines = all.split("\n");
  const tail = lines.pop() || "";
  for (const line of lines) {
    const clean = String(line || "");
    pushTaskLogLine(session, stream, clean);
    applyTaskProblemMatchers(session, clean);
  }
  if (stream === "stdout") session.partialStdout = tail;
  else session.partialStderr = tail;
}

function flushTaskPartials(session: TaskSession) {
  if (session.partialStdout) {
    pushTaskLogLine(session, "stdout", session.partialStdout);
    applyTaskProblemMatchers(session, session.partialStdout);
    session.partialStdout = "";
  }
  if (session.partialStderr) {
    pushTaskLogLine(session, "stderr", session.partialStderr);
    applyTaskProblemMatchers(session, session.partialStderr);
    session.partialStderr = "";
  }
}

async function persistTaskRunStart(session: TaskSession) {
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      INSERT INTO "CavCodeTaskRun" (
        "id",
        "accountId",
        "projectId",
        "userId",
        "taskId",
        "taskLabel",
        "command",
        "cwd",
        "isBackground",
        "status",
        "problemCount",
        "result"
      ) VALUES (
        ${session.historyId},
        ${session.accountId},
        ${session.projectId},
        ${session.userId},
        ${session.taskId},
        ${session.label},
        ${session.command},
        ${session.cwd},
        ${session.isBackground},
        ${session.status},
        ${session.diagnostics.length},
        CAST(${JSON.stringify({
          sessionId: session.id,
          startedAtISO: new Date(session.createdAtMs).toISOString(),
        })} AS jsonb)
      )
    `
  );
}

async function persistTaskRunUpdate(session: TaskSession) {
  await ensureCavcodeInfraTables();
  await prisma.$executeRaw(
    Prisma.sql`
      UPDATE "CavCodeTaskRun"
      SET
        "status" = ${session.status},
        "exitCode" = ${session.exitCode},
        "exitSignal" = ${session.exitSignal},
        "problemCount" = ${session.diagnostics.length},
        "result" = CAST(${JSON.stringify({
          sessionId: session.id,
          nextSeq: session.nextSeq,
          diagnostics: session.diagnostics.slice(0, 200),
        })} AS jsonb),
        "updatedAt" = CURRENT_TIMESTAMP,
        "finishedAt" = CASE
          WHEN ${session.status} IN ('exited', 'failed', 'stopped') THEN CURRENT_TIMESTAMP
          ELSE "finishedAt"
        END
      WHERE "id" = ${session.historyId}
    `
  );
}

async function cleanupTaskSessions() {
  const now = Date.now();
  const staleIds: string[] = [];
  for (const [id, session] of taskSessions.entries()) {
    const active = session.status === "starting" || session.status === "running";
    if (active) continue;
    if (now - session.updatedAtMs < TASK_SESSION_RETENTION_MS) continue;
    staleIds.push(id);
  }
  for (const id of staleIds) {
    const session = taskSessions.get(id);
    if (!session) continue;
    taskSessions.delete(id);
    try {
      await rm(session.workspaceDir, { recursive: true, force: true });
    } catch {}
  }
}

function assertTaskSessionAccess(ctx: ExecContext, sessionId: string): TaskSession {
  const session = taskSessions.get(sessionId);
  if (!session) throw new CavtoolsExecError("TASK_SESSION_NOT_FOUND", `Task session not found: ${sessionId}`, 404);
  if (session.accountId !== ctx.accountId || session.userId !== ctx.userId) {
    throw new CavtoolsExecError("UNAUTHORIZED", "Task session is not accessible for this operator.", 403, "ROLE_BLOCKED");
  }
  return session;
}

async function stopTaskSession(session: TaskSession, reason = "Task stop requested.") {
  session.stopRequested = true;
  pushTaskLogLine(session, "system", reason);
  const actor = reliabilityActorFromSession(session);
  if (!session.process) {
    session.status = "stopped";
    session.updatedAtMs = Date.now();
    if (actor) {
      await writeReliabilitySnapshot(actor, {
        kind: "task",
        scopeId: session.id,
        status: session.status,
        payload: toTaskStatusPayload(session),
      }).catch(() => {});
      await writeDeterministicReplay(actor, {
        category: "task",
        sessionId: session.id,
        action: "task.stop",
        payload: {
          reason,
          status: session.status,
        },
      }).catch(() => {});
    }
    await persistTaskRunUpdate(session).catch(() => {});
    return;
  }
  const active = session.status === "starting" || session.status === "running";
  if (!active) return;
  try {
    session.process.kill("SIGTERM");
  } catch {}
  const processRef = session.process;
  const timer = setTimeout(() => {
    try {
      if (processRef.exitCode == null) processRef.kill("SIGKILL");
    } catch {}
  }, 4500);
  timer.unref?.();
}

async function waitForTaskSessionExit(session: TaskSession, timeoutMs = 10 * 60 * 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < Math.max(1000, Math.trunc(timeoutMs))) {
    if (session.status !== "starting" && session.status !== "running") return;
    await sleep(80);
  }
  await stopTaskSession(session, "Task wait timeout reached; stopping task.");
  throw new CavtoolsExecError("TASK_TIMEOUT", `Task timed out: ${session.label}`, 408);
}

async function startTaskSessionFromDefinition(
  ctx: ExecContext,
  workspaceDir: string,
  task: DebugTaskDefinition,
  entryHintAbs: string | null,
  options?: {
    attachDebugSession?: DebugSession | null;
    waitForCompletion?: boolean;
  }
): Promise<TaskSession> {
  const cwdRel = task.cwd ? toRuntimeRelativePath(task.cwd) : null;
  const cwdAbs = cwdRel ? path.join(workspaceDir, cwdRel) : workspaceDir;
  const taskCwd = (await pathExists(cwdAbs)) ? cwdAbs : workspaceDir;
  const command = s(task.command || "");
  if (!command) throw new CavtoolsExecError("TASK_INVALID", `Task "${task.label}" is missing a command.`, 400);
  const renderedCommand = debugApplyLaunchTemplateVariables(command, workspaceDir, entryHintAbs);
  const renderedArgs = task.args.map((arg) => debugApplyLaunchTemplateVariables(s(arg), workspaceDir, entryHintAbs));
  const shellCommand = `${renderedCommand}${renderedArgs.length ? ` ${renderedArgs.map((arg) => shellQuoteArg(arg)).join(" ")}` : ""}`;
  const policy = await assertExecutionAllowed(ctx, {
    scope: "task",
    command: task.type === "shell" ? shellCommand : `${renderedCommand} ${renderedArgs.join(" ")}`.trim(),
    resource: `/cavcode/task/${task.id}`,
  });
  const scan = await runQuarantineScanForWorkspace({
    ctx,
    workspaceDir,
    targetKind: "task",
    targetPath: task.cwd || "/cavcode",
  });
  if (scan.verdict === "blocked") {
    throw new CavtoolsExecError(
      "SECURITY_QUARANTINE_BLOCKED",
      `Quarantine scan blocked task "${task.label}" (${scan.findings.length} finding${scan.findings.length === 1 ? "" : "s"}).`,
      403
    );
  }
  const secretEnv = await resolveSecretEnvForScope(ctx, "task").catch(() => ({}));

  const sessionId = `task_${hashCommandId(`${ctx.accountId}:${ctx.userId}:${ctx.project?.id || 0}:${task.id}:${Date.now()}`, taskCwd)}`;
  const session: TaskSession = {
    id: sessionId,
    key: runtimeProjectKey(ctx.accountId, ctx.project?.id || 0),
    accountId: ctx.accountId,
    userId: ctx.userId,
    projectId: ctx.project?.id || 0,
    taskId: task.id,
    label: task.label,
    command: task.type === "shell" ? shellCommand : `${renderedCommand}${renderedArgs.length ? ` ${renderedArgs.join(" ")}` : ""}`,
    cwd: taskCwd,
    workspaceDir,
    process: null,
    status: "starting",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    exitCode: null,
    exitSignal: null,
    stopRequested: false,
    isBackground: task.isBackground,
    nextSeq: 0,
    logTruncated: false,
    logs: [],
    partialStdout: "",
    partialStderr: "",
    diagnostics: [],
    problemMatchers: task.problemMatchers,
    historyId: `taskrun_${crypto.randomUUID()}`,
  };
  await persistTaskRunStart(session).catch(() => {});
  taskSessions.set(session.id, session);
  const actor = reliabilityActorFromSession(session);
  if (actor) {
    await writeReliabilitySnapshot(actor, {
      kind: "task",
      scopeId: session.id,
      status: session.status,
      payload: toTaskStatusPayload(session),
    }).catch(() => {});
    await writeDeterministicReplay(actor, {
      category: "task",
      sessionId: session.id,
      action: "task.start",
      payload: {
        taskId: session.taskId,
        taskLabel: session.label,
        command: session.command,
        status: session.status,
      },
    }).catch(() => {});
  }

  const child =
    task.type === "shell"
      ? spawn(process.env.SHELL || "/bin/sh", ["-lc", shellCommand], {
          cwd: taskCwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            ...task.env,
            ...secretEnv,
            FORCE_COLOR: "0",
            CAVCODE_TASK_SESSION_ID: session.id,
            CAVCODE_SECURITY_PROFILE: policy.profile,
            CAVCODE_SECURITY_SANDBOX: policy.sandboxMode,
            CAVCODE_SECURITY_NETWORK: policy.networkPolicy,
          },
        })
      : spawn(renderedCommand, renderedArgs, {
          cwd: taskCwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            ...task.env,
            ...secretEnv,
            FORCE_COLOR: "0",
            CAVCODE_TASK_SESSION_ID: session.id,
            CAVCODE_SECURITY_PROFILE: policy.profile,
            CAVCODE_SECURITY_SANDBOX: policy.sandboxMode,
            CAVCODE_SECURITY_NETWORK: policy.networkPolicy,
          },
        });

  session.process = child;
  pushTaskLogLine(session, "system", `[task:${task.label}] ${session.command}`);
  if (scan.verdict === "warn") {
    pushTaskLogLine(session, "system", `[security] quarantine warnings: ${scan.findings.length} finding(s).`);
  }
  if (options?.attachDebugSession) {
    pushDebugLogLine(options.attachDebugSession, "system", `[task:${task.label}] ${session.command}`);
  }

  child.stdout?.on("data", (chunk) => {
    appendTaskChunk(session, "stdout", chunk);
    if (options?.attachDebugSession) {
      const lines = String(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk || "").replace(/\r/g, "").split("\n");
      for (const line of lines) {
        const clean = s(line);
        if (!clean) continue;
        pushDebugLogLine(options.attachDebugSession, "stdout", `[task:${task.label}] ${clean}`);
      }
    }
  });
  child.stderr?.on("data", (chunk) => {
    appendTaskChunk(session, "stderr", chunk);
    if (options?.attachDebugSession) {
      const lines = String(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk || "").replace(/\r/g, "").split("\n");
      for (const line of lines) {
        const clean = s(line);
        if (!clean) continue;
        pushDebugLogLine(options.attachDebugSession, "stderr", `[task:${task.label}] ${clean}`);
      }
    }
  });
  child.on("spawn", () => {
    session.status = "running";
    session.updatedAtMs = Date.now();
    pushTaskLogLine(session, "system", "Task started.");
    if (actor) {
      void writeReliabilitySnapshot(actor, {
        kind: "task",
        scopeId: session.id,
        status: session.status,
        payload: toTaskStatusPayload(session),
      }).catch(() => {});
      void writeDeterministicReplay(actor, {
        category: "task",
        sessionId: session.id,
        action: "task.spawn",
        payload: toTaskStatusPayload(session),
      }).catch(() => {});
    }
    void persistTaskRunUpdate(session).catch(() => {});
  });
  child.on("error", (error) => {
    session.status = "failed";
    session.updatedAtMs = Date.now();
    pushTaskLogLine(session, "system", `Task process error: ${s(error?.message || "Unknown process error")}`);
    if (actor) {
      void writeCrashRecord(actor, {
        kind: "task",
        scopeId: session.id,
        error: s(error?.message || "Task process error"),
        stack: s((error as Error | null)?.stack || "") || null,
        payload: toTaskStatusPayload(session),
      }).catch(() => {});
      void writeReliabilitySnapshot(actor, {
        kind: "task",
        scopeId: session.id,
        status: session.status,
        payload: toTaskStatusPayload(session),
      }).catch(() => {});
      void writeDeterministicReplay(actor, {
        category: "task",
        sessionId: session.id,
        action: "task.error",
        payload: {
          error: s(error?.message || "Task process error"),
          status: session.status,
        },
      }).catch(() => {});
    }
    void persistTaskRunUpdate(session).catch(() => {});
  });
  child.on("exit", (code, signal) => {
    flushTaskPartials(session);
    session.exitCode = Number.isFinite(Number(code)) ? Math.trunc(Number(code)) : null;
    session.exitSignal = s(signal || "") || null;
    session.updatedAtMs = Date.now();
    if (session.stopRequested) {
      session.status = "stopped";
      pushTaskLogLine(session, "system", "Task stopped.");
    } else if (session.exitCode === 0) {
      session.status = "exited";
      pushTaskLogLine(session, "system", "Task completed successfully.");
    } else {
      session.status = "failed";
      pushTaskLogLine(session, "system", `Task failed${session.exitCode != null ? ` (exit ${session.exitCode})` : ""}.`);
    }
    if (actor) {
      void writeReliabilitySnapshot(actor, {
        kind: "task",
        scopeId: session.id,
        status: session.status,
        payload: toTaskStatusPayload(session),
      }).catch(() => {});
      void writeDeterministicReplay(actor, {
        category: "task",
        sessionId: session.id,
        action: "task.exit",
        payload: {
          status: session.status,
          exitCode: session.exitCode,
          exitSignal: session.exitSignal,
          diagnostics: session.diagnostics.length,
        },
      }).catch(() => {});
      if (session.status === "failed") {
        void writeCrashRecord(actor, {
          kind: "task",
          scopeId: session.id,
          error: `Task failed${session.exitCode != null ? ` (exit ${session.exitCode})` : ""}`,
          payload: toTaskStatusPayload(session),
        }).catch(() => {});
      }
    }
    void persistTaskRunUpdate(session).catch(() => {});
  });

  await publishCavcodeEvent(ctx, "task.start", {
    sessionId: session.id,
    taskId: task.id,
    taskLabel: task.label,
    command: session.command,
    isBackground: task.isBackground,
  }).catch(() => {});

  if (options?.waitForCompletion !== false && !task.isBackground) {
    await waitForTaskSessionExit(session);
    if (session.status !== "exited") {
      throw new CavtoolsExecError(
        "TASK_FAILED",
        `Task "${task.label}" failed (${session.exitCode ?? "signal"}): ${s(session.logs.slice(-8).map((row) => row.text).join("\n")) || "command failed"}`,
        400
      );
    }
  }
  return session;
}

async function readTaskRunHistory(args: {
  accountId: string;
  projectId: number;
  limit: number;
}): Promise<Array<{
  id: string;
  taskId: string;
  taskLabel: string;
  status: string;
  command: string;
  cwd: string;
  isBackground: boolean;
  exitCode: number | null;
  exitSignal: string | null;
  problemCount: number;
  createdAt: Date | string;
  updatedAt: Date | string;
  finishedAt: Date | string | null;
}>> {
  await ensureCavcodeInfraTables();
  const limit = Math.max(1, Math.min(200, Math.trunc(Number(args.limit) || 40)));
  return await prisma.$queryRaw<Array<{
    id: string;
    taskId: string;
    taskLabel: string;
    status: string;
    command: string;
    cwd: string;
    isBackground: boolean;
    exitCode: number | null;
    exitSignal: string | null;
    problemCount: number;
    createdAt: Date | string;
    updatedAt: Date | string;
    finishedAt: Date | string | null;
  }>>(
    Prisma.sql`
      SELECT
        "id",
        "taskId",
        "taskLabel",
        "status",
        "command",
        "cwd",
        "isBackground",
        "exitCode",
        "exitSignal",
        "problemCount",
        "createdAt",
        "updatedAt",
        "finishedAt"
      FROM "CavCodeTaskRun"
      WHERE "accountId" = ${args.accountId}
        AND "projectId" = ${args.projectId}
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `
  );
}

function clampProjectServiceLine(input: string): string {
  const text = String(input || "").replace(/\r/g, "").trimEnd();
  if (!text) return "";
  return text.length > MAX_PROJECT_SERVICE_LOG_LINE_CHARS ? `${text.slice(0, MAX_PROJECT_SERVICE_LOG_LINE_CHARS)}…` : text;
}

function pushProjectServiceLogLine(session: ProjectServiceSession, stream: "stdout" | "stderr" | "system", line: string) {
  const text = clampProjectServiceLine(line);
  if (!text && stream !== "system") return;
  const seq = session.nextSeq + 1;
  session.nextSeq = seq;
  session.updatedAtMs = Date.now();
  session.logs.push({
    seq,
    atISO: nowISO(),
    stream,
    text: text || (stream === "system" ? "(system)" : ""),
  });
  if (session.logs.length > MAX_PROJECT_SERVICE_LOG_LINES) {
    const drop = session.logs.length - MAX_PROJECT_SERVICE_LOG_LINES;
    session.logs.splice(0, drop);
    session.logTruncated = true;
  }
}

function readProjectServiceLogs(session: ProjectServiceSession, afterSeq: number) {
  const after = Number.isFinite(Number(afterSeq)) ? Math.max(0, Math.trunc(Number(afterSeq))) : 0;
  const entries = session.logs
    .filter((entry) => entry.seq > after)
    .slice(0, TASK_POLL_BATCH);
  const nextSeq = entries.length ? entries[entries.length - 1].seq : after;
  return {
    type: "cav_project_service_logs_v1",
    sessionId: session.id,
    status: session.status,
    nextSeq,
    logTruncated: session.logTruncated,
    entries,
  };
}

function projectServiceStatusPayload(session: ProjectServiceSession) {
  return {
    type: "cav_project_service_status_v1",
    sessionId: session.id,
    status: session.status,
    projectId: session.projectId,
    workspaceDir: session.workspaceDir,
    workspaceRealPath: session.workspaceRealPath,
    caseSensitiveFs: session.caseSensitiveFs,
    symlinkCount: session.symlinkCount,
    sourceVersion: session.sourceVersion,
    configFiles: session.configFiles,
    tsFileCount: session.tsFileCount,
    workspaceRoots: session.workspaceRoots,
    projectReferences: session.projectReferences,
    mounts: session.mounts,
    diagnostics: session.diagnostics.slice(0, 300),
    diagnosticsCount: session.diagnostics.length,
    refreshState: session.refreshState,
    createdAtISO: new Date(session.createdAtMs).toISOString(),
    updatedAtISO: new Date(session.updatedAtMs).toISOString(),
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    nextSeq: session.nextSeq,
  };
}

function projectServiceMessageToBuffer(message: Record<string, unknown>): Buffer {
  const body = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.from(`Content-Length: ${body.byteLength}\r\n\r\n`, "utf8");
  return Buffer.concat([header, body]);
}

function mapTsserverSeverity(
  categoryRaw: string | number
): "error" | "warn" | "info" {
  const text = String(categoryRaw || "").toLowerCase();
  if (text === "error" || text === "1") return "error";
  if (text === "warning" || text === "warn" || text === "2") return "warn";
  return "info";
}

function mapTsserverDiagnostics(
  session: ProjectServiceSession,
  eventName: string,
  body: Record<string, unknown> | null
): CavtoolsWorkspaceDiagnostic[] {
  const fileRaw = s(body?.file || "");
  if (!fileRaw) return [];
  const file = toCavcodePathFromWorkspace(session.workspaceDir, fileRaw);
  if (!file.startsWith("/cavcode/")) return [];
  const diagnostics = Array.isArray(body?.diagnostics) ? body?.diagnostics : [];
  const out: CavtoolsWorkspaceDiagnostic[] = [];
  for (const row of diagnostics as unknown[]) {
    const rec = asRecord(row);
    if (!rec) continue;
    const start = asRecord(rec.start);
    const line = Number(start?.line);
    const col = Number(start?.offset);
    const code = Number(rec.code);
    const messageText = ts.flattenDiagnosticMessageText(rec.text as ts.DiagnosticMessageChain | string, "\n").trim();
    if (!messageText) continue;
    out.push({
      file,
      line: Number.isFinite(line) && Number.isInteger(line) && line > 0 ? Math.trunc(line) : 1,
      col: Number.isFinite(col) && Number.isInteger(col) && col > 0 ? Math.trunc(col) : 1,
      severity: mapTsserverSeverity(rec.category as string | number),
      source: `tsserver:${eventName}`,
      code: Number.isFinite(code) ? `TS${Math.trunc(code)}` : undefined,
      message: messageText,
      fixReady: Number.isFinite(code),
    });
  }
  return out;
}

function rebuildProjectServiceDiagnostics(session: ProjectServiceSession) {
  const seen = new Set<string>();
  const out: CavtoolsWorkspaceDiagnostic[] = [];
  for (const rows of session.diagnosticsByFile.values()) {
    for (const row of rows) {
      const key = [
        row.file,
        String(row.line || 1),
        String(row.col || 1),
        row.severity,
        row.source || "",
        row.code || "",
        row.message,
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(row);
      if (out.length >= PROJECT_SERVICE_MAX_DIAGNOSTICS) break;
    }
    if (out.length >= PROJECT_SERVICE_MAX_DIAGNOSTICS) break;
  }
  out.sort((a, b) => {
    const rankA = a.severity === "error" ? 0 : a.severity === "warn" ? 1 : 2;
    const rankB = b.severity === "error" ? 0 : b.severity === "warn" ? 1 : 2;
    if (rankA !== rankB) return rankA - rankB;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    if (a.line !== b.line) return a.line - b.line;
    return a.col - b.col;
  });
  session.diagnostics = out;
}

function handleProjectServiceProtocolMessage(session: ProjectServiceSession, message: Record<string, unknown>) {
  const kind = s(message.type || "");
  if (!kind) return;
  if (kind === "response") {
    const requestSeq = Number(message.request_seq);
    if (!Number.isFinite(requestSeq) || !Number.isInteger(requestSeq) || requestSeq <= 0) return;
    const pending = session.pending.get(Math.trunc(requestSeq));
    if (!pending) return;
    session.pending.delete(Math.trunc(requestSeq));
    if (pending.timer) clearTimeout(pending.timer);
    if (message.success === false) {
      pending.reject(new CavtoolsExecError("PROJECT_SERVICE_REQUEST_FAILED", s(message.message || "tsserver request failed"), 400));
      return;
    }
    pending.resolve(message);
    return;
  }
  if (kind !== "event") return;
  const eventName = s(message.event || "");
  const body = asRecord(message.body);
  if (eventName === "requestCompleted") {
    const requestSeq = Number(body?.request_seq);
    if (Number.isFinite(requestSeq) && Number.isInteger(requestSeq) && requestSeq > 0) {
      session.geterrDone.add(Math.trunc(requestSeq));
    }
    return;
  }
  if (eventName === "semanticDiag" || eventName === "syntaxDiag" || eventName === "suggestionDiag") {
    const diags = mapTsserverDiagnostics(session, eventName, body);
    const fileKey = `${s(body?.file || "")}|${eventName}`;
    session.diagnosticsByFile.set(fileKey, diags);
    rebuildProjectServiceDiagnostics(session);
    return;
  }
  if (eventName === "projectLoadingStart" || eventName === "projectLoadingFinish") {
    pushProjectServiceLogLine(session, "system", `tsserver ${eventName}`);
  }
}

function consumeProjectServiceStdout(session: ProjectServiceSession, chunk: Buffer | string) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
  session.protocolBuffer += text;
  while (true) {
    const headerEnd = session.protocolBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const header = session.protocolBuffer.slice(0, headerEnd);
    const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!contentLengthMatch) {
      session.protocolBuffer = session.protocolBuffer.slice(headerEnd + 4);
      continue;
    }
    const length = Math.max(0, Math.trunc(Number(contentLengthMatch[1] || "0")));
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (session.protocolBuffer.length < bodyEnd) break;
    const bodyText = session.protocolBuffer.slice(bodyStart, bodyEnd);
    session.protocolBuffer = session.protocolBuffer.slice(bodyEnd);
    try {
      const parsed = JSON.parse(bodyText) as Record<string, unknown>;
      handleProjectServiceProtocolMessage(session, parsed);
    } catch (error) {
      pushProjectServiceLogLine(session, "stderr", `tsserver protocol parse error: ${s((error as Error | null)?.message || "unknown")}`);
    }
  }
}

async function projectServiceSendRequest(
  session: ProjectServiceSession,
  command: string,
  args: Record<string, unknown>,
  timeoutMs = 20_000
): Promise<Record<string, unknown>> {
  if (!session.process || session.process.stdin?.writable !== true) {
    throw new CavtoolsExecError("PROJECT_SERVICE_OFFLINE", "Project service process is not writable.", 409);
  }
  const seq = session.protocolSeq + 1;
  session.protocolSeq = seq;
  const payload: Record<string, unknown> = {
    seq,
    type: "request",
    command,
    arguments: args,
  };
  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pending.delete(seq);
      reject(new CavtoolsExecError("PROJECT_SERVICE_TIMEOUT", `tsserver request timed out: ${command}`, 408));
    }, Math.max(1000, Math.trunc(timeoutMs)));
    timer.unref?.();
    session.pending.set(seq, { command, resolve, reject, timer });
    try {
      session.process?.stdin?.write(projectServiceMessageToBuffer(payload));
    } catch (error) {
      if (timer) clearTimeout(timer);
      session.pending.delete(seq);
      reject(error);
    }
  });
  return result;
}

async function waitForProjectServiceGeterrCompletion(session: ProjectServiceSession, seqs: number[], timeoutMs = 25_000): Promise<void> {
  const start = Date.now();
  const waiting = new Set<number>(seqs.filter((value) => Number.isFinite(value) && value > 0));
  while (waiting.size > 0 && Date.now() - start < Math.max(1000, Math.trunc(timeoutMs))) {
    for (const seq of Array.from(waiting.values())) {
      if (session.geterrDone.has(seq)) waiting.delete(seq);
    }
    if (waiting.size === 0) break;
    await sleep(70);
  }
}

async function discoverProjectServiceConfigFiles(workspaceDir: string): Promise<{
  configFiles: string[];
  tsFileCount: number;
  workspaceRoots: string[];
  symlinkCount: number;
}> {
  const files = await collectLocalWorkspaceFiles(workspaceDir);
  const configFiles: string[] = [];
  let tsFileCount = 0;
  let symlinkCount = 0;
  const rootSet = new Set<string>();
  for (const relPath of files) {
    const lower = relPath.toLowerCase();
    const abs = path.join(workspaceDir, relPath);
    const top = relPath.split("/").filter(Boolean)[0];
    if (top) rootSet.add(normalizePath(`/cavcode/${top}`));
    if (
      lower === "tsconfig.json"
      || lower.endsWith("/tsconfig.json")
      || lower.endsWith(".tsconfig.json")
      || lower === "jsconfig.json"
      || lower.endsWith("/jsconfig.json")
    ) {
      configFiles.push(abs);
    }
    if (TS_LINT_FILE_RE.test(lower)) tsFileCount += 1;
    try {
      const stats = await lstat(abs, { bigint: false });
      if (stats.isSymbolicLink?.()) symlinkCount += 1;
    } catch {}
  }
  return {
    configFiles: configFiles.sort(),
    tsFileCount,
    workspaceRoots: Array.from(rootSet.values()).sort(),
    symlinkCount,
  };
}

async function discoverProjectServiceReferences(workspaceDir: string, configFiles: string[]): Promise<Array<{ configPath: string; referencePath: string }>> {
  const out: Array<{ configPath: string; referencePath: string }> = [];
  for (const configFile of configFiles) {
    let raw = "";
    try {
      raw = await readFile(configFile, "utf8");
    } catch {
      continue;
    }
    const parsed = ts.parseConfigFileTextToJson(configFile, raw);
    const config = asRecord(parsed.config);
    const refs = Array.isArray(config?.references) ? config?.references : [];
    for (const refRow of refs as unknown[]) {
      const refRec = asRecord(refRow);
      const refPath = s(refRec?.path || "");
      if (!refPath) continue;
      const absRef = path.normalize(path.resolve(path.dirname(configFile), refPath));
      out.push({
        configPath: toCavcodePathFromWorkspace(workspaceDir, configFile),
        referencePath: toCavcodePathFromWorkspace(workspaceDir, absRef),
      });
    }
  }
  return out;
}

async function projectServiceRunDiagnostics(session: ProjectServiceSession): Promise<void> {
  if (session.status !== "running") return;
  const pendingSeqs: number[] = [];
  session.geterrDone.clear();
  if (session.configFiles.length) {
    for (const configAbs of session.configFiles.slice(0, 300)) {
      const response = await projectServiceSendRequest(session, "geterrForProject", {
        file: configAbs,
        delay: 0,
      }, 12_000).catch(() => null);
      const seq = Number(response?.request_seq || response?.seq);
      if (Number.isFinite(seq) && Number.isInteger(seq) && seq > 0) pendingSeqs.push(Math.trunc(seq));
    }
  } else {
    const files = await collectLocalWorkspaceFiles(session.workspaceDir);
    const tsFiles = files
      .filter((relPath) => TS_LINT_FILE_RE.test(relPath))
      .slice(0, PROJECT_SERVICE_MAX_TS_FILES_FOR_GETERR)
      .map((relPath) => path.join(session.workspaceDir, relPath));
    if (tsFiles.length) {
      const response = await projectServiceSendRequest(session, "geterr", {
        files: tsFiles,
        delay: 0,
      }, 12_000).catch(() => null);
      const seq = Number(response?.request_seq || response?.seq);
      if (Number.isFinite(seq) && Number.isInteger(seq) && seq > 0) pendingSeqs.push(Math.trunc(seq));
    }
  }
  await waitForProjectServiceGeterrCompletion(session, pendingSeqs);
  rebuildProjectServiceDiagnostics(session);
}

async function cleanupProjectServiceSessions() {
  const now = Date.now();
  const staleIds: string[] = [];
  for (const [id, session] of projectServiceSessions.entries()) {
    const active = session.status === "starting" || session.status === "running";
    if (active) continue;
    if (now - session.updatedAtMs < PROJECT_SERVICE_SESSION_RETENTION_MS) continue;
    staleIds.push(id);
  }
  for (const id of staleIds) {
    const session = projectServiceSessions.get(id);
    if (!session) continue;
    projectServiceSessions.delete(id);
    const activeId = projectServiceSessionByProject.get(session.key);
    if (activeId === id) projectServiceSessionByProject.delete(session.key);
    if (session.watcherTimer) clearInterval(session.watcherTimer);
    try {
      await rm(session.workspaceDir, { recursive: true, force: true });
    } catch {}
  }
}

function assertProjectServiceSessionAccess(ctx: ExecContext, sessionId: string): ProjectServiceSession {
  const session = projectServiceSessions.get(sessionId);
  if (!session) throw new CavtoolsExecError("PROJECT_SERVICE_NOT_FOUND", `Project service session not found: ${sessionId}`, 404);
  if (session.accountId !== ctx.accountId || session.userId !== ctx.userId) {
    throw new CavtoolsExecError("UNAUTHORIZED", "Project service session is not accessible for this operator.", 403, "ROLE_BLOCKED");
  }
  return session;
}

async function stopProjectServiceSession(session: ProjectServiceSession, reason = "Project service stop requested.") {
  session.stopRequested = true;
  pushProjectServiceLogLine(session, "system", reason);
  const actor = reliabilityActorFromSession(session);
  if (session.watcherTimer) {
    clearInterval(session.watcherTimer);
    session.watcherTimer = null;
  }
  for (const pending of session.pending.values()) {
    if (pending.timer) clearTimeout(pending.timer);
    pending.reject(new CavtoolsExecError("PROJECT_SERVICE_STOPPED", "Project service stopped.", 409));
  }
  session.pending.clear();
  if (!session.process) {
    session.status = "stopped";
    session.updatedAtMs = Date.now();
    if (actor) {
      await writeReliabilitySnapshot(actor, {
        kind: "project-service",
        scopeId: session.id,
        status: session.status,
        payload: projectServiceStatusPayload(session),
      }).catch(() => {});
      await writeDeterministicReplay(actor, {
        category: "project-service",
        sessionId: session.id,
        action: "project.service.stop",
        payload: {
          reason,
          status: session.status,
        },
      }).catch(() => {});
    }
    return;
  }
  const active = session.status === "starting" || session.status === "running";
  if (!active) return;
  try {
    session.process.kill("SIGTERM");
  } catch {}
  const processRef = session.process;
  const timer = setTimeout(() => {
    try {
      if (processRef.exitCode == null) processRef.kill("SIGKILL");
    } catch {}
  }, 3500);
  timer.unref?.();
}

async function projectServiceSyncWorkspace(
  ctx: ExecContext,
  session: ProjectServiceSession,
  opts?: { forceDiagnostics?: boolean }
): Promise<void> {
  const sync = await syncMountedWorkspaceToDirectory(ctx, session.workspaceDir);
  session.refreshState = {
    filesWritten: sync.filesWritten,
    filesRemoved: sync.filesRemoved,
    bytesWritten: sync.bytesWritten,
    warnings: sync.warnings,
    syncedAtISO: nowISO(),
  };
  if (sync.filesWritten || sync.filesRemoved || opts?.forceDiagnostics) {
    await projectServiceSendRequest(session, "reloadProjects", {}, 8000).catch(() => null);
    session.sourceVersion += 1;
    await projectServiceRunDiagnostics(session).catch(() => null);
  }
}

async function startProjectServiceSession(
  ctx: ExecContext,
  options?: { stopExisting?: boolean }
): Promise<ProjectServiceSession> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for project service.", 400);
  await cleanupProjectServiceSessions();
  const policy = await assertExecutionAllowed(ctx, {
    scope: "project-service",
    command: "project-service start tsserver",
    resource: "/cavcode/.vscode",
  });
  const key = runtimeProjectKey(ctx.accountId, ctx.project.id);
  const activeId = projectServiceSessionByProject.get(key);
  if (activeId && options?.stopExisting !== false) {
    const existing = projectServiceSessions.get(activeId);
    if (existing) await stopProjectServiceSession(existing, "Stopped previous project service session.");
  }

  const stage = await materializeRuntimeWorkspace(ctx);
  const scan = await runQuarantineScanForWorkspace({
    ctx,
    workspaceDir: stage.workspaceDir,
    targetKind: "project-service",
    targetPath: "/cavcode",
  });
  if (scan.verdict === "blocked") {
    try {
      await rm(stage.workspaceDir, { recursive: true, force: true });
    } catch {}
    throw new CavtoolsExecError(
      "SECURITY_QUARANTINE_BLOCKED",
      `Quarantine scan blocked project service start (${scan.findings.length} finding${scan.findings.length === 1 ? "" : "s"}).`,
      403
    );
  }
  const workspaceDir = stage.workspaceDir;
  const tsserverPath = path.join(process.cwd(), "node_modules", "typescript", "lib", "tsserver.js");
  if (!await pathExists(tsserverPath)) {
    throw new CavtoolsExecError("PROJECT_SERVICE_UNAVAILABLE", "typescript/lib/tsserver.js is not available.", 500);
  }
  const mountRows = await cavcodeMounts(ctx);
  const discovered = await discoverProjectServiceConfigFiles(workspaceDir);
  const projectReferences = await discoverProjectServiceReferences(workspaceDir, discovered.configFiles);
  const workspaceRealPath = await realpath(workspaceDir).catch(() => workspaceDir);
  const sessionId = `ps_${hashCommandId(`${ctx.accountId}:${ctx.userId}:${ctx.project.id}:${Date.now()}`, workspaceDir)}`;
  const session: ProjectServiceSession = {
    id: sessionId,
    key,
    accountId: ctx.accountId,
    userId: ctx.userId,
    projectId: ctx.project.id,
    workspaceDir,
    process: null,
    status: "starting",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    stopRequested: false,
    exitCode: null,
    exitSignal: null,
    nextSeq: 0,
    logTruncated: false,
    logs: [],
    partialStdout: "",
    partialStderr: "",
    protocolSeq: 0,
    protocolBuffer: "",
    pending: new Map(),
    configFiles: discovered.configFiles,
    tsFileCount: discovered.tsFileCount,
    workspaceRoots: discovered.workspaceRoots,
    projectReferences,
    mounts: mountRows.map((row) => ({
      id: row.id,
      sourceType: row.sourceType,
      mountPath: row.mountPath,
      mode: row.mode,
    })),
    caseSensitiveFs: Boolean(ts.sys.useCaseSensitiveFileNames),
    workspaceRealPath,
    symlinkCount: discovered.symlinkCount,
    diagnostics: [],
    diagnosticsByFile: new Map(),
    activeGeterrSeq: null,
    geterrDone: new Set(),
    refreshState: {
      filesWritten: stage.filesMaterialized,
      filesRemoved: 0,
      bytesWritten: stage.bytesMaterialized,
      warnings: stage.warnings,
      syncedAtISO: nowISO(),
    },
    watcherTimer: null,
    sourceVersion: 1,
  };

  const child = spawn(process.execPath, [tsserverPath, "--useInferredProjectPerProjectRoot", "true", "--disableAutomaticTypingAcquisition"], {
    cwd: workspaceDir,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      ...(await resolveSecretEnvForScope(ctx, "project-service").catch(() => ({}))),
      TSS_LOG: "",
      CAVCODE_PROJECT_SERVICE_ID: sessionId,
      CAVCODE_SECURITY_PROFILE: policy.profile,
      CAVCODE_SECURITY_SANDBOX: policy.sandboxMode,
      CAVCODE_SECURITY_NETWORK: policy.networkPolicy,
    },
  });
  session.process = child;
  projectServiceSessions.set(session.id, session);
  projectServiceSessionByProject.set(key, session.id);
  pushProjectServiceLogLine(session, "system", `Starting tsserver: ${tsserverPath}`);
  const actor = reliabilityActorFromSession(session);
  if (actor) {
    await writeReliabilitySnapshot(actor, {
      kind: "project-service",
      scopeId: session.id,
      status: session.status,
      payload: projectServiceStatusPayload(session),
    }).catch(() => {});
    await writeDeterministicReplay(actor, {
      category: "project-service",
      sessionId: session.id,
      action: "project.service.start",
      payload: projectServiceStatusPayload(session),
    }).catch(() => {});
  }
  if (scan.verdict === "warn") {
    pushProjectServiceLogLine(session, "system", `[security] quarantine warnings: ${scan.findings.length} finding(s).`);
  }

  child.stdout?.on("data", (chunk) => consumeProjectServiceStdout(session, chunk));
  child.stderr?.on("data", (chunk) => {
    const text = String(Buffer.isBuffer(chunk) ? chunk.toString("utf8") : chunk || "").replace(/\r/g, "");
    for (const line of text.split("\n")) {
      const clean = s(line);
      if (!clean) continue;
      pushProjectServiceLogLine(session, "stderr", clean);
    }
  });
  child.on("spawn", () => {
    session.status = "running";
    session.updatedAtMs = Date.now();
    pushProjectServiceLogLine(session, "system", "Project service started.");
    if (actor) {
      void writeReliabilitySnapshot(actor, {
        kind: "project-service",
        scopeId: session.id,
        status: session.status,
        payload: projectServiceStatusPayload(session),
      }).catch(() => {});
      void writeDeterministicReplay(actor, {
        category: "project-service",
        sessionId: session.id,
        action: "project.service.spawn",
        payload: projectServiceStatusPayload(session),
      }).catch(() => {});
    }
  });
  child.on("error", (error) => {
    session.status = "failed";
    session.updatedAtMs = Date.now();
    pushProjectServiceLogLine(session, "stderr", `Project service process error: ${s(error?.message || "Unknown process error")}`);
    if (actor) {
      void writeCrashRecord(actor, {
        kind: "project-service",
        scopeId: session.id,
        error: s(error?.message || "Project service process error"),
        stack: s((error as Error | null)?.stack || "") || null,
        payload: projectServiceStatusPayload(session),
      }).catch(() => {});
      void writeReliabilitySnapshot(actor, {
        kind: "project-service",
        scopeId: session.id,
        status: session.status,
        payload: projectServiceStatusPayload(session),
      }).catch(() => {});
      void writeDeterministicReplay(actor, {
        category: "project-service",
        sessionId: session.id,
        action: "project.service.error",
        payload: {
          error: s(error?.message || "Project service process error"),
          status: session.status,
        },
      }).catch(() => {});
    }
  });
  child.on("exit", (code, signal) => {
    session.exitCode = Number.isFinite(Number(code)) ? Math.trunc(Number(code)) : null;
    session.exitSignal = s(signal || "") || null;
    session.updatedAtMs = Date.now();
    if (session.stopRequested) {
      session.status = "stopped";
      pushProjectServiceLogLine(session, "system", "Project service stopped.");
    } else if (session.exitCode === 0) {
      session.status = "stopped";
      pushProjectServiceLogLine(session, "system", "Project service exited.");
    } else {
      session.status = "failed";
      pushProjectServiceLogLine(session, "stderr", `Project service failed${session.exitCode != null ? ` (exit ${session.exitCode})` : ""}.`);
    }
    if (actor) {
      void writeReliabilitySnapshot(actor, {
        kind: "project-service",
        scopeId: session.id,
        status: session.status,
        payload: projectServiceStatusPayload(session),
      }).catch(() => {});
      void writeDeterministicReplay(actor, {
        category: "project-service",
        sessionId: session.id,
        action: "project.service.exit",
        payload: {
          status: session.status,
          exitCode: session.exitCode,
          exitSignal: session.exitSignal,
        },
      }).catch(() => {});
      if (session.status === "failed") {
        void writeCrashRecord(actor, {
          kind: "project-service",
          scopeId: session.id,
          error: `Project service failed${session.exitCode != null ? ` (exit ${session.exitCode})` : ""}`,
          payload: projectServiceStatusPayload(session),
        }).catch(() => {});
      }
    }
  });

  await projectServiceSendRequest(session, "configure", {
    hostInfo: "cavcode",
    preferences: {
      includeCompletionsForModuleExports: true,
      includeCompletionsForImportStatements: true,
      allowIncompleteCompletions: true,
      includeAutomaticOptionalChainCompletions: true,
    },
  }, 8000).catch(() => null);
  await projectServiceSendRequest(session, "compilerOptionsForInferredProjects", {
    options: {
      allowJs: true,
      checkJs: false,
      allowSyntheticDefaultImports: true,
      skipLibCheck: true,
      strictNullChecks: false,
      moduleResolution: "Bundler",
      target: "ES2022",
    },
  }, 8000).catch(() => null);
  await projectServiceRunDiagnostics(session).catch(() => null);
  await publishCavcodeEvent(ctx, "project.service.start", {
    sessionId: session.id,
    configFiles: session.configFiles.length,
    tsFileCount: session.tsFileCount,
  });

  const watchCtx = ctx;
  session.watcherTimer = setInterval(() => {
    if (session.stopRequested || session.status !== "running") return;
    void projectServiceSyncWorkspace(watchCtx, session).catch((error) => {
      pushProjectServiceLogLine(session, "stderr", `Project service sync failed: ${s((error as Error | null)?.message || "unknown")}`);
    });
  }, PROJECT_SERVICE_WATCH_INTERVAL_MS);
  session.watcherTimer.unref?.();

  return session;
}

function clampDebugLine(input: string): string {
  const text = String(input || "").replace(/\r/g, "").trimEnd();
  if (!text) return "";
  return text.length > MAX_DEBUG_LOG_LINE_CHARS ? `${text.slice(0, MAX_DEBUG_LOG_LINE_CHARS)}…` : text;
}

function pushDebugLogLine(session: DebugSession, stream: DebugLogStream, line: string) {
  const text = clampDebugLine(line);
  if (!text && stream !== "system") return;
  const seq = session.nextSeq + 1;
  session.nextSeq = seq;
  session.updatedAtMs = Date.now();
  session.logs.push({
    seq,
    atISO: nowISO(),
    stream,
    text: text || (stream === "system" ? "(system)" : ""),
  });
  if (session.logs.length > MAX_DEBUG_LOG_LINES) {
    const drop = session.logs.length - MAX_DEBUG_LOG_LINES;
    session.logs.splice(0, drop);
    session.logTruncated = true;
  }
}

const NODE_DEBUG_ADAPTER_CAPABILITIES: DebugAdapterCapabilities = {
  supportsConditionalBreakpoints: true,
  supportsHitConditionalBreakpoints: true,
  supportsLogPoints: true,
  supportsFunctionBreakpoints: true,
  supportsExceptionFilterOptions: true,
  supportsStepBack: false,
  supportsSetVariable: false,
  supportsEvaluateForHovers: true,
  supportsDataBreakpoints: false,
  supportsReadMemoryRequest: false,
};

const CHROME_DEBUG_ADAPTER_CAPABILITIES: DebugAdapterCapabilities = {
  supportsConditionalBreakpoints: true,
  supportsHitConditionalBreakpoints: true,
  supportsLogPoints: true,
  supportsFunctionBreakpoints: true,
  supportsExceptionFilterOptions: true,
  supportsStepBack: false,
  supportsSetVariable: false,
  supportsEvaluateForHovers: true,
  supportsDataBreakpoints: false,
  supportsReadMemoryRequest: false,
};

const DEBUG_ADAPTER_REGISTRY: Record<DebugAdapterId, DebugAdapterDefinition> = {
  "node-inspector": {
    id: "node-inspector",
    label: "Node Inspector Adapter",
    launchTypes: ["node", "pwa-node", "node2"],
    languageHints: ["javascript", "typescript", "node"],
    capabilities: NODE_DEBUG_ADAPTER_CAPABILITIES,
  },
  "chrome-inspector": {
    id: "chrome-inspector",
    label: "Chrome Inspector Adapter",
    launchTypes: ["chrome", "pwa-chrome", "msedge", "pwa-msedge"],
    languageHints: ["javascript", "typescript", "web"],
    capabilities: CHROME_DEBUG_ADAPTER_CAPABILITIES,
  },
};

function debugDefaultAdapter(): DebugAdapterDefinition {
  return DEBUG_ADAPTER_REGISTRY["node-inspector"];
}

function debugAdapterFromLaunchType(debugTypeValue: string | null | undefined): DebugAdapterDefinition {
  const debugType = s(debugTypeValue || "").toLowerCase();
  if (!debugType) return debugDefaultAdapter();
  for (const adapter of Object.values(DEBUG_ADAPTER_REGISTRY)) {
    if (adapter.launchTypes.some((item) => item.toLowerCase() === debugType)) return adapter;
  }
  return debugDefaultAdapter();
}

function debugAdapterForEntryPath(entryCavcodePath: string): DebugAdapterDefinition {
  const ext = path.extname(s(entryCavcodePath || "").toLowerCase());
  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs") {
    return DEBUG_ADAPTER_REGISTRY["node-inspector"];
  }
  return debugDefaultAdapter();
}

function debugSlug(input: string): string {
  const slug = s(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "target";
}

function escapeRegex(input: string): string {
  return String(input || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDebugWsUrlLine(line: string): string | null {
  const text = String(line || "");
  const match = text.match(/Debugger listening on (ws:\/\/[^\s]+)/i);
  if (!match) return null;
  return s(match[1]);
}

function debugApplyLaunchTemplateVariables(
  value: string,
  workspaceDir: string,
  entryAbsPath: string | null
): string {
  const entryAbsolute = entryAbsPath ? path.normalize(entryAbsPath) : "";
  const entryRelative = entryAbsolute ? path.relative(workspaceDir, entryAbsolute).replace(/\\/g, "/") : "";
  return String(value || "").replace(/\$\{([^}]+)\}/g, (_match, tokenRaw) => {
    const token = String(tokenRaw || "");
    if (token === "workspaceFolder") return workspaceDir;
    if (token === "workspaceFolderBasename") return path.basename(workspaceDir);
    if (token === "file") return entryAbsolute || "";
    if (token === "relativeFile") return entryRelative || "";
    if (token.startsWith("env:")) {
      const key = token.slice(4).trim();
      return key ? String(process.env[key] || "") : "";
    }
    return "";
  });
}

function debugLaunchPathToAbsolute(
  workspaceDir: string,
  value: string | null | undefined,
  entryAbsPath: string | null
): string | null {
  const templated = s(debugApplyLaunchTemplateVariables(s(value), workspaceDir, entryAbsPath));
  if (!templated) return null;
  if (templated.startsWith("/cavcode/")) {
    const rel = toRuntimeRelativePath(templated);
    if (!rel) return null;
    return path.normalize(path.join(workspaceDir, rel));
  }
  if (templated.startsWith("file://")) {
    try {
      return path.normalize(decodeURIComponent(new URL(templated).pathname));
    } catch {
      return path.normalize(templated.replace(/^file:\/\//, ""));
    }
  }
  if (path.isAbsolute(templated)) return path.normalize(templated);
  return path.normalize(path.join(workspaceDir, templated));
}

function debugCoerceStringArray(value: unknown, workspaceDir: string, entryAbsPath: string | null): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => debugApplyLaunchTemplateVariables(s(item || ""), workspaceDir, entryAbsPath))
    .map((item) => s(item))
    .filter(Boolean);
}

function debugCoerceEnvMap(value: unknown, workspaceDir: string, entryAbsPath: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  if (!row) return out;
  for (const [key, raw] of Object.entries(row)) {
    const k = s(key);
    if (!k) continue;
    const rendered = debugApplyLaunchTemplateVariables(s(raw), workspaceDir, entryAbsPath);
    out[k] = String(rendered);
  }
  return out;
}

function debugPathToCavcode(workspaceDir: string, absolutePath: string | null): string | null {
  const abs = s(absolutePath || "");
  if (!abs) return null;
  const normalizedRoot = path.normalize(workspaceDir);
  const normalized = path.normalize(abs);
  if (!normalized.startsWith(normalizedRoot)) return null;
  return toCavcodePathFromWorkspace(workspaceDir, normalized);
}

function toTaskMatcherPattern(value: unknown): TaskProblemMatcherPattern | null {
  const row = asRecord(value);
  if (!row) return null;
  const regexpText = s(row.regexp || row.regex || "");
  if (!regexpText) return null;
  let regex: RegExp;
  try {
    regex = new RegExp(regexpText);
  } catch {
    return null;
  }
  const locationRaw = s(row.location || "");
  const locationParts = locationRaw
    .split(",")
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && Number.isInteger(item) && item > 0) as number[];
  const lineGroup = Number.isFinite(Number(row.line)) ? Math.max(1, Math.trunc(Number(row.line))) : (locationParts[0] || 2);
  const columnGroup = Number.isFinite(Number(row.column)) ? Math.max(1, Math.trunc(Number(row.column))) : (locationParts[1] || 3);
  const messageGroup = Number.isFinite(Number(row.message)) ? Math.max(1, Math.trunc(Number(row.message))) : 6;
  return {
    regex,
    fileGroup: Number.isFinite(Number(row.file)) ? Math.max(1, Math.trunc(Number(row.file))) : 1,
    lineGroup,
    columnGroup,
    codeGroup: Number.isFinite(Number(row.code)) ? Math.max(1, Math.trunc(Number(row.code))) : 5,
    severityGroup: Number.isFinite(Number(row.severity)) ? Math.max(1, Math.trunc(Number(row.severity))) : 4,
    messageGroup,
  };
}

function taskBuiltinProblemMatcher(idRaw: string, taskLabel: string): TaskProblemMatcher | null {
  const id = s(idRaw).toLowerCase();
  if (!id) return null;
  if (id === "$tsc" || id === "$tsc-watch") {
    return {
      id: `matcher_${debugSlug(taskLabel)}_${debugSlug(id)}`,
      owner: "typescript",
      source: "typescript",
      severity: "error",
      pattern: {
        regex: /^(.+)\((\d+),(\d+)\):\s(error|warning)\s(TS\d+):\s(.+)$/,
        fileGroup: 1,
        lineGroup: 2,
        columnGroup: 3,
        codeGroup: 5,
        severityGroup: 4,
        messageGroup: 6,
      },
      backgroundBegins: id === "$tsc-watch" ? /Starting compilation in watch mode/i : null,
      backgroundEnds: id === "$tsc-watch" ? /Found \d+ errors?\. Watching for file changes\./i : null,
    };
  }
  if (id === "$eslint-stylish" || id === "$eslint-compact") {
    return {
      id: `matcher_${debugSlug(taskLabel)}_${debugSlug(id)}`,
      owner: "eslint",
      source: "eslint",
      severity: "warn",
      pattern: {
        regex: /^(.+):\sline\s(\d+),\scol\s(\d+),\s(Error|Warning)\s-\s(.+)\s\(([^)]+)\)$/,
        fileGroup: 1,
        lineGroup: 2,
        columnGroup: 3,
        codeGroup: 6,
        severityGroup: 4,
        messageGroup: 5,
      },
      backgroundBegins: null,
      backgroundEnds: null,
    };
  }
  return null;
}

function parseTaskProblemMatchers(value: unknown, taskLabel: string): TaskProblemMatcher[] {
  const rows = Array.isArray(value) ? value : value == null ? [] : [value];
  const out: TaskProblemMatcher[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const raw = rows[i];
    if (typeof raw === "string") {
      const builtIn = taskBuiltinProblemMatcher(raw, taskLabel);
      if (builtIn) out.push(builtIn);
      continue;
    }
    const rec = asRecord(raw);
    if (!rec) continue;
    const owner = s(rec.owner || rec.source || `task_${debugSlug(taskLabel)}`) || `task_${debugSlug(taskLabel)}`;
    const source = s(rec.source || owner) || owner;
    const severityRaw = s(rec.severity || "").toLowerCase();
    const severity: "error" | "warn" | "info" =
      severityRaw === "error" ? "error" : severityRaw === "warn" || severityRaw === "warning" ? "warn" : "info";
    const patternRaw = Array.isArray(rec.pattern) ? rec.pattern[0] : rec.pattern;
    const pattern = toTaskMatcherPattern(patternRaw);
    const background = asRecord(rec.background);
    const beginText = s(asRecord(background?.beginsPattern)?.regexp || background?.beginsPattern || "");
    const endText = s(asRecord(background?.endsPattern)?.regexp || background?.endsPattern || "");
    let backgroundBegins: RegExp | null = null;
    let backgroundEnds: RegExp | null = null;
    if (beginText) {
      try { backgroundBegins = new RegExp(beginText, "i"); } catch {}
    }
    if (endText) {
      try { backgroundEnds = new RegExp(endText, "i"); } catch {}
    }
    out.push({
      id: `matcher_${i + 1}_${debugSlug(taskLabel)}`,
      owner,
      source,
      severity,
      pattern,
      backgroundBegins,
      backgroundEnds,
    });
  }
  return out;
}

async function readDebugTaskDefinitionsFromWorkspace(
  workspaceDir: string,
  entryHintAbs: string | null
): Promise<DebugTaskDefinition[]> {
  const tasksPath = path.join(workspaceDir, ".vscode", "tasks.json");
  if (!await pathExists(tasksPath)) return [];
  const raw = await readFile(tasksPath, "utf8");
  const parsed = ts.parseConfigFileTextToJson(tasksPath, raw);
  if (parsed.error) {
    const message = ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n").trim() || "Invalid .vscode/tasks.json";
    throw new CavtoolsExecError("DEBUG_TASKS_JSON_INVALID", message, 400);
  }
  const root = asRecord(parsed.config);
  const rows = Array.isArray(root?.tasks) ? root.tasks : [];
  const out: DebugTaskDefinition[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const rec = asRecord(rows[i]);
    if (!rec) continue;
    const label = s(rec.label || rec.taskName || rec.name || `Task ${i + 1}`);
    if (!label) continue;
    const taskType = s(rec.type || "shell").toLowerCase() || "shell";
    const command = s(debugApplyLaunchTemplateVariables(s(rec.command || ""), workspaceDir, entryHintAbs));
    const args = debugCoerceStringArray(rec.args, workspaceDir, entryHintAbs);
    const detail = s(rec.detail || rec.presentationOptions || "") || null;
    const options = asRecord(rec.options);
    const cwdAbs = debugLaunchPathToAbsolute(workspaceDir, s(options?.cwd || ""), entryHintAbs);
    const env = debugCoerceEnvMap(options?.env, workspaceDir, entryHintAbs);
    const dependsOn = (() => {
      const rawDepends = rec.dependsOn;
      if (Array.isArray(rawDepends)) {
        return rawDepends.map((row) => s(row)).filter(Boolean);
      }
      const single = s(rawDepends || "");
      return single ? [single] : [];
    })();
    const npmScript = s(rec.script || "");
    const normalizedCommand = taskType === "npm" && !command ? "npm" : command;
    const normalizedArgs =
      taskType === "npm"
        ? (() => {
            const scriptName = npmScript || label;
            if (!scriptName) return [...args];
            return ["run", scriptName, ...args];
          })()
        : args;
    const group = (() => {
      const rawGroup = rec.group;
      if (typeof rawGroup === "string") return s(rawGroup) || null;
      const groupRec = asRecord(rawGroup);
      return s(groupRec?.kind || groupRec?.label || "") || null;
    })();
    const isBackground = rec.isBackground === true;
    const problemMatchers = parseTaskProblemMatchers(rec.problemMatcher, label);
    out.push({
      id: `task_${i + 1}_${debugSlug(label)}`,
      label,
      type: taskType,
      command: normalizedCommand,
      args: normalizedArgs,
      cwd: debugPathToCavcode(workspaceDir, cwdAbs),
      env,
      detail,
      dependsOn,
      group,
      isBackground,
      problemMatchers,
      raw: rec,
    });
  }
  return out;
}

function resolveDebugTaskDefinition(tasks: DebugTaskDefinition[], selectorRaw: string | null | undefined): DebugTaskDefinition | null {
  const selector = s(selectorRaw || "");
  if (!selector) return null;
  const lowered = selector.toLowerCase();
  const byId = tasks.find((task) => task.id.toLowerCase() === lowered);
  if (byId) return byId;
  const byLabel = tasks.find((task) => task.label.toLowerCase() === lowered);
  if (byLabel) return byLabel;
  const bySlug = tasks.find((task) => debugSlug(task.label) === debugSlug(lowered));
  if (bySlug) return bySlug;
  return null;
}

function mergeDebugEnvMaps(...maps: Array<Record<string, string> | null | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of maps) {
    if (!row) continue;
    for (const [key, value] of Object.entries(row)) {
      const k = s(key);
      if (!k) continue;
      out[k] = String(value ?? "");
    }
  }
  return out;
}

function parseDebugLaunchProfiles(
  root: Record<string, unknown> | null,
  workspaceDir: string,
  entryHintAbs: string | null
): DebugLaunchProfile[] {
  const profileRoot = asRecord((asRecord(root?.cavcode || {})?.profiles ?? root?.cavcodeProfiles) || {});
  if (!profileRoot) return [];
  const out: DebugLaunchProfile[] = [];
  const entries = Object.entries(profileRoot);
  for (let i = 0; i < entries.length; i += 1) {
    const [nameRaw, value] = entries[i];
    const rec = asRecord(value);
    if (!rec) continue;
    const name = s(nameRaw || rec.name || "");
    if (!name) continue;
    const runtimeExecutable = s(debugApplyLaunchTemplateVariables(s(rec.runtimeExecutable || ""), workspaceDir, entryHintAbs)) || null;
    const cwdAbs = debugLaunchPathToAbsolute(workspaceDir, s(rec.cwd || ""), entryHintAbs);
    out.push({
      id: `profile_${i + 1}_${debugSlug(name)}`,
      name,
      description: s(rec.description || rec.detail || "") || null,
      runtimeExecutable,
      runtimeArgs: debugCoerceStringArray(rec.runtimeArgs, workspaceDir, entryHintAbs),
      programArgs: debugCoerceStringArray(rec.args, workspaceDir, entryHintAbs),
      cwdCavcodePath: debugPathToCavcode(workspaceDir, cwdAbs),
      env: debugCoerceEnvMap(rec.env, workspaceDir, entryHintAbs),
      preLaunchTask: s(rec.preLaunchTask || "") || null,
      postDebugTask: s(rec.postDebugTask || "") || null,
      raw: rec,
    });
  }
  return out;
}

function resolveDebugLaunchProfile(
  profiles: DebugLaunchProfile[],
  selectorRaw: string | null | undefined
): DebugLaunchProfile | null {
  const selector = s(selectorRaw || "");
  if (!selector) return null;
  const lowered = selector.toLowerCase();
  const byId = profiles.find((profile) => profile.id.toLowerCase() === lowered);
  if (byId) return byId;
  const byName = profiles.find((profile) => profile.name.toLowerCase() === lowered);
  if (byName) return byName;
  const bySlug = profiles.find((profile) => debugSlug(profile.name) === debugSlug(lowered));
  if (bySlug) return bySlug;
  return null;
}

function parseDebugWorkspaceVariants(
  root: Record<string, unknown> | null,
  workspaceDir: string,
  entryHintAbs: string | null
): DebugWorkspaceVariant[] {
  const variantRows = Array.isArray((asRecord(root?.cavcode || {})?.workspaceVariants ?? root?.workspaceVariants))
    ? ((asRecord(root?.cavcode || {})?.workspaceVariants ?? root?.workspaceVariants) as unknown[])
    : [];
  const out: DebugWorkspaceVariant[] = [];
  for (let i = 0; i < variantRows.length; i += 1) {
    const rec = asRecord(variantRows[i]);
    if (!rec) continue;
    const name = s(rec.name || rec.id || `Variant ${i + 1}`);
    if (!name) continue;
    const runtimeExecutable = s(debugApplyLaunchTemplateVariables(s(rec.runtimeExecutable || ""), workspaceDir, entryHintAbs)) || null;
    const cwdAbs = debugLaunchPathToAbsolute(workspaceDir, s(rec.cwd || ""), entryHintAbs);
    out.push({
      id: `variant_${i + 1}_${debugSlug(name)}`,
      name,
      description: s(rec.description || rec.detail || "") || null,
      runtimeExecutable,
      runtimeArgs: debugCoerceStringArray(rec.runtimeArgs, workspaceDir, entryHintAbs),
      programArgs: debugCoerceStringArray(rec.args, workspaceDir, entryHintAbs),
      cwdCavcodePath: debugPathToCavcode(workspaceDir, cwdAbs),
      env: debugCoerceEnvMap(rec.env, workspaceDir, entryHintAbs),
      preLaunchTask: s(rec.preLaunchTask || "") || null,
      postDebugTask: s(rec.postDebugTask || "") || null,
      raw: rec,
    });
  }
  return out;
}

function resolveDebugWorkspaceVariant(
  variants: DebugWorkspaceVariant[],
  selectorRaw: string | null | undefined
): DebugWorkspaceVariant | null {
  const selector = s(selectorRaw || "");
  if (!selector) return null;
  const lowered = selector.toLowerCase();
  const byId = variants.find((variant) => variant.id.toLowerCase() === lowered);
  if (byId) return byId;
  const byName = variants.find((variant) => variant.name.toLowerCase() === lowered);
  if (byName) return byName;
  const bySlug = variants.find((variant) => debugSlug(variant.name) === debugSlug(lowered));
  if (bySlug) return bySlug;
  return null;
}

async function readDebugLaunchManifestFromWorkspace(
  workspaceDir: string,
  entryHintCavcodePath?: string | null,
  opts?: { profileId?: string | null; variantId?: string | null }
): Promise<DebugLaunchManifest> {
  const launchPath = path.join(workspaceDir, ".vscode", "launch.json");
  if (!await pathExists(launchPath)) {
    return {
      targets: [],
      compounds: [],
      profiles: [],
      workspaceVariants: [],
      tasks: await readDebugTaskDefinitionsFromWorkspace(workspaceDir, null),
    };
  }
  const raw = await readFile(launchPath, "utf8");
  const parsed = ts.parseConfigFileTextToJson(launchPath, raw);
  if (parsed.error) {
    const message = ts.flattenDiagnosticMessageText(parsed.error.messageText, "\n").trim() || "Invalid .vscode/launch.json";
    throw new CavtoolsExecError("DEBUG_LAUNCH_JSON_INVALID", message, 400);
  }
  const root = asRecord(parsed.config);
  const configs = Array.isArray(root?.configurations) ? root.configurations : [];
  const compoundsRaw = Array.isArray(root?.compounds) ? root.compounds : [];
  const entryHintAbs = debugLaunchPathToAbsolute(workspaceDir, entryHintCavcodePath || null, null);
  const profiles = parseDebugLaunchProfiles(root, workspaceDir, entryHintAbs);
  const workspaceVariants = parseDebugWorkspaceVariants(root, workspaceDir, entryHintAbs);
  const tasks = await readDebugTaskDefinitionsFromWorkspace(workspaceDir, entryHintAbs);
  const profileOverride = resolveDebugLaunchProfile(profiles, opts?.profileId || null);
  const variantOverride = resolveDebugWorkspaceVariant(workspaceVariants, opts?.variantId || null);

  const targets: DebugLaunchTarget[] = [];
  for (let i = 0; i < configs.length; i += 1) {
    const rec = asRecord(configs[i]);
    if (!rec) continue;
    const name = s(rec.name || `Launch ${i + 1}`);
    if (!name) continue;
    const requestRaw = s(rec.request || "launch").toLowerCase();
    const request: DebugLaunchRequest = requestRaw === "attach" ? "attach" : "launch";
    const debugType = s(rec.type || "node");
    const adapter = debugAdapterFromLaunchType(debugType);
    const configProfile = resolveDebugLaunchProfile(profiles, s(rec.profile || rec.cavcodeProfile || ""));
    const configVariant = resolveDebugWorkspaceVariant(workspaceVariants, s(rec.variant || rec.workspaceVariant || ""));
    const selectedProfile = profileOverride || configProfile;
    const selectedVariant = variantOverride || configVariant;
    const runtimeExecutable = s(debugApplyLaunchTemplateVariables(
      s(
        rec.runtimeExecutable
        || selectedVariant?.runtimeExecutable
        || selectedProfile?.runtimeExecutable
        || (adapter.id === "node-inspector" ? "node" : "")
      ),
      workspaceDir,
      entryHintAbs
    )) || (adapter.id === "node-inspector" ? "node" : "");
    const programAbs = debugLaunchPathToAbsolute(workspaceDir, s(rec.program || ""), entryHintAbs);
    const cwdAbs = debugLaunchPathToAbsolute(
      workspaceDir,
      s(rec.cwd || selectedVariant?.cwdCavcodePath || selectedProfile?.cwdCavcodePath || ""),
      entryHintAbs
    );
    const portRaw = Number(debugApplyLaunchTemplateVariables(s(rec.port || ""), workspaceDir, entryHintAbs));
    const processIdRaw = Number(debugApplyLaunchTemplateVariables(s(rec.processId || ""), workspaceDir, entryHintAbs));
    const attachHost = s(debugApplyLaunchTemplateVariables(s(rec.host || rec.address || ""), workspaceDir, entryHintAbs)) || null;
    const attachWsUrl = s(debugApplyLaunchTemplateVariables(
      s(rec.wsUrl || rec.webSocketDebuggerUrl || rec.url || ""),
      workspaceDir,
      entryHintAbs
    )) || null;
    const preLaunchTask =
      s(rec.preLaunchTask || selectedVariant?.preLaunchTask || selectedProfile?.preLaunchTask || "") || null;
    const postDebugTask =
      s(rec.postDebugTask || selectedVariant?.postDebugTask || selectedProfile?.postDebugTask || "") || null;
    const target: DebugLaunchTarget = {
      id: `cfg_${i + 1}_${debugSlug(name)}`,
      name,
      request,
      debugType,
      adapterId: adapter.id,
      entryCavcodePath: debugPathToCavcode(workspaceDir, programAbs),
      cwdCavcodePath: debugPathToCavcode(workspaceDir, cwdAbs),
      runtimeExecutable,
      runtimeArgs: [
        ...(selectedProfile?.runtimeArgs || []),
        ...(selectedVariant?.runtimeArgs || []),
        ...debugCoerceStringArray(rec.runtimeArgs, workspaceDir, entryHintAbs),
      ],
      programArgs: [
        ...(selectedProfile?.programArgs || []),
        ...(selectedVariant?.programArgs || []),
        ...debugCoerceStringArray(rec.args, workspaceDir, entryHintAbs),
      ],
      stopOnEntry: rec.stopOnEntry === true || rec.stopAtEntry === true,
      env: mergeDebugEnvMaps(
        selectedProfile?.env,
        selectedVariant?.env,
        debugCoerceEnvMap(rec.env, workspaceDir, entryHintAbs)
      ),
      sourceMaps: rec.sourceMaps !== false,
      outFiles: debugCoerceStringArray(rec.outFiles, workspaceDir, entryHintAbs),
      attachHost,
      attachPort: Number.isFinite(portRaw) && Number.isInteger(portRaw) && portRaw > 0 ? Math.trunc(portRaw) : null,
      attachWsUrl,
      attachProcessId: Number.isFinite(processIdRaw) && Number.isInteger(processIdRaw) && processIdRaw > 0 ? Math.trunc(processIdRaw) : null,
      preLaunchTask,
      postDebugTask,
      profileId: selectedProfile?.id || null,
      workspaceVariantId: selectedVariant?.id || null,
      presentationGroup: s(asRecord(rec.presentation)?.group || "") || null,
      raw: rec,
    };
    targets.push(target);
  }

  const compounds: DebugLaunchCompound[] = [];
  for (let i = 0; i < compoundsRaw.length; i += 1) {
    const rec = asRecord(compoundsRaw[i]);
    if (!rec) continue;
    const name = s(rec.name || `Compound ${i + 1}`);
    if (!name) continue;
    const configurationRefs = Array.isArray(rec.configurations)
      ? rec.configurations.map((row) => s(row)).filter(Boolean)
      : [];
    const targetIds = configurationRefs
      .map((ref) => resolveDebugLaunchTarget(targets, ref)?.id || "")
      .filter(Boolean);
    compounds.push({
      id: `compound_${i + 1}_${debugSlug(name)}`,
      name,
      configurationRefs,
      targetIds,
      preLaunchTask: s(rec.preLaunchTask || "") || null,
      postDebugTask: s(rec.postDebugTask || "") || null,
      stopAll: rec.stopAll !== false,
      presentationGroup: s(asRecord(rec.presentation)?.group || "") || null,
      raw: rec,
    });
  }

  return {
    targets,
    compounds,
    profiles,
    workspaceVariants,
    tasks,
  };
}

function resolveDebugLaunchTarget(targets: DebugLaunchTarget[], selectorRaw: string | null | undefined): DebugLaunchTarget | null {
  if (!targets.length) return null;
  const selector = s(selectorRaw || "");
  if (!selector) return targets[0];
  const numeric = Number(selector);
  if (Number.isFinite(numeric) && Number.isInteger(numeric) && numeric > 0) {
    const idx = Math.trunc(numeric) - 1;
    if (idx >= 0 && idx < targets.length) return targets[idx];
  }
  const lowered = selector.toLowerCase();
  const byId = targets.find((target) => target.id.toLowerCase() === lowered);
  if (byId) return byId;
  const byName = targets.find((target) => target.name.toLowerCase() === lowered);
  if (byName) return byName;
  const bySlug = targets.find((target) => debugSlug(target.name) === debugSlug(lowered));
  if (bySlug) return bySlug;
  return null;
}

function resolveDebugLaunchCompound(
  compounds: DebugLaunchCompound[],
  selectorRaw: string | null | undefined
): DebugLaunchCompound | null {
  if (!compounds.length) return null;
  const selector = s(selectorRaw || "");
  if (!selector) return compounds[0];
  const numeric = Number(selector);
  if (Number.isFinite(numeric) && Number.isInteger(numeric) && numeric > 0) {
    const idx = Math.trunc(numeric) - 1;
    if (idx >= 0 && idx < compounds.length) return compounds[idx];
  }
  const lowered = selector.toLowerCase();
  const byId = compounds.find((compound) => compound.id.toLowerCase() === lowered);
  if (byId) return byId;
  const byName = compounds.find((compound) => compound.name.toLowerCase() === lowered);
  if (byName) return byName;
  const bySlug = compounds.find((compound) => debugSlug(compound.name) === debugSlug(lowered));
  if (bySlug) return bySlug;
  return null;
}

function shellQuoteArg(value: string): string {
  if (!value) return "''";
  if (/^[a-zA-Z0-9_./:@%+=,-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runDebugTaskDefinition(
  ctx: ExecContext | null,
  workspaceDir: string,
  task: DebugTaskDefinition,
  entryHintAbs: string | null,
  session?: DebugSession | null
): Promise<void> {
  if (ctx) {
    await startTaskSessionFromDefinition(ctx, workspaceDir, task, entryHintAbs, {
      attachDebugSession: session || null,
      waitForCompletion: true,
    });
    return;
  }
  const cwdRel = task.cwd ? toRuntimeRelativePath(task.cwd) : null;
  const cwdAbs = cwdRel ? path.join(workspaceDir, cwdRel) : workspaceDir;
  const taskCwd = (await pathExists(cwdAbs)) ? cwdAbs : workspaceDir;
  const command = s(task.command || "");
  if (!command) {
    throw new CavtoolsExecError("DEBUG_TASK_INVALID", `Task "${task.label}" is missing a command.`, 400);
  }
  const renderedCommand = debugApplyLaunchTemplateVariables(command, workspaceDir, entryHintAbs);
  const renderedArgs = task.args.map((arg) => debugApplyLaunchTemplateVariables(s(arg), workspaceDir, entryHintAbs));
  if (!ctx) {
    const inline = `${renderedCommand} ${renderedArgs.join(" ")}`.trim();
    const blocked = /(^|\s)(rm\s+-rf\s+\/|mkfs\b|dd\s+if=\/dev\/(zero|random)|curl\b[^\n|]{0,200}\|\s*(bash|sh)\b)/i;
    if (blocked.test(inline)) {
      throw new CavtoolsExecError("SECURITY_COMMAND_BLOCKED", `Task "${task.label}" matched blocked execution policy patterns.`, 403);
    }
  }
  if (session) {
    pushDebugLogLine(
      session,
      "system",
      `[task:${task.label}] ${renderedCommand}${renderedArgs.length ? ` ${renderedArgs.map((arg) => shellQuoteArg(arg)).join(" ")}` : ""}`
    );
  }
  const result =
    task.type === "shell"
      ? await runCommandWithCapturedOutput({
          bin: process.env.SHELL || "/bin/sh",
          argv: ["-lc", `${renderedCommand}${renderedArgs.length ? ` ${renderedArgs.map((arg) => shellQuoteArg(arg)).join(" ")}` : ""}`],
          cwd: taskCwd,
          env: {
            ...process.env,
            ...task.env,
          },
          timeoutMs: 10 * 60 * 1000,
        })
      : await runCommandWithCapturedOutput({
          bin: renderedCommand,
          argv: renderedArgs,
          cwd: taskCwd,
          env: {
            ...process.env,
            ...task.env,
          },
          timeoutMs: 10 * 60 * 1000,
        });
  const stdout = String(result.stdout || "").trim();
  const stderr = String(result.stderr || "").trim();
  if (session) {
    if (stdout) {
      for (const line of stdout.split("\n").slice(-200)) {
        pushDebugLogLine(session, "stdout", `[task:${task.label}] ${line}`);
      }
    }
    if (stderr) {
      for (const line of stderr.split("\n").slice(-200)) {
        pushDebugLogLine(session, "stderr", `[task:${task.label}] ${line}`);
      }
    }
  }
  if (result.code !== 0) {
    throw new CavtoolsExecError(
      "DEBUG_TASK_FAILED",
      `Task "${task.label}" failed (${result.code}): ${s(stderr || stdout) || "command failed"}`,
      400
    );
  }
}

async function runDebugTaskWithDependencies(
  ctx: ExecContext | null,
  workspaceDir: string,
  tasks: DebugTaskDefinition[],
  selector: string,
  entryHintAbs: string | null,
  session?: DebugSession | null,
  state?: {
    inFlight: Set<string>;
    completed: Set<string>;
  }
): Promise<void> {
  const task = resolveDebugTaskDefinition(tasks, selector);
  if (!task) {
    throw new CavtoolsExecError("DEBUG_TASK_NOT_FOUND", `Task not found: ${selector}`, 404);
  }
  const graph = state || {
    inFlight: new Set<string>(),
    completed: new Set<string>(),
  };
  if (graph.completed.has(task.id)) return;
  if (graph.inFlight.has(task.id)) {
    throw new CavtoolsExecError("DEBUG_TASK_CYCLE", `Task dependency cycle detected near "${task.label}".`, 400);
  }
  graph.inFlight.add(task.id);
  for (const dep of task.dependsOn) {
    await runDebugTaskWithDependencies(ctx, workspaceDir, tasks, dep, entryHintAbs, session, graph);
  }
  await runDebugTaskDefinition(ctx, workspaceDir, task, entryHintAbs, session);
  graph.inFlight.delete(task.id);
  graph.completed.add(task.id);
}

function toCavcodePathFromWorkspace(workspaceDir: string, candidatePath: string): string {
  const absolute = path.isAbsolute(candidatePath) ? candidatePath : path.join(workspaceDir, candidatePath);
  const normalized = path.normalize(absolute);
  const normalizedRoot = path.normalize(workspaceDir);
  if (!normalized.startsWith(normalizedRoot)) {
    return normalizePath(`/cavcode/${String(candidatePath || "").replace(/\\/g, "/").replace(/^\/+/, "")}`);
  }
  const rel = path.relative(normalizedRoot, normalized).replace(/\\/g, "/");
  return normalizePath(`/cavcode/${rel}`);
}

function debugRemoteObjectToText(obj: unknown): string {
  const row = obj && typeof obj === "object" ? obj as Record<string, unknown> : null;
  if (!row) return "";
  if (row.value !== undefined) {
    const val = row.value;
    if (typeof val === "string") return val;
    if (typeof val === "number" || typeof val === "boolean") return String(val);
    if (val === null) return "null";
    try {
      return JSON.stringify(val);
    } catch {
      return String(val);
    }
  }
  if (row.unserializableValue != null) return String(row.unserializableValue);
  if (row.description != null) return String(row.description);
  if (row.type != null) return String(row.type);
  return "";
}

function debugRemoteObjectType(obj: unknown): string | null {
  const row = obj && typeof obj === "object" ? obj as Record<string, unknown> : null;
  if (!row) return null;
  const subtype = s(row.subtype);
  if (subtype) return subtype;
  const type = s(row.type);
  return type || null;
}

function toScriptFilesystemPath(urlValue: string): string {
  const raw = s(urlValue);
  if (!raw) return "";
  if (raw.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(raw).pathname);
    } catch {
      return raw.replace(/^file:\/\//, "");
    }
  }
  return raw;
}

function resolveDebugScriptCavcodePath(session: DebugSession, scriptUrl: string): string | null {
  const fsPath = toScriptFilesystemPath(scriptUrl);
  if (!fsPath) return null;
  if (fsPath.startsWith("/cavcode/")) return normalizePath(fsPath);
  if (path.isAbsolute(fsPath)) {
    return toCavcodePathFromWorkspace(session.workspaceDir, fsPath);
  }
  return toCavcodePathFromWorkspace(session.workspaceDir, fsPath);
}

function debugLocationFromRuntime(
  session: DebugSession,
  scriptId: string | null,
  lineZero: number,
  columnZero: number
): { file: string | null; line: number | null; column: number | null } {
  const scriptUrl = scriptId ? s(session.scriptUrlById.get(scriptId) || "") : "";
  const file = scriptUrl ? resolveDebugScriptCavcodePath(session, scriptUrl) : null;
  const line = Number.isFinite(lineZero) ? Math.max(1, Math.trunc(lineZero) + 1) : null;
  const column = Number.isFinite(columnZero) ? Math.max(1, Math.trunc(columnZero) + 1) : null;
  return { file, line, column };
}

function debugAllocateVariablesReference(
  session: DebugSession,
  descriptor: { objectId: string; evaluateName?: string | null; frameId?: string | null }
): number {
  if (!descriptor.objectId) return 0;
  const ref = Math.max(1, Math.trunc(session.nextVariablesRef || 1));
  session.nextVariablesRef = ref + 1;
  session.variablesByRef.set(ref, descriptor);
  return ref;
}

function debugResetPausedState(session: DebugSession) {
  session.stack = [];
  session.scopes.clear();
  session.variablesByRef.clear();
  session.cdpFramesById.clear();
  session.frameOrdinalById.clear();
  session.nextVariablesRef = 1;
  session.selectedFrameId = null;
  session.currentLocation = { file: null, line: null, column: null };
}

function debugExceptionPauseState(session: DebugSession): "none" | "uncaught" | "all" {
  if (session.exceptionFilters.all) return "all";
  if (session.exceptionFilters.uncaught) return "uncaught";
  return "none";
}

function parseHitConditionMatch(hitCondition: string, hitCount: number): boolean {
  const raw = s(hitCondition);
  if (!raw) return true;
  const numOnly = raw.match(/^(\d+)$/);
  if (numOnly) {
    const n = Number(numOnly[1]);
    if (!Number.isFinite(n) || n <= 0) return true;
    return hitCount >= n;
  }
  const mod = raw.match(/^%\s*(\d+)$/);
  if (mod) {
    const n = Number(mod[1]);
    if (!Number.isFinite(n) || n <= 0) return true;
    return hitCount % n === 0;
  }
  const cmp = raw.match(/^(>=|<=|>|<|==?)\s*(\d+)$/);
  if (cmp) {
    const n = Number(cmp[2]);
    if (!Number.isFinite(n) || n <= 0) return true;
    if (cmp[1] === ">=") return hitCount >= n;
    if (cmp[1] === "<=") return hitCount <= n;
    if (cmp[1] === ">") return hitCount > n;
    if (cmp[1] === "<") return hitCount < n;
    return hitCount === n;
  }
  return true;
}

function debugFormatConsoleEvent(method: string, params: Record<string, unknown>): string {
  if (method === "Runtime.consoleAPICalled") {
    const args = Array.isArray(params.args) ? params.args : [];
    const text = args.map((arg) => debugRemoteObjectToText(arg)).filter(Boolean).join(" ");
    return text || `[console.${s(params.type) || "log"}]`;
  }
  if (method === "Runtime.exceptionThrown") {
    const details = params.exceptionDetails && typeof params.exceptionDetails === "object"
      ? params.exceptionDetails as Record<string, unknown>
      : null;
    const text = debugRemoteObjectToText(details?.exception);
    if (text) return text;
    return s(details?.text) || "Unhandled exception";
  }
  return "";
}

function debugRejectPendingRequests(session: DebugSession, error: CavtoolsExecError) {
  for (const [id, pending] of session.pendingRequests.entries()) {
    session.pendingRequests.delete(id);
    if (pending.timer) {
      try {
        clearTimeout(pending.timer);
      } catch {}
    }
    pending.reject(error);
  }
}

async function debugPost(
  session: DebugSession,
  method: string,
  params: Record<string, unknown> = {},
  timeoutMs = 10_000
): Promise<Record<string, unknown>> {
  if (!session.ws || session.ws.readyState !== 1) {
    throw new CavtoolsExecError("DEBUG_TRANSPORT_NOT_READY", "Debug transport is not connected.", 409);
  }
  const id = Math.max(1, Math.trunc(session.nextRequestId || 1));
  session.nextRequestId = id + 1;

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pendingRequests.delete(id);
      reject(new CavtoolsExecError("DEBUG_PROTOCOL_TIMEOUT", `Debug protocol timeout on ${method}.`, 408));
    }, Math.max(500, Math.trunc(timeoutMs)));
    timer.unref?.();
    session.pendingRequests.set(id, {
      resolve,
      reject,
      method,
      timer,
    });
    try {
      session.ws?.send(JSON.stringify({ id, method, params }));
    } catch {
      session.pendingRequests.delete(id);
      try {
        clearTimeout(timer);
      } catch {}
      reject(new CavtoolsExecError("DEBUG_PROTOCOL_SEND_FAILED", `Failed to send debug request ${method}.`, 400));
    }
  });
}

async function debugSetExceptionFilters(session: DebugSession): Promise<void> {
  const state = debugExceptionPauseState(session);
  await debugPost(session, "Debugger.setPauseOnExceptions", { state });
}

function debugBuildConditionExpression(bp: DebugBreakpoint): string | undefined {
  const condition = s(bp.condition);
  const logMessage = s(bp.logMessage);
  if (!logMessage) {
    return condition || undefined;
  }
  const escaped = JSON.stringify(logMessage);
  if (condition) {
    return `((${condition}) ? (console.log(${escaped}), false) : false)`;
  }
  return `(console.log(${escaped}), false)`;
}

async function debugApplySourceBreakpoint(session: DebugSession, bp: DebugBreakpoint): Promise<void> {
  if (!bp.enabled) return;
  const relPath = toRuntimeRelativePath(bp.file);
  if (!relPath) throw new CavtoolsExecError("DEBUG_BREAK_SCOPE", "Breakpoint must target a /cavcode path.", 400);
  const absPath = path.join(session.workspaceDir, relPath).replace(/\\/g, "/");
  const fileUrl = `file://${absPath}`;
  const urlRegex = `(${escapeRegex(absPath)}|${escapeRegex(fileUrl)})$`;
  const conditionExpr = debugBuildConditionExpression(bp);
  const result = await debugPost(session, "Debugger.setBreakpointByUrl", {
    lineNumber: Math.max(0, bp.line - 1),
    urlRegex,
    condition: conditionExpr,
  });
  bp.adapterBreakpointId = s(result.breakpointId) || null;
  const locations = Array.isArray(result.locations) ? result.locations : [];
  bp.verified = locations.length > 0 || Boolean(bp.adapterBreakpointId);
  bp.message = bp.verified ? null : "Breakpoint pending script load.";
}

async function debugRemoveAdapterBreakpoint(session: DebugSession, adapterBreakpointId: string | null | undefined): Promise<void> {
  const id = s(adapterBreakpointId);
  if (!id) return;
  await debugPost(session, "Debugger.removeBreakpoint", { breakpointId: id }).catch(() => {});
}

function debugScopeName(raw: string): string {
  const scope = s(raw).toLowerCase();
  if (scope === "local") return "Local";
  if (scope === "closure") return "Closure";
  if (scope === "global") return "Global";
  if (scope === "block") return "Block";
  if (scope === "with") return "With";
  if (scope === "catch") return "Catch";
  if (scope === "script") return "Script";
  return scope ? scope[0].toUpperCase() + scope.slice(1) : "Scope";
}

function debugApplyPausedEvent(
  session: DebugSession,
  payload: Record<string, unknown>,
  reasonOverride?: string | null
): { shouldResume: boolean; reason: string } {
  debugResetPausedState(session);
  const reason = s(reasonOverride || payload.reason || "breakpoint");
  const callFramesRaw = Array.isArray(payload.callFrames) ? payload.callFrames : [];
  const stack: DebugStackFrame[] = [];
  for (const frameRaw of callFramesRaw) {
    const frame = frameRaw && typeof frameRaw === "object" ? frameRaw as Record<string, unknown> : null;
    if (!frame) continue;
    const frameId = s(frame.callFrameId);
    if (!frameId) continue;
    const location = frame.location && typeof frame.location === "object"
      ? frame.location as Record<string, unknown>
      : null;
    const scriptId = s(location?.scriptId) || null;
    const lineZero = Number(location?.lineNumber);
    const columnZero = Number(location?.columnNumber);
    const url = s(frame.url || (scriptId ? session.scriptUrlById.get(scriptId) : ""));
    if (scriptId && url) {
      session.scriptUrlById.set(scriptId, url);
      const prevMeta = session.scriptMetaById.get(scriptId);
      session.scriptMetaById.set(scriptId, {
        url,
        sourceMapUrl: prevMeta?.sourceMapUrl || null,
        hash: prevMeta?.hash || null,
        language: prevMeta?.language || null,
        isModule: prevMeta?.isModule === true,
        lastSeenMs: Date.now(),
      });
    }
    const resolved = debugLocationFromRuntime(session, scriptId, lineZero, columnZero);
    const ordinal = stack.length + 1;
    const scopeChainRaw = Array.isArray(frame.scopeChain) ? frame.scopeChain : [];
    const scopeChain: DebugCdpScopeChainEntry[] = scopeChainRaw
      .map((item) => (item && typeof item === "object" ? item as Record<string, unknown> : null))
      .filter((item): item is Record<string, unknown> => Boolean(item))
      .map((item) => ({
        type: s(item.type) || "local",
        name: s(item.name) || "",
        object: item.object && typeof item.object === "object" ? { objectId: s((item.object as Record<string, unknown>).objectId) } : undefined,
      }));
    session.cdpFramesById.set(frameId, {
      frameId,
      functionName: s(frame.functionName) || "(anonymous)",
      scriptId,
      url,
      line: resolved.line || 1,
      column: resolved.column || 1,
      scopeChain,
    });
    session.frameOrdinalById.set(frameId, ordinal);
    const scopes: DebugScope[] = scopeChain.map((scope, index) => {
      const objectId = s(scope.object?.objectId || "");
      const variablesReference = objectId
        ? debugAllocateVariablesReference(session, { objectId, frameId })
        : 0;
      return {
        name: debugScopeName(scope.type || scope.name || `scope ${index + 1}`),
        variablesReference,
        expensive: scope.type === "global",
        presentationHint: s(scope.type || "") || null,
      };
    });
    session.scopes.set(ordinal, scopes);
    stack.push({
      id: ordinal,
      frameId,
      threadId: 1,
      name: s(frame.functionName) || "(anonymous)",
      file: resolved.file,
      line: resolved.line,
      column: resolved.column,
    });
  }

  session.stack = stack;
  session.status = "paused";
  session.selectedThreadId = 1;
  session.selectedFrameId = stack[0]?.frameId || null;
  session.threads = [{ id: 1, name: "main", stopped: true, reason }];
  if (stack[0]) {
    session.currentLocation = {
      file: stack[0].file,
      line: stack[0].line,
      column: stack[0].column,
    };
  }

  const hitBreakpoints = Array.isArray(payload.hitBreakpoints) ? payload.hitBreakpoints.map((item) => s(item)) : [];
  let shouldResume = false;
  if (hitBreakpoints.length) {
    let blockingBreakpointSeen = false;
    for (const adapterId of hitBreakpoints) {
      const sourceHit = Array.from(session.breakpoints.values()).find((bp) => s(bp.adapterBreakpointId) === adapterId);
      const fnHit = Array.from(session.functionBreakpoints.values()).find((bp) => s(bp.adapterBreakpointId) === adapterId);
      const target = sourceHit || fnHit;
      if (!target) {
        blockingBreakpointSeen = true;
        continue;
      }
      target.hitCount = Math.max(0, Math.trunc(target.hitCount || 0)) + 1;
      const hitPass = parseHitConditionMatch(s(target.hitCondition), target.hitCount);
      if (target.kind === "logpoint" && hitPass) {
        pushDebugLogLine(session, "system", `[logpoint] ${s(target.logMessage) || `${target.file}:${target.line}`}`);
        continue;
      }
      if (!hitPass) {
        continue;
      }
      blockingBreakpointSeen = true;
    }
    if (!blockingBreakpointSeen) {
      shouldResume = true;
    }
  }

  return {
    shouldResume,
    reason,
  };
}

function debugApplyResumedEvent(session: DebugSession) {
  session.status = "running";
  session.updatedAtMs = Date.now();
  session.threads = [{ id: 1, name: "main", stopped: false, reason: null }];
}

async function debugRefreshWatches(session: DebugSession): Promise<void> {
  const expressions = Array.from(session.watches.keys());
  if (!expressions.length) return;
  const selectedFrameId = s(session.selectedFrameId || "");
  for (const expr of expressions) {
    const value = await debugEvaluateExpression(session, expr, selectedFrameId || null).catch(() => null);
    session.watches.set(expr, value?.value || null);
  }
}

async function debugHandleProtocolEvent(session: DebugSession, event: Record<string, unknown>): Promise<void> {
  const method = s(event.method);
  const params = event.params && typeof event.params === "object" ? event.params as Record<string, unknown> : {};
  if (!method) return;

  if (method === "Debugger.scriptParsed") {
    const scriptId = s(params.scriptId);
    const url = s(params.url);
    if (scriptId && url) {
      session.scriptUrlById.set(scriptId, url);
      session.scriptMetaById.set(scriptId, {
        url,
        sourceMapUrl: s(params.sourceMapURL || "") || null,
        hash: s(params.hash || "") || null,
        language: s(params.scriptLanguage || params.language || "") || null,
        isModule: params.isModule === true,
        lastSeenMs: Date.now(),
      });
    }
    return;
  }

  if (method === "Debugger.breakpointResolved") {
    const breakpointId = s(params.breakpointId);
    if (breakpointId) {
      for (const bp of session.breakpoints.values()) {
        if (s(bp.adapterBreakpointId) !== breakpointId) continue;
        bp.verified = true;
        bp.message = null;
      }
      for (const bp of session.functionBreakpoints.values()) {
        if (s(bp.adapterBreakpointId) !== breakpointId) continue;
        bp.verified = true;
        bp.message = null;
      }
    }
    return;
  }

  if (method === "Runtime.consoleAPICalled" || method === "Runtime.exceptionThrown") {
    const text = debugFormatConsoleEvent(method, params);
    if (text) {
      const category = method === "Runtime.consoleAPICalled" ? "console" : "exception";
      const seq = session.nextSeq + 1;
      session.consoleEntries.push({
        seq,
        atISO: nowISO(),
        category,
        text,
        level: s(params.type || "") || null,
      });
      pushDebugLogLine(session, method === "Runtime.exceptionThrown" ? "stderr" : "stdout", text);
    }
    return;
  }

  if (method === "Debugger.resumed") {
    debugApplyResumedEvent(session);
    return;
  }

  if (method === "Debugger.paused") {
    const paused = debugApplyPausedEvent(session, params);
    await debugRefreshWatches(session).catch(() => {});
    if (paused.shouldResume) {
      await debugPost(session, "Debugger.resume", {}).catch(() => {});
      debugApplyResumedEvent(session);
    } else {
      pushDebugLogLine(session, "system", `Paused (${paused.reason}).`);
    }
    return;
  }

  if (method === "Inspector.detached") {
    session.status = "failed";
    pushDebugLogLine(session, "system", `Debugger detached: ${s(params.reason) || "unknown"}`);
    void runDebugPostTaskIfNeeded(session);
  }
}

async function debugEnsureTransport(session: DebugSession, timeoutMs = 12_000): Promise<void> {
  if (session.ws && session.ws.readyState === 1) return;
  const startedAt = Date.now();
  while (!session.wsUrl && Date.now() - startedAt <= timeoutMs) {
    if (session.status === "failed" || session.status === "exited" || session.status === "stopped") {
      throw new CavtoolsExecError("DEBUG_TRANSPORT_NOT_READY", "Debug transport did not initialize.", 409);
    }
    await sleep(60);
  }
  if (!session.wsUrl) throw new CavtoolsExecError("DEBUG_TRANSPORT_NOT_READY", "Debugger endpoint was not announced.", 408);

  await new Promise<void>((resolve, reject) => {
    if (!session.wsUrl) {
      reject(new CavtoolsExecError("DEBUG_TRANSPORT_NOT_READY", "Debugger endpoint is missing.", 408));
      return;
    }
    const ws = new WebSocket(session.wsUrl);
    session.ws = ws;
    let settled = false;
    const done = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      done(new CavtoolsExecError("DEBUG_TRANSPORT_TIMEOUT", "Timed out connecting debugger transport.", 408));
    }, Math.max(1000, Math.trunc(timeoutMs)));
    timer.unref?.();

    ws.onopen = () => {
      try {
        clearTimeout(timer);
      } catch {}
      done();
    };
    ws.onerror = () => {
      try {
        clearTimeout(timer);
      } catch {}
      done(new CavtoolsExecError("DEBUG_TRANSPORT_CONNECT_FAILED", "Debugger transport connection failed.", 502));
    };
    ws.onclose = () => {
      session.ws = null;
      if (session.status === "running" || session.status === "paused" || session.status === "starting") {
        session.status = session.stopRequested ? "stopped" : "failed";
      }
      debugRejectPendingRequests(session, new CavtoolsExecError("DEBUG_TRANSPORT_CLOSED", "Debugger transport closed.", 409));
    };
    ws.onmessage = (message) => {
      const raw = typeof message.data === "string" ? message.data : "";
      if (!raw) return;
      let payload: Record<string, unknown> | null = null;
      try {
        payload = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        payload = null;
      }
      if (!payload) return;
      const idRaw = Number(payload.id);
      if (Number.isFinite(idRaw) && Number.isInteger(idRaw) && idRaw > 0) {
        const id = Math.trunc(idRaw);
        const pending = session.pendingRequests.get(id);
        if (!pending) return;
        session.pendingRequests.delete(id);
        if (pending.timer) {
          try {
            clearTimeout(pending.timer);
          } catch {}
        }
        if (payload.error && typeof payload.error === "object") {
          const errorObj = payload.error as Record<string, unknown>;
          pending.reject(new CavtoolsExecError(
            "DEBUG_PROTOCOL_ERROR",
            `${pending.method} failed: ${s(errorObj.message) || "Unknown protocol error."}`,
            400
          ));
          return;
        }
        const result = payload.result && typeof payload.result === "object"
          ? payload.result as Record<string, unknown>
          : {};
        pending.resolve(result);
        return;
      }
      void debugHandleProtocolEvent(session, payload).catch((error) => {
        pushDebugLogLine(session, "system", `Debug event handler failed: ${s((error as Error)?.message || "")}`);
      });
    };
  });

  await debugPost(session, "Runtime.enable", {});
  await debugPost(session, "Debugger.enable", {});
  await debugSetExceptionFilters(session);
  pushDebugLogLine(session, "system", "Debugger transport connected.");
}

async function debugEvaluateExpression(
  session: DebugSession,
  expression: string,
  frameId?: string | null
): Promise<{ value: string; type: string | null; variablesReference: number }> {
  const expr = s(expression);
  if (!expr) return { value: "", type: null, variablesReference: 0 };
  if (frameId && session.status === "paused") {
    const res = await debugPost(session, "Debugger.evaluateOnCallFrame", {
      callFrameId: frameId,
      expression: expr,
      includeCommandLineAPI: true,
      returnByValue: false,
      silent: true,
    });
    const obj = res.result;
    const objectId = obj && typeof obj === "object" ? s((obj as Record<string, unknown>).objectId) : "";
    const variablesReference = objectId
      ? debugAllocateVariablesReference(session, { objectId, evaluateName: expr, frameId })
      : 0;
    return {
      value: debugRemoteObjectToText(obj),
      type: debugRemoteObjectType(obj),
      variablesReference,
    };
  }
  const res = await debugPost(session, "Runtime.evaluate", {
    expression: expr,
    includeCommandLineAPI: true,
    returnByValue: false,
    silent: true,
  });
  const obj = res.result;
  const objectId = obj && typeof obj === "object" ? s((obj as Record<string, unknown>).objectId) : "";
  const variablesReference = objectId
    ? debugAllocateVariablesReference(session, { objectId, evaluateName: expr, frameId: null })
    : 0;
  return {
    value: debugRemoteObjectToText(obj),
    type: debugRemoteObjectType(obj),
    variablesReference,
  };
}

async function debugListVariables(
  session: DebugSession,
  variablesReference: number,
  start = 0,
  count = 200
): Promise<DebugVariable[]> {
  const reference = Math.max(1, Math.trunc(variablesReference || 0));
  const descriptor = session.variablesByRef.get(reference);
  if (!descriptor?.objectId) return [];
  const res = await debugPost(session, "Runtime.getProperties", {
    objectId: descriptor.objectId,
    ownProperties: true,
    accessorPropertiesOnly: false,
    generatePreview: true,
  });
  const propsRaw = Array.isArray(res.result) ? res.result : [];
  const rows: DebugVariable[] = [];
  for (const propRaw of propsRaw) {
    const prop = propRaw && typeof propRaw === "object" ? propRaw as Record<string, unknown> : null;
    if (!prop) continue;
    if (prop.name == null) continue;
    if (prop.get && !prop.value) continue;
    const name = String(prop.name);
    const valueObj = prop.value;
    const value = debugRemoteObjectToText(valueObj);
    const objectId = valueObj && typeof valueObj === "object" ? s((valueObj as Record<string, unknown>).objectId) : "";
    const childRef = objectId
      ? debugAllocateVariablesReference(session, {
        objectId,
        evaluateName: descriptor.evaluateName ? `${descriptor.evaluateName}.${name}` : name,
        frameId: descriptor.frameId || null,
      })
      : 0;
    rows.push({
      name,
      value: value || "undefined",
      type: debugRemoteObjectType(valueObj),
      variablesReference: childRef,
      evaluateName: descriptor.evaluateName ? `${descriptor.evaluateName}.${name}` : name,
      namedVariables: null,
      indexedVariables: null,
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const offset = Math.max(0, Math.trunc(start));
  const limit = Math.max(1, Math.min(500, Math.trunc(count)));
  return rows.slice(offset, offset + limit);
}

async function refreshDebugSessionState(session: DebugSession): Promise<void> {
  if (session.status === "exited" || session.status === "failed" || session.status === "stopped") return;
  await debugEnsureTransport(session, 8_000);
  if (session.status === "paused") {
    const frameId = s(session.selectedFrameId || "");
    if (frameId) {
      await debugRefreshWatches(session);
    }
  } else {
    session.threads = [{ id: 1, name: "main", stopped: false, reason: null }];
  }
}

function debugSelectedFrameOrdinal(session: DebugSession): number | null {
  const frameId = s(session.selectedFrameId || "");
  if (!frameId) return null;
  const idx = session.frameOrdinalById.get(frameId);
  if (!Number.isFinite(idx)) return null;
  return Math.max(1, Math.trunc(Number(idx)));
}

function debugLoadedScriptsView(session: DebugSession): DebugLoadedScript[] {
  const rows: DebugLoadedScript[] = [];
  for (const [scriptId, meta] of session.scriptMetaById.entries()) {
    const url = s(meta.url || session.scriptUrlById.get(scriptId) || "");
    if (!url) continue;
    const cavcodePath = resolveDebugScriptCavcodePath(session, url);
    const file = cavcodePath || toScriptFilesystemPath(url) || null;
    rows.push({
      scriptId,
      url,
      file,
      cavcodePath,
      sourceMapUrl: s(meta.sourceMapUrl) || null,
      hash: s(meta.hash) || null,
      language: s(meta.language) || null,
      isModule: meta.isModule === true,
      lastSeenISO: new Date(Math.max(0, Math.trunc(meta.lastSeenMs || Date.now()))).toISOString(),
    });
  }
  for (const [scriptId, urlRaw] of session.scriptUrlById.entries()) {
    if (rows.some((row) => row.scriptId === scriptId)) continue;
    const url = s(urlRaw);
    if (!url) continue;
    const cavcodePath = resolveDebugScriptCavcodePath(session, url);
    const file = cavcodePath || toScriptFilesystemPath(url) || null;
    rows.push({
      scriptId,
      url,
      file,
      cavcodePath,
      sourceMapUrl: null,
      hash: null,
      language: null,
      isModule: false,
      lastSeenISO: new Date(session.updatedAtMs).toISOString(),
    });
  }
  rows.sort((a, b) => a.url.localeCompare(b.url));
  return rows.slice(0, 800);
}

function debugLoadedModulesView(scripts: DebugLoadedScript[]): DebugLoadedModule[] {
  const counts = new Map<string, number>();
  for (const script of scripts) {
    const keySource = s(script.cavcodePath || script.url || script.file || "");
    if (!keySource) continue;
    const normalized = keySource.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    const moduleKey = parts.length > 1 ? `${parts[0]}/${parts[1]}` : (parts[0] || normalized);
    counts.set(moduleKey, (counts.get(moduleKey) || 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([module, scriptCount]) => ({ module, scriptCount }))
    .sort((a, b) => b.scriptCount - a.scriptCount || a.module.localeCompare(b.module))
    .slice(0, 200);
}

function debugSessionView(session: DebugSession) {
  const sourceBreakpoints = Array.from(session.breakpoints.values());
  const functionBreakpoints = Array.from(session.functionBreakpoints.values());
  const dataBreakpoints = Array.from(session.dataBreakpoints.values());
  const loadedScripts = debugLoadedScriptsView(session);
  const loadedModules = debugLoadedModulesView(loadedScripts);
  return {
    type: "cav_debug_status_v1",
    sessionId: session.id,
    projectId: session.projectId,
    entryPath: session.entryCavcodePath,
    status: session.status,
    adapterId: session.protocol.adapterId,
    adapterLabel: session.protocol.adapterLabel,
    adapterType: session.adapterType,
    capabilities: session.protocol.capabilities,
    launchTargetName: session.launchTargetName,
    launchCompoundName: session.launchCompoundName,
    launchProfileId: session.launchProfileId,
    workspaceVariantId: session.workspaceVariantId,
    launchRequest: session.launchRequest,
    attachInfo: session.attachInfo,
    postDebugTask: session.postDebugTask,
    postDebugTaskRan: session.postDebugTaskRan,
    createdAtISO: new Date(session.createdAtMs).toISOString(),
    updatedAtISO: new Date(session.updatedAtMs).toISOString(),
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    nextSeq: session.nextSeq,
    logTruncated: session.logTruncated,
    currentLocation: session.currentLocation,
    breakpoints: sourceBreakpoints,
    functionBreakpoints,
    dataBreakpoints,
    exceptionFilters: {
      all: session.exceptionFilters.all,
      uncaught: session.exceptionFilters.uncaught,
    },
    threads: session.threads,
    selectedThreadId: session.selectedThreadId,
    selectedFrameOrdinal: debugSelectedFrameOrdinal(session),
    stack: session.stack.slice(0, 60),
    scopes: (() => {
      const selected = debugSelectedFrameOrdinal(session);
      if (!selected) return [] as DebugScope[];
      return (session.scopes.get(selected) || []).slice(0, 40);
    })(),
    watches: Array.from(session.watches.entries()).map(([expression, value]) => ({
      expression,
      value,
    })),
    consoleEntries: session.consoleEntries.slice(-120),
    loadedScripts,
    loadedModules,
    filesMaterialized: session.filesMaterialized,
    bytesMaterialized: session.bytesMaterialized,
  };
}

function readDebugLogs(session: DebugSession, afterSeq: number) {
  const after = Number.isFinite(Number(afterSeq)) ? Math.max(0, Math.trunc(Number(afterSeq))) : 0;
  const entries = session.logs
    .filter((entry) => entry.seq > after)
    .slice(0, DEBUG_POLL_BATCH);
  const nextSeq = entries.length ? entries[entries.length - 1].seq : after;
  const loadedScripts = debugLoadedScriptsView(session);
  return {
    type: "cav_debug_logs_v1",
    sessionId: session.id,
    status: session.status,
    adapterId: session.protocol.adapterId,
    adapterLabel: session.protocol.adapterLabel,
    adapterType: session.adapterType,
    launchTargetName: session.launchTargetName,
    launchCompoundName: session.launchCompoundName,
    launchProfileId: session.launchProfileId,
    workspaceVariantId: session.workspaceVariantId,
    launchRequest: session.launchRequest,
    attachInfo: session.attachInfo,
    capabilities: session.protocol.capabilities,
    exitCode: session.exitCode,
    exitSignal: session.exitSignal,
    nextSeq,
    logTruncated: session.logTruncated,
    currentLocation: session.currentLocation,
    breakpoints: Array.from(session.breakpoints.values()),
    functionBreakpoints: Array.from(session.functionBreakpoints.values()),
    dataBreakpoints: Array.from(session.dataBreakpoints.values()),
    exceptionFilters: {
      all: session.exceptionFilters.all,
      uncaught: session.exceptionFilters.uncaught,
    },
    threads: session.threads,
    selectedThreadId: session.selectedThreadId,
    selectedFrameOrdinal: debugSelectedFrameOrdinal(session),
    stack: session.stack.slice(0, 60),
    scopes: (() => {
      const selected = debugSelectedFrameOrdinal(session);
      if (!selected) return [] as DebugScope[];
      return (session.scopes.get(selected) || []).slice(0, 40);
    })(),
    watches: Array.from(session.watches.entries()).map(([expression, value]) => ({
      expression,
      value,
    })),
    consoleEntries: session.consoleEntries.slice(-120),
    loadedScripts,
    loadedModules: debugLoadedModulesView(loadedScripts),
    entries,
  };
}

async function sendDebugImmediateCommand(
  session: DebugSession,
  command: string,
  nextStatus: DebugSessionStatus
): Promise<void> {
  const cmd = s(command).toLowerCase();
  if (!cmd) throw new CavtoolsExecError("DEBUG_COMMAND_REQUIRED", "Debug command is required.", 400);
  const activeState = session.status === "starting" || session.status === "running" || session.status === "paused";
  if (!activeState) {
    throw new CavtoolsExecError("DEBUG_SESSION_INACTIVE", "Debug session is not active.", 409);
  }
  if (
    session.process
    && (session.process.killed || session.process.exitCode != null)
    && (!session.ws || session.ws.readyState !== 1)
  ) {
    throw new CavtoolsExecError("DEBUG_SESSION_INACTIVE", "Debug session is not active.", 409);
  }
  await debugEnsureTransport(session, 8_000);
  session.updatedAtMs = Date.now();
  session.status = nextStatus;
  if (nextStatus === "running") {
    session.stack = [];
  }
  if (cmd === "cont" || cmd === "continue" || cmd === "resume") {
    await debugPost(session, "Debugger.resume", {});
    return;
  }
  if (cmd === "pause") {
    await debugPost(session, "Debugger.pause", {});
    return;
  }
  if (cmd === "next") {
    await debugPost(session, "Debugger.stepOver", {});
    return;
  }
  if (cmd === "step") {
    await debugPost(session, "Debugger.stepInto", {});
    return;
  }
  if (cmd === "out") {
    await debugPost(session, "Debugger.stepOut", {});
    return;
  }
  throw new CavtoolsExecError("DEBUG_COMMAND_UNSUPPORTED", `Unsupported debug command: ${command}`, 400);
}

function parseDebugBreakpointTarget(rawTarget: string, rawLine: string, cwd: string): { file: string; line: number } {
  const targetRaw = s(rawTarget);
  const lineRaw = s(rawLine);
  if (!targetRaw) throw new CavtoolsExecError("DEBUG_BREAK_USAGE", "Usage: cav debug break set|clear <file>:<line>", 400);

  let pathArg = targetRaw;
  let lineToken = lineRaw;
  const inlineLineMatch = targetRaw.match(/^(.*?):(\d+)$/);
  if (!lineToken && inlineLineMatch) {
    pathArg = s(inlineLineMatch[1] || "");
    lineToken = s(inlineLineMatch[2] || "");
  }

  const resolvedFile = resolvePath(pathArg, cwd);
  if (!resolvedFile.startsWith("/cavcode/")) {
    throw new CavtoolsExecError("DEBUG_BREAK_SCOPE", "Breakpoints must target files inside /cavcode.", 400);
  }
  const lineNum = Number(lineToken);
  if (!Number.isFinite(lineNum) || !Number.isInteger(lineNum) || lineNum <= 0) {
    throw new CavtoolsExecError("DEBUG_BREAK_USAGE", "Breakpoint line must be a positive integer.", 400);
  }
  return {
    file: normalizePath(resolvedFile),
    line: Math.trunc(lineNum),
  };
}

function parseDebugCliOptions(tokens: string[]): {
  positional: string[];
  options: {
    condition?: string;
    hitCondition?: string;
    logMessage?: string;
    setId?: string;
    disabled?: boolean;
    enabled?: boolean;
  };
} {
  const positional: string[] = [];
  const options: {
    condition?: string;
    hitCondition?: string;
    logMessage?: string;
    setId?: string;
    disabled?: boolean;
    enabled?: boolean;
  } = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = s(tokens[i]);
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    if (token === "--disabled") {
      options.disabled = true;
      options.enabled = false;
      continue;
    }
    if (token === "--enabled") {
      options.enabled = true;
      options.disabled = false;
      continue;
    }
    if (token === "--condition" || token.startsWith("--condition=")) {
      const value = token.includes("=") ? token.slice(token.indexOf("=") + 1) : s(tokens[i + 1] || "");
      if (!token.includes("=")) i += 1;
      if (value) options.condition = value;
      continue;
    }
    if (token === "--hit" || token === "--hit-condition" || token.startsWith("--hit=") || token.startsWith("--hit-condition=")) {
      const value = token.includes("=") ? token.slice(token.indexOf("=") + 1) : s(tokens[i + 1] || "");
      if (!token.includes("=")) i += 1;
      if (value) options.hitCondition = value;
      continue;
    }
    if (token === "--log" || token === "--log-message" || token.startsWith("--log=") || token.startsWith("--log-message=")) {
      const value = token.includes("=") ? token.slice(token.indexOf("=") + 1) : s(tokens[i + 1] || "");
      if (!token.includes("=")) i += 1;
      if (value) options.logMessage = value;
      continue;
    }
    if (token === "--set" || token === "--set-id" || token.startsWith("--set=") || token.startsWith("--set-id=")) {
      const value = token.includes("=") ? token.slice(token.indexOf("=") + 1) : s(tokens[i + 1] || "");
      if (!token.includes("=")) i += 1;
      if (value) options.setId = value;
      continue;
    }
    positional.push(token);
  }
  return { positional, options };
}

function parseDebugLaunchCliOptions(tokens: string[]): {
  positional: string[];
  options: {
    profileId?: string;
    variantId?: string;
    selectorType?: "target" | "compound";
  };
} {
  const positional: string[] = [];
  const options: {
    profileId?: string;
    variantId?: string;
    selectorType?: "target" | "compound";
  } = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = s(tokens[i]);
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
    if (token === "--compound") {
      options.selectorType = "compound";
      continue;
    }
    if (token === "--target") {
      options.selectorType = "target";
      continue;
    }
    if (token === "--profile" || token.startsWith("--profile=")) {
      const value = token.includes("=") ? token.slice(token.indexOf("=") + 1) : s(tokens[i + 1] || "");
      if (!token.includes("=")) i += 1;
      if (value) options.profileId = value;
      continue;
    }
    if (token === "--variant" || token.startsWith("--variant=")) {
      const value = token.includes("=") ? token.slice(token.indexOf("=") + 1) : s(tokens[i + 1] || "");
      if (!token.includes("=")) i += 1;
      if (value) options.variantId = value;
      continue;
    }
    positional.push(token);
  }
  return { positional, options };
}

async function debugSetSourceBreakpoint(
  session: DebugSession,
  target: { file: string; line: number },
  options: { condition?: string; hitCondition?: string; logMessage?: string; setId?: string; enabled?: boolean; disabled?: boolean }
): Promise<DebugBreakpoint> {
  const key = `${normalizePath(target.file)}:${target.line}`;
  const existing = session.breakpoints.get(key);
  if (existing?.adapterBreakpointId) {
    await debugRemoveAdapterBreakpoint(session, existing.adapterBreakpointId);
  }
  const enabled =
    options.disabled === true
      ? false
      : options.enabled === true
        ? true
        : true;
  const kind = options.logMessage ? "logpoint" : "source";
  const bp: DebugBreakpoint = {
    id: key,
    kind,
    enabled,
    setId: s(options.setId || existing?.setId || "") || null,
    condition: s(options.condition || "") || null,
    hitCondition: s(options.hitCondition || "") || null,
    logMessage: s(options.logMessage || "") || null,
    functionName: null,
    file: normalizePath(target.file),
    line: target.line,
    verified: false,
    message: enabled ? "Breakpoint pending." : "Breakpoint disabled.",
    adapterBreakpointId: null,
    hitCount: 0,
  };
  if (enabled) {
    await debugApplySourceBreakpoint(session, bp);
  }
  session.breakpoints.set(key, bp);
  return bp;
}

async function debugClearSourceBreakpoint(session: DebugSession, target: { file: string; line: number }): Promise<boolean> {
  const key = `${normalizePath(target.file)}:${target.line}`;
  const existing = session.breakpoints.get(key);
  if (!existing) return false;
  await debugRemoveAdapterBreakpoint(session, existing.adapterBreakpointId);
  session.breakpoints.delete(key);
  return true;
}

async function debugSetFunctionBreakpoint(
  session: DebugSession,
  functionName: string,
  options: { condition?: string; hitCondition?: string; setId?: string; enabled?: boolean; disabled?: boolean }
): Promise<DebugBreakpoint> {
  const name = s(functionName);
  if (!name) throw new CavtoolsExecError("DEBUG_FUNCTION_USAGE", "Function breakpoint name is required.", 400);
  const key = `fn:${name}`;
  const existing = session.functionBreakpoints.get(key);
  if (existing?.adapterBreakpointId) {
    await debugRemoveAdapterBreakpoint(session, existing.adapterBreakpointId);
  }
  const enabled =
    options.disabled === true
      ? false
      : options.enabled === true
        ? true
        : true;
  const bp: DebugBreakpoint = {
    id: key,
    kind: "function",
    enabled,
    setId: s(options.setId || existing?.setId || "") || null,
    condition: s(options.condition || "") || null,
    hitCondition: s(options.hitCondition || "") || null,
    logMessage: null,
    functionName: name,
    file: "/cavcode",
    line: 1,
    verified: false,
    message: enabled ? "Function breakpoint pending symbol resolution." : "Function breakpoint disabled.",
    adapterBreakpointId: null,
    hitCount: 0,
  };
  if (enabled) {
    const frameId = s(session.selectedFrameId || "");
    const evalResult = await debugEvaluateExpression(session, name, frameId || null);
    const descriptor = evalResult.variablesReference ? session.variablesByRef.get(evalResult.variablesReference) : null;
    const objectId = s(descriptor?.objectId || "");
    if (!objectId) {
      bp.message = "Function symbol not currently resolvable.";
      bp.verified = false;
    } else {
      const result = await debugPost(session, "Debugger.setBreakpointOnFunctionCall", {
        objectId,
        condition: s(bp.condition || "") || undefined,
      });
      bp.adapterBreakpointId = s(result.breakpointId) || null;
      bp.verified = Boolean(bp.adapterBreakpointId);
      bp.message = bp.verified ? null : "Function breakpoint unresolved.";
    }
  }
  session.functionBreakpoints.set(key, bp);
  return bp;
}

async function debugClearFunctionBreakpoint(session: DebugSession, functionName: string): Promise<boolean> {
  const key = `fn:${s(functionName)}`;
  const existing = session.functionBreakpoints.get(key);
  if (!existing) return false;
  await debugRemoveAdapterBreakpoint(session, existing.adapterBreakpointId);
  session.functionBreakpoints.delete(key);
  return true;
}

async function debugSetExceptionFiltersMode(session: DebugSession, mode: string): Promise<void> {
  const raw = s(mode).toLowerCase();
  if (raw === "all") {
    session.exceptionFilters.all = true;
    session.exceptionFilters.uncaught = false;
  } else if (raw === "uncaught") {
    session.exceptionFilters.all = false;
    session.exceptionFilters.uncaught = true;
  } else if (raw === "none" || !raw) {
    session.exceptionFilters.all = false;
    session.exceptionFilters.uncaught = false;
  } else if (raw === "all,uncaught" || raw === "uncaught,all") {
    session.exceptionFilters.all = true;
    session.exceptionFilters.uncaught = true;
  } else {
    throw new CavtoolsExecError("DEBUG_EXCEPTIONS_USAGE", "Exception mode must be one of: all|uncaught|none.", 400);
  }
  await debugSetExceptionFilters(session);
}

async function runDebugPostTaskIfNeeded(session: DebugSession): Promise<void> {
  const taskLabel = s(session.postDebugTask || "");
  if (!taskLabel || session.postDebugTaskRan) return;
  session.postDebugTaskRan = true;
  try {
    const entryAbs = session.entryRelPath ? path.join(session.workspaceDir, session.entryRelPath) : null;
    const tasks = await readDebugTaskDefinitionsFromWorkspace(session.workspaceDir, entryAbs);
    await runDebugTaskWithDependencies(null, session.workspaceDir, tasks, taskLabel, entryAbs, session);
    pushDebugLogLine(session, "system", `postDebugTask completed: ${taskLabel}`);
  } catch (error) {
    pushDebugLogLine(
      session,
      "stderr",
      `postDebugTask failed (${taskLabel}): ${s((error as Error | null)?.message || "Unknown error")}`
    );
  }
}

async function cleanupDebugSessions() {
  const now = Date.now();
  const staleIds: string[] = [];
  for (const [id, session] of debugSessions.entries()) {
    const active = session.status === "starting" || session.status === "running" || session.status === "paused";
    if (active) continue;
    if (now - session.updatedAtMs < DEBUG_SESSION_RETENTION_MS) continue;
    staleIds.push(id);
  }
  for (const id of staleIds) {
    const session = debugSessions.get(id);
    if (!session) continue;
    debugSessions.delete(id);
    const activeId = debugSessionByProject.get(session.key);
    if (activeId === id) debugSessionByProject.delete(session.key);
    try {
      await rm(session.workspaceDir, { recursive: true, force: true });
    } catch {}
  }
}

function assertDebugSessionAccess(ctx: ExecContext, sessionId: string): DebugSession {
  const session = debugSessions.get(sessionId);
  if (!session) throw new CavtoolsExecError("DEBUG_NOT_FOUND", `Debug session not found: ${sessionId}`, 404);
  if (session.accountId !== ctx.accountId || session.userId !== ctx.userId) {
    throw new CavtoolsExecError("UNAUTHORIZED", "Debug session is not accessible for this operator.", 403, "ROLE_BLOCKED");
  }
  return session;
}

async function stopDebugSession(session: DebugSession, reason = "Debug session stopped by operator.") {
  session.stopRequested = true;
  pushDebugLogLine(session, "system", reason);
  session.updatedAtMs = Date.now();
  if (session.ws) {
    try {
      session.ws.close();
    } catch {}
    session.ws = null;
  }
  debugRejectPendingRequests(session, new CavtoolsExecError("DEBUG_SESSION_STOPPED", "Debug session stopped.", 409));
  if (!session.process) {
    session.status = "stopped";
    await runDebugPostTaskIfNeeded(session).catch(() => {});
    return;
  }
  const active = session.status === "starting" || session.status === "running" || session.status === "paused";
  if (!active) return;
  try {
    session.process.kill("SIGTERM");
  } catch {}
  const processRef = session.process;
  const timer = setTimeout(() => {
    try {
      if (processRef.exitCode == null) processRef.kill("SIGKILL");
    } catch {}
  }, 4500);
  timer.unref?.();
}

async function stopActiveDebugSessionForProject(ctx: ExecContext): Promise<void> {
  if (!ctx.project?.id) return;
  const projectKey = runtimeProjectKey(ctx.accountId, ctx.project.id);
  const activeId = debugSessionByProject.get(projectKey);
  if (!activeId) return;
  const existing = debugSessions.get(activeId);
  if (!existing) return;
  if (existing.status !== "starting" && existing.status !== "running" && existing.status !== "paused") return;
  await stopDebugSession(existing, "Stopped previous debug session before starting a new one.");
}

function createDebugSessionRecord(
  ctx: ExecContext,
  stage: {
    workspaceDir: string;
    filesMaterialized: number;
    bytesMaterialized: number;
  },
  input: {
    entryCavcodePath: string;
    entryRelPath: string;
    adapter: DebugAdapterDefinition;
    adapterType: string;
    launchTargetName?: string | null;
    launchRequest: DebugLaunchRequest;
    launchCompoundName?: string | null;
    launchProfileId?: string | null;
    workspaceVariantId?: string | null;
    postDebugTask?: string | null;
    attachInfo?: {
      host: string | null;
      port: number | null;
      wsUrl: string | null;
      processId: number | null;
    } | null;
  }
): DebugSession {
  const projectId = Number(ctx.project?.id || 0);
  const key = runtimeProjectKey(ctx.accountId, projectId);
  const sessionSeed = [
    ctx.accountId,
    ctx.userId,
    String(projectId),
    input.launchRequest,
    input.adapter.id,
    input.entryRelPath || "root",
    String(Date.now()),
  ].join(":");
  const sessionId = `dbg_${hashCommandId(sessionSeed, stage.workspaceDir)}`;
  return {
    id: sessionId,
    key,
    accountId: ctx.accountId,
    userId: ctx.userId,
    projectId,
    entryCavcodePath: normalizePath(input.entryCavcodePath || "/cavcode"),
    entryRelPath: s(input.entryRelPath || ""),
    workspaceDir: stage.workspaceDir,
    adapterId: input.adapter.id,
    adapterType: s(input.adapterType || input.adapter.launchTypes[0] || input.adapter.id),
    protocol: {
      adapterId: input.adapter.id,
      adapterLabel: input.adapter.label,
      capabilities: { ...input.adapter.capabilities },
    },
    launchTargetName: s(input.launchTargetName || "") || null,
    launchCompoundName: s(input.launchCompoundName || "") || null,
    launchProfileId: s(input.launchProfileId || "") || null,
    workspaceVariantId: s(input.workspaceVariantId || "") || null,
    launchRequest: input.launchRequest,
    attachInfo: input.attachInfo || null,
    postDebugTask: s(input.postDebugTask || "") || null,
    postDebugTaskRan: false,
    process: null,
    wsUrl: null,
    ws: null,
    wsPartialStderr: "",
    nextRequestId: 1,
    pendingRequests: new Map(),
    status: "starting",
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    exitCode: null,
    exitSignal: null,
    stopRequested: false,
    nextSeq: 0,
    logTruncated: false,
    logs: [],
    consoleEntries: [],
    partialStdout: "",
    partialStderr: "",
    breakpoints: new Map(),
    functionBreakpoints: new Map(),
    dataBreakpoints: new Map(),
    exceptionFilters: { all: false, uncaught: false },
    threads: [{ id: 1, name: "main", stopped: false, reason: null }],
    stack: [],
    scopes: new Map(),
    variablesByRef: new Map(),
    nextVariablesRef: 1,
    cdpFramesById: new Map(),
    frameOrdinalById: new Map(),
    scriptUrlById: new Map(),
    scriptMetaById: new Map(),
    watches: new Map(),
    selectedThreadId: 1,
    selectedFrameId: null,
    currentLocation: { file: null, line: null, column: null },
    filesMaterialized: stage.filesMaterialized,
    bytesMaterialized: stage.bytesMaterialized,
  };
}

function bindDebugProcessLifecycle(session: DebugSession, child: ChildProcess) {
  session.process = child;
  const actor = reliabilityActorFromSession(session);
  child.stdout?.on("data", (chunk) => {
    appendDebugProcessChunk(session, "stdout", chunk);
  });
  child.stderr?.on("data", (chunk) => {
    appendDebugProcessChunk(session, "stderr", chunk);
  });
  child.on("spawn", () => {
    session.status = "running";
    session.updatedAtMs = Date.now();
    pushDebugLogLine(session, "system", "Debugger process started.");
    if (actor) {
      void writeReliabilitySnapshot(actor, {
        kind: "debug",
        scopeId: session.id,
        status: session.status,
        payload: debugSessionView(session),
      }).catch(() => {});
      void writeDeterministicReplay(actor, {
        category: "debug",
        sessionId: session.id,
        action: "debug.spawn",
        payload: debugSessionView(session),
      }).catch(() => {});
    }
  });
  child.on("error", (error) => {
    session.status = "failed";
    session.updatedAtMs = Date.now();
    pushDebugLogLine(session, "system", `Debugger process error: ${s(error?.message || "Unknown process error")}`);
    if (actor) {
      void writeCrashRecord(actor, {
        kind: "debug",
        scopeId: session.id,
        error: s(error?.message || "Debugger process error"),
        stack: s((error as Error | null)?.stack || "") || null,
        payload: debugSessionView(session),
      }).catch(() => {});
      void writeReliabilitySnapshot(actor, {
        kind: "debug",
        scopeId: session.id,
        status: session.status,
        payload: debugSessionView(session),
      }).catch(() => {});
      void writeDeterministicReplay(actor, {
        category: "debug",
        sessionId: session.id,
        action: "debug.error",
        payload: {
          error: s(error?.message || "Debugger process error"),
          status: session.status,
        },
      }).catch(() => {});
    }
  });
  child.on("exit", (code, signal) => {
    flushDebugProcessPartials(session);
    session.exitCode = Number.isFinite(Number(code)) ? Math.trunc(Number(code)) : null;
    session.exitSignal = s(signal || "") || null;
    session.updatedAtMs = Date.now();
    if (session.stopRequested) {
      session.status = "stopped";
      pushDebugLogLine(session, "system", "Debugger stopped.");
    } else if (session.exitCode === 0) {
      session.status = "exited";
      pushDebugLogLine(session, "system", "Debugger exited successfully.");
    } else {
      session.status = "failed";
      pushDebugLogLine(session, "system", `Debugger exited${session.exitCode != null ? ` (exit ${session.exitCode})` : ""}.`);
    }
    if (session.ws) {
      try {
        session.ws.close();
      } catch {}
      session.ws = null;
    }
    debugRejectPendingRequests(session, new CavtoolsExecError("DEBUG_SESSION_ENDED", "Debug session ended.", 409));
    void runDebugPostTaskIfNeeded(session);
    if (actor) {
      void writeReliabilitySnapshot(actor, {
        kind: "debug",
        scopeId: session.id,
        status: session.status,
        payload: debugSessionView(session),
      }).catch(() => {});
      void writeDeterministicReplay(actor, {
        category: "debug",
        sessionId: session.id,
        action: "debug.exit",
        payload: {
          status: session.status,
          exitCode: session.exitCode,
          exitSignal: session.exitSignal,
          stopRequested: session.stopRequested,
        },
      }).catch(() => {});
      if (session.status === "failed") {
        void writeCrashRecord(actor, {
          kind: "debug",
          scopeId: session.id,
          error: `Debugger exited${session.exitCode != null ? ` (exit ${session.exitCode})` : ""}`,
          payload: debugSessionView(session),
        }).catch(() => {});
      }
    }
  });
}

async function finalizeDebugSessionStart(
  session: DebugSession,
  options?: { requestPauseOnStart?: boolean }
): Promise<void> {
  await debugEnsureTransport(session, 12_000).catch((error) => {
    session.status = "failed";
    pushDebugLogLine(session, "system", `Debugger transport failed: ${s((error as Error)?.message || "")}`);
    throw error;
  });
  if (session.status === "starting") {
    session.status = "running";
    session.updatedAtMs = Date.now();
  }
  if (options?.requestPauseOnStart) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= 8_000) {
      if (session.status === "paused") break;
      if (session.status === "failed" || session.status === "exited" || session.status === "stopped") break;
      await sleep(120);
    }
    if (session.status === "running") {
      await debugPost(session, "Debugger.pause", {}).catch(() => {});
      await sleep(120);
    }
  }
  await refreshDebugSessionState(session).catch(() => {});
}

async function resolveInspectorWsUrl(address: string, port: number): Promise<string> {
  const host = s(address || "127.0.0.1") || "127.0.0.1";
  const endpointRoot = `http://${host}:${port}`;
  const candidates = [`${endpointRoot}/json/list`, `${endpointRoot}/json`, `${endpointRoot}/json/version`];
  for (const endpoint of candidates) {
    const res = await fetch(endpoint, { method: "GET", cache: "no-store" }).catch(() => null);
    if (!res?.ok) continue;
    const body = await res.json().catch(() => null) as unknown;
    if (Array.isArray(body)) {
      const row = body
        .map((item) => asRecord(item))
        .find((item) => Boolean(s(item?.webSocketDebuggerUrl || "")));
      const wsUrl = s(row?.webSocketDebuggerUrl || "");
      if (wsUrl) return wsUrl;
      continue;
    }
    const record = asRecord(body);
    const wsUrl = s(record?.webSocketDebuggerUrl || "");
    if (wsUrl) return wsUrl;
  }
  throw new CavtoolsExecError(
    "DEBUG_ATTACH_ENDPOINT_NOT_FOUND",
    `Could not resolve inspector websocket at ${host}:${port}.`,
    404
  );
}

function parseDebugAttachEndpoint(rawValue: string): { wsUrl: string | null; host: string | null; port: number | null } {
  const raw = s(rawValue);
  if (!raw) return { wsUrl: null, host: null, port: null };
  if (raw.startsWith("ws://") || raw.startsWith("wss://")) {
    return { wsUrl: raw, host: null, port: null };
  }
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    try {
      const parsed = new URL(raw);
      const port = Number(parsed.port || (parsed.protocol === "https:" ? "443" : "80"));
      const host = s(parsed.hostname || "");
      return {
        wsUrl: null,
        host: host || null,
        port: Number.isFinite(port) && Number.isInteger(port) && port > 0 ? Math.trunc(port) : null,
      };
    } catch {}
  }
  const hostPortMatch = raw.match(/^([^:]+):(\d+)$/);
  if (hostPortMatch) {
    const host = s(hostPortMatch[1] || "");
    const port = Number(hostPortMatch[2]);
    return {
      wsUrl: null,
      host: host || null,
      port: Number.isFinite(port) && Number.isInteger(port) && port > 0 ? Math.trunc(port) : null,
    };
  }
  const portOnly = Number(raw);
  if (Number.isFinite(portOnly) && Number.isInteger(portOnly) && portOnly > 0) {
    return { wsUrl: null, host: "127.0.0.1", port: Math.trunc(portOnly) };
  }
  return { wsUrl: null, host: null, port: null };
}

function appendDebugProcessChunk(session: DebugSession, stream: "stdout" | "stderr", chunk: Buffer | string) {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const prior = stream === "stdout" ? session.partialStdout : session.partialStderr;
  const all = `${prior}${normalized}`;
  const lines = all.split("\n");
  const tail = lines.pop() || "";
  for (const line of lines) {
    const clean = s(line);
    if (!clean) continue;
    pushDebugLogLine(session, stream, clean);
    if (stream === "stderr") {
      const wsUrl = parseDebugWsUrlLine(clean);
      if (wsUrl && wsUrl !== session.wsUrl) {
        session.wsUrl = wsUrl;
        pushDebugLogLine(session, "system", `Debugger endpoint announced: ${wsUrl}`);
      }
    }
  }
  if (stream === "stdout") session.partialStdout = tail;
  else session.partialStderr = tail;
}

function flushDebugProcessPartials(session: DebugSession) {
  if (session.partialStdout) {
    const text = s(session.partialStdout);
    if (text) pushDebugLogLine(session, "stdout", text);
    session.partialStdout = "";
  }
  if (session.partialStderr) {
    const text = s(session.partialStderr);
    if (text) {
      pushDebugLogLine(session, "stderr", text);
      const wsUrl = parseDebugWsUrlLine(text);
      if (wsUrl && wsUrl !== session.wsUrl) {
        session.wsUrl = wsUrl;
      }
    }
    session.partialStderr = "";
  }
}

async function startDebugSession(
  ctx: ExecContext,
  entryCavcodePath: string,
  options?: { stopExisting?: boolean }
): Promise<{ session: DebugSession; warnings: string[] }> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for debug.", 400);
  await cleanupDebugSessions();
  const policy = await assertExecutionAllowed(ctx, {
    scope: "debug",
    command: `debug start ${entryCavcodePath}`,
    resource: s(entryCavcodePath) || "/cavcode",
  });
  if (options?.stopExisting !== false) {
    await stopActiveDebugSessionForProject(ctx);
  }

  const normalizedEntry = normalizePath(entryCavcodePath);
  if (!normalizedEntry.startsWith("/cavcode/")) {
    throw new CavtoolsExecError("DEBUG_ENTRY_INVALID", "Debug entry must be inside /cavcode.", 400);
  }
  const entryRelPath = toRuntimeRelativePath(normalizedEntry);
  if (!entryRelPath) throw new CavtoolsExecError("DEBUG_ENTRY_INVALID", "Debug entry path is invalid.", 400);

  const stage = await materializeRuntimeWorkspace(ctx);
  const warnings = [...stage.warnings];
  const scan = await runQuarantineScanForWorkspace({
    ctx,
    workspaceDir: stage.workspaceDir,
    targetKind: "debug",
    targetPath: normalizedEntry,
  });
  if (scan.verdict === "blocked") {
    try {
      await rm(stage.workspaceDir, { recursive: true, force: true });
    } catch {}
    throw new CavtoolsExecError(
      "SECURITY_QUARANTINE_BLOCKED",
      `Quarantine scan blocked debug start (${scan.findings.length} finding${scan.findings.length === 1 ? "" : "s"}).`,
      403
    );
  }
  if (scan.verdict === "warn") {
    warnings.push(`Quarantine scan reported ${scan.findings.length} warning finding(s).`);
  }
  const entryAbs = path.join(stage.workspaceDir, entryRelPath);
  if (!await pathExists(entryAbs)) {
    try {
      await rm(stage.workspaceDir, { recursive: true, force: true });
    } catch {}
    throw new CavtoolsExecError("DEBUG_ENTRY_NOT_FOUND", `Debug entry file not found: ${normalizedEntry}`, 404);
  }
  const adapter = debugAdapterForEntryPath(normalizedEntry);
  const session = createDebugSessionRecord(ctx, stage, {
    entryCavcodePath: normalizedEntry,
    entryRelPath,
    adapter,
    adapterType: "node",
    launchRequest: "launch",
  });
  const sessionId = session.id;
  const secretEnv = await resolveSecretEnvForScope(ctx, "debug").catch(() => ({}));

  const child = spawn("node", ["--inspect-brk=0", entryRelPath], {
    cwd: stage.workspaceDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...secretEnv,
      FORCE_COLOR: "0",
      CAVCODE_DEBUG_SESSION_ID: sessionId,
      CAVCODE_SECURITY_PROFILE: policy.profile,
      CAVCODE_SECURITY_SANDBOX: policy.sandboxMode,
      CAVCODE_SECURITY_NETWORK: policy.networkPolicy,
    },
  });

  pushDebugLogLine(session, "system", `Starting node --inspect-brk=0 ${entryRelPath}`);
  bindDebugProcessLifecycle(session, child);

  debugSessions.set(sessionId, session);
  debugSessionByProject.set(session.key, sessionId);
  await finalizeDebugSessionStart(session, { requestPauseOnStart: true });
  await recordReliabilitySnapshot(ctx, {
    kind: "debug",
    scopeId: session.id,
    status: session.status,
    payload: debugSessionView(session),
  }).catch(() => {});
  await recordDeterministicReplay(ctx, {
    category: "debug",
    sessionId: session.id,
    action: "debug.start",
    payload: debugSessionView(session),
  }).catch(() => {});

  return {
    session,
    warnings,
  };
}

async function startDebugSessionFromLaunchTarget(
  ctx: ExecContext,
  target: DebugLaunchTarget,
  options?: {
    stopExisting?: boolean;
    launchCompoundName?: string | null;
    postDebugTaskOverride?: string | null;
  }
): Promise<{ session: DebugSession; warnings: string[] }> {
  if (target.request === "attach") {
    return startDebugAttachSession(ctx, {
      launchTargetName: target.name,
      launchCompoundName: options?.launchCompoundName || null,
      launchProfileId: target.profileId || null,
      workspaceVariantId: target.workspaceVariantId || null,
      postDebugTask: s(options?.postDebugTaskOverride || target.postDebugTask || "") || null,
      adapterId: target.adapterId,
      adapterType: target.debugType,
      entryCavcodePath: target.entryCavcodePath,
      attachHost: target.attachHost,
      attachPort: target.attachPort,
      attachWsUrl: target.attachWsUrl,
      attachProcessId: target.attachProcessId,
      stopExisting: options?.stopExisting,
    });
  }

  if (target.adapterId !== "node-inspector") {
    throw new CavtoolsExecError(
      "DEBUG_LAUNCH_UNSUPPORTED",
      `Launch target "${target.name}" requires adapter ${target.adapterId}, which is attach-only in this build.`,
      400
    );
  }

  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for debug.", 400);
  await cleanupDebugSessions();
  const policy = await assertExecutionAllowed(ctx, {
    scope: "debug",
    command: `debug launch ${target.runtimeExecutable} ${target.runtimeArgs.join(" ")} ${target.entryCavcodePath || ""}`.trim(),
    resource: s(target.entryCavcodePath || target.name || "/cavcode"),
  });
  if (options?.stopExisting !== false) {
    await stopActiveDebugSessionForProject(ctx);
  }

  const entryPath = normalizePath(s(target.entryCavcodePath || ""));
  if (!entryPath || !entryPath.startsWith("/cavcode/")) {
    throw new CavtoolsExecError("DEBUG_LAUNCH_TARGET_INVALID", `Launch target "${target.name}" is missing a valid program path.`, 400);
  }
  const entryRelPath = toRuntimeRelativePath(entryPath);
  if (!entryRelPath) {
    throw new CavtoolsExecError("DEBUG_LAUNCH_TARGET_INVALID", `Launch target "${target.name}" has an invalid program path.`, 400);
  }

  const stage = await materializeRuntimeWorkspace(ctx);
  const warnings = [...stage.warnings];
  try {
    const scan = await runQuarantineScanForWorkspace({
      ctx,
      workspaceDir: stage.workspaceDir,
      targetKind: "debug",
      targetPath: entryPath,
    });
    if (scan.verdict === "blocked") {
      throw new CavtoolsExecError(
        "SECURITY_QUARANTINE_BLOCKED",
        `Quarantine scan blocked launch "${target.name}" (${scan.findings.length} finding${scan.findings.length === 1 ? "" : "s"}).`,
        403
      );
    }
    if (scan.verdict === "warn") {
      warnings.push(`Quarantine scan reported ${scan.findings.length} warning finding(s).`);
    }
    const entryAbs = path.join(stage.workspaceDir, entryRelPath);
    if (target.preLaunchTask || target.postDebugTask || options?.postDebugTaskOverride) {
      const tasks = await readDebugTaskDefinitionsFromWorkspace(stage.workspaceDir, entryAbs);
      if (target.preLaunchTask) {
        await runDebugTaskWithDependencies(ctx, stage.workspaceDir, tasks, target.preLaunchTask, entryAbs, null);
        warnings.push(`preLaunchTask completed: ${target.preLaunchTask}`);
      }
    }
    if (!await pathExists(entryAbs)) {
      throw new CavtoolsExecError("DEBUG_ENTRY_NOT_FOUND", `Debug entry file not found: ${entryPath}`, 404);
    }
    const adapter = DEBUG_ADAPTER_REGISTRY[target.adapterId] || debugDefaultAdapter();
    const session = createDebugSessionRecord(ctx, stage, {
      entryCavcodePath: entryPath,
      entryRelPath,
      adapter,
      adapterType: target.debugType,
      launchTargetName: target.name,
      launchCompoundName: options?.launchCompoundName || null,
      launchProfileId: target.profileId || null,
      workspaceVariantId: target.workspaceVariantId || null,
      postDebugTask: s(options?.postDebugTaskOverride || target.postDebugTask || "") || null,
      launchRequest: "launch",
      attachInfo: null,
    });
    const sessionId = session.id;
    const runtimeExecutable = s(target.runtimeExecutable || "node") || "node";
    const runtimeArgs = [...target.runtimeArgs];
    const hasInspectArg = runtimeArgs.some((arg) => /^--inspect(?:-brk)?(?:=|$)/.test(s(arg)));
    if (!hasInspectArg) {
      runtimeArgs.unshift(target.stopOnEntry ? "--inspect-brk=0" : "--inspect=0");
    }
    const argv = [...runtimeArgs, entryRelPath, ...target.programArgs];
    let spawnCwd = stage.workspaceDir;
    const cwdRel = target.cwdCavcodePath ? toRuntimeRelativePath(target.cwdCavcodePath) : null;
    if (cwdRel) {
      const cwdAbs = path.join(stage.workspaceDir, cwdRel);
      if (await pathExists(cwdAbs)) {
        spawnCwd = cwdAbs;
      }
    }
    const secretEnv = await resolveSecretEnvForScope(ctx, "debug").catch(() => ({}));
    const child = spawn(runtimeExecutable, argv, {
      cwd: spawnCwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ...target.env,
        ...secretEnv,
        FORCE_COLOR: "0",
        CAVCODE_DEBUG_SESSION_ID: sessionId,
        CAVCODE_SECURITY_PROFILE: policy.profile,
        CAVCODE_SECURITY_SANDBOX: policy.sandboxMode,
        CAVCODE_SECURITY_NETWORK: policy.networkPolicy,
      },
    });
    pushDebugLogLine(
      session,
      "system",
      `Starting ${runtimeExecutable} ${argv.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ")}`
    );
    bindDebugProcessLifecycle(session, child);
    debugSessions.set(sessionId, session);
    debugSessionByProject.set(session.key, sessionId);
    await finalizeDebugSessionStart(session, { requestPauseOnStart: target.stopOnEntry || !hasInspectArg });
    await recordReliabilitySnapshot(ctx, {
      kind: "debug",
      scopeId: session.id,
      status: session.status,
      payload: debugSessionView(session),
    }).catch(() => {});
    await recordDeterministicReplay(ctx, {
      category: "debug",
      sessionId: session.id,
      action: "debug.launch",
      payload: debugSessionView(session),
    }).catch(() => {});
    return { session, warnings };
  } catch (error) {
    try {
      await rm(stage.workspaceDir, { recursive: true, force: true });
    } catch {}
    throw error;
  }
}

async function startDebugAttachSession(
  ctx: ExecContext,
  input: {
    launchTargetName?: string | null;
    launchCompoundName?: string | null;
    launchProfileId?: string | null;
    workspaceVariantId?: string | null;
    postDebugTask?: string | null;
    adapterId?: DebugAdapterId | null;
    adapterType?: string | null;
    entryCavcodePath?: string | null;
    attachHost?: string | null;
    attachPort?: number | null;
    attachWsUrl?: string | null;
    attachProcessId?: number | null;
    stopExisting?: boolean;
  }
): Promise<{ session: DebugSession; warnings: string[] }> {
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for debug.", 400);
  await cleanupDebugSessions();
  const policy = await assertExecutionAllowed(ctx, {
    scope: "debug",
    command: `debug attach ${input.attachWsUrl || `${input.attachHost || "127.0.0.1"}:${input.attachPort || ""}`}`.trim(),
    resource: s(input.entryCavcodePath || "/cavcode/.attach-session"),
  });
  if (input.stopExisting !== false) {
    await stopActiveDebugSessionForProject(ctx);
  }
  const stage = await materializeRuntimeWorkspace(ctx);
  const warnings = [...stage.warnings];
  const scan = await runQuarantineScanForWorkspace({
    ctx,
    workspaceDir: stage.workspaceDir,
    targetKind: "debug-attach",
    targetPath: s(input.entryCavcodePath || "/cavcode/.attach-session"),
  });
  if (scan.verdict === "blocked") {
    try {
      await rm(stage.workspaceDir, { recursive: true, force: true });
    } catch {}
    throw new CavtoolsExecError(
      "SECURITY_QUARANTINE_BLOCKED",
      `Quarantine scan blocked debug attach (${scan.findings.length} finding${scan.findings.length === 1 ? "" : "s"}).`,
      403
    );
  }
  if (scan.verdict === "warn") {
    warnings.push(`Quarantine scan reported ${scan.findings.length} warning finding(s).`);
  }
  const adapter = DEBUG_ADAPTER_REGISTRY[input.adapterId || "node-inspector"] || debugDefaultAdapter();
  const entryPath = (() => {
    const candidate = normalizePath(s(input.entryCavcodePath || ""));
    if (candidate.startsWith("/cavcode/")) return candidate;
    return "/cavcode/.attach-session";
  })();
  const entryRelPath = toRuntimeRelativePath(entryPath) || ".attach-session";
  const attachHost = s(input.attachHost || "") || "127.0.0.1";
  const attachPort =
    Number.isFinite(Number(input.attachPort)) && Number(input.attachPort) > 0
      ? Math.trunc(Number(input.attachPort))
      : null;
  const attachProcessId =
    Number.isFinite(Number(input.attachProcessId)) && Number(input.attachProcessId) > 0
      ? Math.trunc(Number(input.attachProcessId))
      : null;
  let wsUrl = s(input.attachWsUrl || "") || null;
  try {
    if (!wsUrl && attachProcessId) {
      try {
        process.kill(attachProcessId, "SIGUSR1");
      } catch {}
      await sleep(250);
    }
    if (!wsUrl && attachPort) {
      wsUrl = await resolveInspectorWsUrl(attachHost, attachPort);
    }
    if (!wsUrl) {
      throw new CavtoolsExecError(
        "DEBUG_ATTACH_USAGE",
        "Attach requires a ws url or a reachable host:port inspector endpoint.",
        400
      );
    }

    const session = createDebugSessionRecord(ctx, stage, {
      entryCavcodePath: entryPath,
      entryRelPath,
      adapter,
      adapterType: s(input.adapterType || adapter.launchTypes[0] || adapter.id),
      launchTargetName: input.launchTargetName || null,
      launchCompoundName: input.launchCompoundName || null,
      launchProfileId: input.launchProfileId || null,
      workspaceVariantId: input.workspaceVariantId || null,
      postDebugTask: input.postDebugTask || null,
      launchRequest: "attach",
      attachInfo: {
        host: attachHost,
        port: attachPort,
        wsUrl,
        processId: attachProcessId,
      },
    });
    session.wsUrl = wsUrl;
    session.status = session.status === "starting" ? "starting" : session.status;
    pushDebugLogLine(session, "system", `[security] profile=${policy.profile} sandbox=${policy.sandboxMode} network=${policy.networkPolicy}`);
    pushDebugLogLine(session, "system", `Attaching debugger transport ${wsUrl}`);
    debugSessions.set(session.id, session);
    debugSessionByProject.set(session.key, session.id);
    await finalizeDebugSessionStart(session, { requestPauseOnStart: false });
    await recordReliabilitySnapshot(ctx, {
      kind: "debug",
      scopeId: session.id,
      status: session.status,
      payload: debugSessionView(session),
    }).catch(() => {});
    await recordDeterministicReplay(ctx, {
      category: "debug",
      sessionId: session.id,
      action: "debug.attach",
      payload: debugSessionView(session),
    }).catch(() => {});
    return { session, warnings };
  } catch (error) {
    try {
      await rm(stage.workspaceDir, { recursive: true, force: true });
    } catch {}
    throw error;
  }
}

async function readDebugLaunchManifestForContext(
  ctx: ExecContext,
  entryHintCavcodePath?: string | null,
  opts?: { profileId?: string | null; variantId?: string | null }
): Promise<{ manifest: DebugLaunchManifest; warnings: string[] }> {
  const stage = await materializeRuntimeWorkspace(ctx);
  const warnings = [...stage.warnings];
  try {
    const manifest = await readDebugLaunchManifestFromWorkspace(stage.workspaceDir, entryHintCavcodePath || null, opts);
    return {
      manifest,
      warnings,
    };
  } finally {
    try {
      await rm(stage.workspaceDir, { recursive: true, force: true });
    } catch {}
  }
}

async function runDebugTaskForContext(
  ctx: ExecContext,
  selector: string,
  entryHintCavcodePath?: string | null
): Promise<{ warnings: string[] }> {
  const stage = await materializeRuntimeWorkspace(ctx);
  const warnings = [...stage.warnings];
  try {
    const entryHintAbs = debugLaunchPathToAbsolute(stage.workspaceDir, entryHintCavcodePath || null, null);
    const tasks = await readDebugTaskDefinitionsFromWorkspace(stage.workspaceDir, entryHintAbs);
    await runDebugTaskWithDependencies(ctx, stage.workspaceDir, tasks, selector, entryHintAbs, null);
    warnings.push(`Task completed: ${selector}`);
    return { warnings };
  } finally {
    try {
      await rm(stage.workspaceDir, { recursive: true, force: true });
    } catch {}
  }
}

async function startDebugSessionFromLaunchCompound(
  ctx: ExecContext,
  compound: DebugLaunchCompound,
  manifest: DebugLaunchManifest,
  opts?: { stopExisting?: boolean }
): Promise<{ sessions: DebugSession[]; warnings: string[] }> {
  const warnings: string[] = [];
  if (compound.preLaunchTask) {
    const taskRun = await runDebugTaskForContext(ctx, compound.preLaunchTask);
    if (taskRun.warnings.length) warnings.push(...taskRun.warnings);
  }
  const targets = compound.targetIds
    .map((id) => manifest.targets.find((target) => target.id === id) || null)
    .filter((target): target is DebugLaunchTarget => Boolean(target));
  if (!targets.length) {
    throw new CavtoolsExecError(
      "DEBUG_COMPOUND_EMPTY",
      `Compound "${compound.name}" has no launchable targets.`,
      400
    );
  }
  const sessions: DebugSession[] = [];
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const started = await startDebugSessionFromLaunchTarget(ctx, target, {
      stopExisting: i === 0 ? opts?.stopExisting !== false : false,
      launchCompoundName: compound.name,
      postDebugTaskOverride: compound.postDebugTask || null,
    });
    sessions.push(started.session);
    if (started.warnings.length) warnings.push(...started.warnings);
  }
  return { sessions, warnings };
}

async function handleCavCommand(ctx: ExecContext, parsed: ParsedCommand, cwd: string): Promise<{ cwd: string; blocks: CavtoolsExecBlock[]; warnings: string[] }> {
  const sub = s(parsed.args[0] || "").toLowerCase();
  const warnings: string[] = [];
  const blocks: CavtoolsExecBlock[] = [];

  if (!sub || sub === "help") {
    blocks.push({
      kind: "text",
      title: "Cav Command Guide",
      lines: [
        "cav status",
        "cav whoami",
        "cav ctx",
        "cav telemetry summary|routes|errors|seo|a11y|geo|scans|export",
        "cav workspace status|sites|members|guardrails|notices",
        "cav cloud share <path> [1|7|30]",
        "cav cloud publish <path>",
        "cav cloud unpublish <path>",
        "cav safe invite <path> <invitee> [viewer|editor|owner]",
        "cav safe revoke <path> <targetUserId>",
        "cav safe audit [limit]",
        "cav run dev|build|test",
        "cav run stop [sessionId]",
        "cav run restart [sessionId]",
        "cav run status",
        "cav run logs [sessionId] [afterSeq]",
        "cav project service start|status|refresh|diagnostics|logs|stop|restart",
        "cav task list|run|status|logs|stop|restart|history",
        "cav extension marketplace|install|update|uninstall|enable|disable|list|host|activate|logs|api",
        "cav collab session|presence|op|share|events",
        "cav security profile|secrets|scan|audit|status",
        "cav remote provider|session|port|debug",
        "cav reliability status|snapshots|restore|replay|budget|crash",
        "cav ui palette|shortcut|view|layout",
        "cav search rg|replace-preview|semantic",
        "cav debug start <entryFile>",
        "cav debug start --target <launchName|index|compoundName>",
        "cav debug config list|start|attach",
        "cav debug attach <ws://...|host:port|port>",
        "cav debug continue|pause|next|step|out [sessionId]",
        "cav debug break set|clear <file>:<line> [sessionId]",
        "cav debug watch add|remove <expression> [sessionId]",
        "cav debug select <sessionId>",
        "cav debug status|logs|stop [sessionId]",
        "cav git status|compare|diff|stage|unstage|commit|log|branch|checkout|remote|push|pull|fetch|rebase|cherry-pick|conflicts",
        "cav index refresh|symbols|refs|calls|graph|xref|semantic",
        "cav template list|init <website|software|game> [folder]",
        "cav loop plan <goal>",
        "cav loop replace <file> <search> <replace>",
        "cav events [afterSeq] [limit]",
      ],
    });
    return { cwd, blocks, warnings };
  }

  if (sub === "status") {
    const ws = await workspaceStatus(ctx);
    const eventCounts = await Promise.all([
      prisma.cavCloudActivity.count({ where: { accountId: ctx.accountId } }),
      prisma.cavSafeActivity.count({ where: { accountId: ctx.accountId } }),
    ]);

    blocks.push({
      kind: "json",
      title: "CavTools Status",
      data: {
        cwd,
        workspace: ws,
        cavcloudEvents: eventCounts[0],
        cavsafeEvents: eventCounts[1],
      },
    });
    return { cwd, blocks, warnings };
  }

  if (sub === "whoami") {
    blocks.push({
      kind: "json",
      title: "Operator Identity",
      data: {
        userId: ctx.userId,
        accountId: ctx.accountId,
        role: ctx.memberRole,
        planId: ctx.planId,
      },
    });
    return { cwd, blocks, warnings };
  }

  if (sub === "ctx") {
    blocks.push({
      kind: "json",
      title: "Execution Context",
      data: {
        cwd,
        project: ctx.project,
        siteOrigin: ctx.siteOrigin,
        includeCavsafe: ctx.includeCavsafe,
      },
    });
    return { cwd, blocks, warnings };
  }

  if (sub === "sync") {
    const listing = await listForPath(ctx, cwd);
    blocks.push({
      kind: "files",
      title: `Synced ${listing.cwd}`,
      cwd: listing.cwd,
      items: listing.items,
    });
    return {
      cwd: listing.cwd,
      blocks,
      warnings,
    };
  }

  if (sub === "diag") {
    const mode = s(parsed.args[1] || "summary").toLowerCase();
    if (mode === "errors" || mode === "routes" || mode === "seo" || mode === "a11y") {
      const section = await telemetrySection(ctx, mode);
      blocks.push({
        kind: "json",
        title: `Diagnostics: ${mode}`,
        data: section,
      });
      return { cwd, blocks, warnings };
    }

    if (mode === "find") {
      const query = s(parsed.args[2] || "");
      if (!query) throw new CavtoolsExecError("QUERY_REQUIRED", "Usage: cav diag find <text>", 400);

      const cloudHits = await prisma.cavCloudFile.findMany({
        where: {
          accountId: ctx.accountId,
          deletedAt: null,
          OR: [
            { path: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
            { previewSnippet: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 40,
        select: {
          id: true,
          path: true,
          name: true,
          mimeType: true,
          updatedAt: true,
        },
      });

      const safeHits = await prisma.cavSafeFile.findMany({
        where: {
          accountId: ctx.accountId,
          deletedAt: null,
          OR: [
            { path: { contains: query, mode: "insensitive" } },
            { name: { contains: query, mode: "insensitive" } },
            { previewSnippet: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 40,
        select: {
          id: true,
          path: true,
          name: true,
          mimeType: true,
          updatedAt: true,
        },
      });

      const rows = [
        ...cloudHits.map((hit) => ({
          namespace: "cavcloud",
          name: hit.name,
          path: toNamespacePath("/cavcloud", hit.path),
          mimeType: hit.mimeType,
          updatedAtISO: hit.updatedAt.toISOString(),
        })),
        ...safeHits.map((hit) => ({
          namespace: "cavsafe",
          name: hit.name,
          path: toNamespacePath("/cavsafe", hit.path),
          mimeType: hit.mimeType,
          updatedAtISO: hit.updatedAt.toISOString(),
        })),
      ];

      blocks.push(tableFromObjects(`Find "${query}"`, rows));
      return { cwd, blocks, warnings };
    }

    const summary = await telemetrySummary(ctx, "7d");
    blocks.push({ kind: "json", title: "Diagnostics Summary", data: summary });
    return { cwd, blocks, warnings };
  }

  if (sub === "telemetry") {
    const mode = s(parsed.args[1] || "summary").toLowerCase();
    if (!["summary", "routes", "errors", "seo", "a11y", "geo", "scans", "export"].includes(mode)) {
      throw new CavtoolsExecError("BAD_TELEMETRY_COMMAND", "Usage: cav telemetry summary|routes|errors|seo|a11y|geo|scans|export", 400);
    }

    const section = await telemetrySection(ctx, mode === "export" ? "summary" : mode);
    if (mode === "scans") {
      const rows = (asRecord(section)?.jobs as Array<Record<string, unknown>> | undefined) || [];
      blocks.push(tableFromObjects("Telemetry Scans", rows));
    } else if (mode === "export") {
      const payload = {
        exportedAtISO: nowISO(),
        projectId: ctx.project?.id || null,
        siteOrigin: ctx.siteOrigin || null,
        data: section,
      };
      blocks.push({
        kind: "json",
        title: "Telemetry Export",
        data: payload,
      });
    } else {
      blocks.push({
        kind: "json",
        title: `Telemetry: ${mode}`,
        data: section,
      });
    }

    return { cwd, blocks, warnings };
  }

  if (sub === "workspace") {
    const mode = s(parsed.args[1] || "status").toLowerCase();
    if (mode === "status") {
      blocks.push({ kind: "json", title: "Workspace Status", data: await workspaceStatus(ctx) });
      return { cwd, blocks, warnings };
    }

    if (mode === "sites") {
      const sites = await workspaceSites(ctx);
      blocks.push(tableFromObjects("Workspace Sites", sites as Array<Record<string, unknown>>));
      return { cwd, blocks, warnings };
    }

    if (mode === "members") {
      const members = await workspaceMembers(ctx);
      blocks.push(tableFromObjects("Workspace Members", members as Array<Record<string, unknown>>));
      return { cwd, blocks, warnings };
    }

    if (mode === "guardrails") {
      blocks.push({ kind: "json", title: "Workspace Guardrails", data: await workspaceGuardrails(ctx) });
      return { cwd, blocks, warnings };
    }

    if (mode === "notices") {
      const notices = await workspaceNotices(ctx);
      blocks.push(tableFromObjects("Workspace Notices", notices as Array<Record<string, unknown>>));
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_WORKSPACE_COMMAND", "Usage: cav workspace status|sites|members|guardrails|notices", 400);
  }

  if (sub === "run") {
    const actionRaw = s(parsed.args[1] || "").toLowerCase();
    const action = actionRaw === "dev" || actionRaw === "build" || actionRaw === "test" ? actionRaw : actionRaw;
    if (!action || action === "help") {
      blocks.push({
        kind: "text",
        title: "Runtime Commands",
        lines: [
          "cav run dev",
          "cav run build",
          "cav run test",
          "cav run stop [sessionId]",
          "cav run restart [sessionId]",
          "cav run status",
          "cav run logs [sessionId] [afterSeq]",
        ],
      });
      return { cwd, blocks, warnings };
    }

    await cleanupRuntimeSessions();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for runtime.", 400);
    const projectKey = runtimeProjectKey(ctx.accountId, ctx.project.id);

    if (action === "dev" || action === "build" || action === "test") {
      const started = await startRuntimeSession(ctx, action);
      await publishCavcodeEvent(ctx, "runtime.start", {
        sessionId: started.session.id,
        kind: started.session.kind,
        command: started.session.command,
      });
      blocks.push({
        kind: "json",
        title: "Runtime Started",
        data: {
          ...runtimeSessionView(started.session),
          type: "cav_runtime_started_v1",
        },
      });
      if (started.warnings.length) warnings.push(...started.warnings);
      return { cwd, blocks, warnings };
    }

    if (action === "stop") {
      const sessionId = s(parsed.args[2] || runtimeSessionByProject.get(projectKey) || "");
      if (!sessionId) throw new CavtoolsExecError("RUNTIME_NOT_FOUND", "No runtime session is active for this project.", 404);
      const session = assertRuntimeSessionAccess(ctx, sessionId);
      await stopRuntimeSession(session);
      await publishCavcodeEvent(ctx, "runtime.stop", {
        sessionId: session.id,
        kind: session.kind,
      });
      blocks.push({
        kind: "json",
        title: "Runtime Stop Requested",
        data: {
          ...runtimeSessionView(session),
          type: "cav_runtime_stop_v1",
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "restart") {
      const sessionId = s(parsed.args[2] || runtimeSessionByProject.get(projectKey) || "");
      if (!sessionId) throw new CavtoolsExecError("RUNTIME_NOT_FOUND", "No runtime session is active for this project.", 404);
      const session = assertRuntimeSessionAccess(ctx, sessionId);
      const kind = session.kind;
      await stopRuntimeSession(session, "Restart requested.");
      const restarted = await startRuntimeSession(ctx, kind);
      await publishCavcodeEvent(ctx, "runtime.restart", {
        previousSessionId: sessionId,
        sessionId: restarted.session.id,
        kind: restarted.session.kind,
      });
      blocks.push({
        kind: "json",
        title: "Runtime Restarted",
        data: {
          ...runtimeSessionView(restarted.session),
          type: "cav_runtime_restarted_v1",
          previousSessionId: sessionId,
        },
      });
      if (restarted.warnings.length) warnings.push(...restarted.warnings);
      return { cwd, blocks, warnings };
    }

    if (action === "status") {
      const sessions = Array.from(runtimeSessions.values())
        .filter((session) => session.accountId === ctx.accountId && session.userId === ctx.userId && session.projectId === ctx.project!.id)
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
        .slice(0, 20)
        .map((session) => runtimeSessionView(session));
      blocks.push(tableFromObjects("Runtime Sessions", sessions as Array<Record<string, unknown>>));
      return { cwd, blocks, warnings };
    }

    if (action === "logs") {
      const sessionId = s(parsed.args[2] || runtimeSessionByProject.get(projectKey) || "");
      if (!sessionId) throw new CavtoolsExecError("RUNTIME_NOT_FOUND", "No runtime session is active for this project.", 404);
      const afterSeqRaw = Number(parsed.args[3]);
      const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0;
      const session = assertRuntimeSessionAccess(ctx, sessionId);
      const payload = readRuntimeLogs(session, afterSeq);
      blocks.push({
        kind: "json",
        title: "Runtime Logs",
        data: payload,
      });
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_RUNTIME_COMMAND", "Usage: cav run dev|build|test|stop|restart|status|logs", 400);
  }

  if (sub === "project") {
    const domain = s(parsed.args[1] || "service").toLowerCase();
    if (domain !== "service") {
      throw new CavtoolsExecError("BAD_PROJECT_COMMAND", "Usage: cav project service start|status|refresh|diagnostics|logs|stop|restart", 400);
    }
    const action = s(parsed.args[2] || "status").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for project service.", 400);
    const needsEdit = action === "start" || action === "refresh" || action === "stop" || action === "restart";
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: needsEdit ? "EDIT" : "VIEW",
      errorCode: "UNAUTHORIZED",
    });
    await cleanupProjectServiceSessions();
    const key = runtimeProjectKey(ctx.accountId, ctx.project.id);
    const resolveSession = (candidate: string | null | undefined): ProjectServiceSession => {
      const picked = s(candidate || projectServiceSessionByProject.get(key) || "");
      if (!picked) throw new CavtoolsExecError("PROJECT_SERVICE_NOT_FOUND", "No project service session is active for this project.", 404);
      return assertProjectServiceSessionAccess(ctx, picked);
    };

    if (!action || action === "help") {
      blocks.push({
        kind: "text",
        title: "Project Service Commands",
        lines: [
          "cav project service start",
          "cav project service status [sessionId|--all]",
          "cav project service refresh [sessionId]",
          "cav project service diagnostics [sessionId]",
          "cav project service logs [sessionId] [afterSeq]",
          "cav project service stop [sessionId]",
          "cav project service restart",
        ],
      });
      return { cwd, blocks, warnings };
    }

    if (action === "start") {
      const session = await startProjectServiceSession(ctx, { stopExisting: true });
      warnings.push(...session.refreshState.warnings);
      blocks.push({
        kind: "json",
        title: "Project Service Started",
        data: projectServiceStatusPayload(session),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "restart") {
      const activeId = projectServiceSessionByProject.get(key);
      if (activeId) {
        const existing = assertProjectServiceSessionAccess(ctx, activeId);
        await stopProjectServiceSession(existing, "Project service restart requested.");
      }
      const session = await startProjectServiceSession(ctx, { stopExisting: true });
      warnings.push(...session.refreshState.warnings);
      blocks.push({
        kind: "json",
        title: "Project Service Restarted",
        data: projectServiceStatusPayload(session),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "status") {
      const allFlag = parsed.args.some((token) => s(token).toLowerCase() === "--all");
      if (allFlag) {
        const sessions = Array.from(projectServiceSessions.values())
          .filter((session) => session.accountId === ctx.accountId && session.userId === ctx.userId && session.projectId === ctx.project!.id)
          .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
          .slice(0, 24)
          .map((session) => projectServiceStatusPayload(session));
        blocks.push(tableFromObjects("Project Service Sessions", sessions as Array<Record<string, unknown>>));
        blocks.push({
          kind: "json",
          title: "Project Service Sessions",
          data: {
            type: "cav_project_service_sessions_v1",
            activeSessionId: projectServiceSessionByProject.get(key) || null,
            count: sessions.length,
            sessions,
          },
        });
        return { cwd, blocks, warnings };
      }
      const sessionId = s(parsed.args[3] || "");
      const session = resolveSession(sessionId);
      blocks.push({
        kind: "json",
        title: "Project Service Status",
        data: projectServiceStatusPayload(session),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "refresh") {
      const sessionId = s(parsed.args[3] || "");
      const session = resolveSession(sessionId);
      await projectServiceSyncWorkspace(ctx, session, { forceDiagnostics: true });
      warnings.push(...session.refreshState.warnings);
      await publishCavcodeEvent(ctx, "project.service.refresh", {
        sessionId: session.id,
        sourceVersion: session.sourceVersion,
        filesWritten: session.refreshState.filesWritten,
        filesRemoved: session.refreshState.filesRemoved,
      });
      blocks.push({
        kind: "json",
        title: "Project Service Refreshed",
        data: projectServiceStatusPayload(session),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "diagnostics") {
      const sessionId = s(parsed.args[3] || "");
      const session = resolveSession(sessionId);
      await projectServiceRunDiagnostics(session);
      const errors = session.diagnostics.filter((diag) => diag.severity === "error").length;
      const warns = session.diagnostics.filter((diag) => diag.severity === "warn").length;
      const infos = session.diagnostics.filter((diag) => diag.severity === "info").length;
      blocks.push({
        kind: "diagnostics",
        title: "Project Service Diagnostics",
        diagnostics: session.diagnostics,
        summary: {
          total: session.diagnostics.length,
          errors,
          warnings: warns,
          infos,
          filesScanned: session.tsFileCount,
          generatedAtISO: nowISO(),
          truncated: session.diagnostics.length >= PROJECT_SERVICE_MAX_DIAGNOSTICS,
        },
      });
      blocks.push({
        kind: "json",
        title: "Project Service Status",
        data: projectServiceStatusPayload(session),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "logs") {
      const sessionId = s(parsed.args[3] || "");
      const session = resolveSession(sessionId);
      const afterSeqRaw = Number(parsed.args[4]);
      const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0;
      blocks.push({
        kind: "json",
        title: "Project Service Logs",
        data: readProjectServiceLogs(session, afterSeq),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "stop") {
      const sessionId = s(parsed.args[3] || "");
      const session = resolveSession(sessionId);
      await stopProjectServiceSession(session, "Project service stop requested by operator.");
      await publishCavcodeEvent(ctx, "project.service.stop", { sessionId: session.id });
      blocks.push({
        kind: "json",
        title: "Project Service Stop Requested",
        data: projectServiceStatusPayload(session),
      });
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_PROJECT_COMMAND", "Usage: cav project service start|status|refresh|diagnostics|logs|stop|restart", 400);
  }

  if (sub === "task") {
    const action = s(parsed.args[1] || "list").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for tasks.", 400);
    const needsEdit = action === "run" || action === "stop" || action === "restart";
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: needsEdit ? "EDIT" : "VIEW",
      errorCode: "UNAUTHORIZED",
    });
    await cleanupTaskSessions();
    const listSessions = () =>
      Array.from(taskSessions.values())
        .filter((session) => session.accountId === ctx.accountId && session.userId === ctx.userId && session.projectId === ctx.project!.id)
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs);
    const resolveSession = (candidate: string | null | undefined): TaskSession => {
      const picked = s(candidate || listSessions()[0]?.id || "");
      if (!picked) throw new CavtoolsExecError("TASK_SESSION_NOT_FOUND", "No task session found for this project.", 404);
      return assertTaskSessionAccess(ctx, picked);
    };

    if (!action || action === "help") {
      blocks.push({
        kind: "text",
        title: "Task Commands",
        lines: [
          "cav task list",
          "cav task run <taskLabel|taskId>",
          "cav task status [sessionId]",
          "cav task logs [sessionId] [afterSeq]",
          "cav task stop [sessionId]",
          "cav task restart [sessionId]",
          "cav task history [limit]",
        ],
      });
      return { cwd, blocks, warnings };
    }

    if (action === "list") {
      const stage = await materializeRuntimeWorkspace(ctx);
      try {
        const tasks = await readDebugTaskDefinitionsFromWorkspace(stage.workspaceDir, null);
        blocks.push(tableFromObjects("Tasks", tasks.map((task) => ({
          id: task.id,
          label: task.label,
          type: task.type,
          command: task.command,
          group: task.group || "",
          isBackground: task.isBackground,
          problemMatchers: task.problemMatchers.length,
          dependsOn: task.dependsOn.join(", "),
        }))));
      } finally {
        try { await rm(stage.workspaceDir, { recursive: true, force: true }); } catch {}
      }
      return { cwd, blocks, warnings };
    }

    if (action === "run") {
      const selector = s(parsed.args[2] || "");
      if (!selector) throw new CavtoolsExecError("TASK_USAGE", "Usage: cav task run <taskLabel|taskId>", 400);
      const stage = await materializeRuntimeWorkspace(ctx);
      const entryHint = parseNamedFlag(parsed.args.slice(3), "entry");
      const entryAbs = entryHint ? debugLaunchPathToAbsolute(stage.workspaceDir, entryHint, null) : null;
      try {
        const tasks = await readDebugTaskDefinitionsFromWorkspace(stage.workspaceDir, entryAbs);
        const task = resolveDebugTaskDefinition(tasks, selector);
        if (!task) throw new CavtoolsExecError("TASK_NOT_FOUND", `Task not found: ${selector}`, 404);
        const session = await startTaskSessionFromDefinition(ctx, stage.workspaceDir, task, entryAbs, {
          waitForCompletion: !task.isBackground,
        });
        await publishCavcodeEvent(ctx, "task.run", {
          sessionId: session.id,
          taskId: task.id,
          taskLabel: task.label,
          status: session.status,
        });
        blocks.push({
          kind: "json",
          title: "Task Session",
          data: toTaskStatusPayload(session),
        });
        if (!task.isBackground) {
          blocks.push({
            kind: "json",
            title: "Task Logs",
            data: readTaskLogs(session, 0),
          });
          if (session.status === "exited") {
            try { await rm(session.workspaceDir, { recursive: true, force: true }); } catch {}
          }
        }
      } catch (error) {
        try { await rm(stage.workspaceDir, { recursive: true, force: true }); } catch {}
        throw error;
      }
      return { cwd, blocks, warnings };
    }

    if (action === "status") {
      const sessionId = s(parsed.args[2] || "");
      if (sessionId) {
        const session = resolveSession(sessionId);
        blocks.push({
          kind: "json",
          title: "Task Status",
          data: toTaskStatusPayload(session),
        });
      } else {
        const sessions = listSessions().slice(0, 30).map((session) => toTaskStatusPayload(session));
        blocks.push(tableFromObjects("Task Sessions", sessions as Array<Record<string, unknown>>));
        blocks.push({
          kind: "json",
          title: "Task Sessions",
          data: {
            type: "cav_task_sessions_v1",
            count: sessions.length,
            sessions,
          },
        });
      }
      return { cwd, blocks, warnings };
    }

    if (action === "logs") {
      const session = resolveSession(s(parsed.args[2] || ""));
      const afterSeqRaw = Number(parsed.args[3]);
      const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0;
      blocks.push({
        kind: "json",
        title: "Task Logs",
        data: readTaskLogs(session, afterSeq),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "stop") {
      const session = resolveSession(s(parsed.args[2] || ""));
      await stopTaskSession(session, "Task stop requested by operator.");
      await publishCavcodeEvent(ctx, "task.stop", {
        sessionId: session.id,
        taskId: session.taskId,
        taskLabel: session.label,
      });
      blocks.push({
        kind: "json",
        title: "Task Stop Requested",
        data: toTaskStatusPayload(session),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "restart") {
      const prior = resolveSession(s(parsed.args[2] || ""));
      await stopTaskSession(prior, "Task restart requested.");
      const stage = await materializeRuntimeWorkspace(ctx);
      try {
        const tasks = await readDebugTaskDefinitionsFromWorkspace(stage.workspaceDir, null);
        const task = tasks.find((row) => row.id === prior.taskId) || resolveDebugTaskDefinition(tasks, prior.label);
        if (!task) throw new CavtoolsExecError("TASK_NOT_FOUND", `Task not found for restart: ${prior.label}`, 404);
        const session = await startTaskSessionFromDefinition(ctx, stage.workspaceDir, task, null, {
          waitForCompletion: !task.isBackground,
        });
        await publishCavcodeEvent(ctx, "task.restart", {
          previousSessionId: prior.id,
          sessionId: session.id,
          taskId: task.id,
          taskLabel: task.label,
        });
        blocks.push({
          kind: "json",
          title: "Task Restarted",
          data: {
            previousSessionId: prior.id,
            ...toTaskStatusPayload(session),
          },
        });
      } catch (error) {
        try { await rm(stage.workspaceDir, { recursive: true, force: true }); } catch {}
        throw error;
      }
      return { cwd, blocks, warnings };
    }

    if (action === "history") {
      const limitRaw = Number(parsed.args[2]);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 40;
      const rows = await readTaskRunHistory({
        accountId: ctx.accountId,
        projectId: ctx.project.id,
        limit,
      });
      blocks.push(tableFromObjects("Task History", rows.map((row) => ({
        id: row.id,
        taskId: row.taskId,
        taskLabel: row.taskLabel,
        status: row.status,
        isBackground: row.isBackground,
        exitCode: row.exitCode ?? "",
        problemCount: row.problemCount,
        createdAtISO: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
        finishedAtISO: row.finishedAt ? (row.finishedAt instanceof Date ? row.finishedAt : new Date(row.finishedAt)).toISOString() : "",
      }))));
      blocks.push({
        kind: "json",
        title: "Task History",
        data: {
          type: "cav_task_history_v1",
          count: rows.length,
          rows: rows.map((row) => ({
            id: row.id,
            taskId: row.taskId,
            taskLabel: row.taskLabel,
            status: row.status,
            command: row.command,
            cwd: row.cwd,
            isBackground: row.isBackground,
            exitCode: row.exitCode,
            exitSignal: row.exitSignal,
            problemCount: row.problemCount,
            createdAtISO: (row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)).toISOString(),
            updatedAtISO: (row.updatedAt instanceof Date ? row.updatedAt : new Date(row.updatedAt)).toISOString(),
            finishedAtISO: row.finishedAt ? (row.finishedAt instanceof Date ? row.finishedAt : new Date(row.finishedAt)).toISOString() : null,
          })),
        },
      });
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_TASK_COMMAND", "Usage: cav task list|run|status|logs|stop|restart|history", 400);
  }

  if (sub === "search") {
    const action = s(parsed.args[1] || "semantic").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for search.", 400);
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    if (action === "semantic") {
      const query = s(parsed.args.slice(2).join(" "));
      if (!query) throw new CavtoolsExecError("SEARCH_QUERY_REQUIRED", "Usage: cav search semantic <query>", 400);
      let row = await readIndexerSnapshot({ accountId: ctx.accountId, projectId: ctx.project.id });
      if (!row) {
        const workspace = await ensureScmWorkspace(ctx);
        warnings.push(...workspace.sync.warnings);
        const snapshot = await buildIndexerSnapshotFromWorkspaceDir(workspace.repoDir, {
          accountId: ctx.accountId,
          projectId: ctx.project.id,
        });
        const hash = await persistIndexerSnapshot({
          accountId: ctx.accountId,
          projectId: ctx.project.id,
          snapshot,
        });
        row = { hash, snapshot };
      }
      const maxRaw = Number(parseNamedFlag(parsed.args.slice(2), "max"));
      const max = Number.isFinite(maxRaw) ? Math.max(1, Math.min(600, Math.trunc(maxRaw))) : 120;
      const queryTokens = semanticTokens(query);
      const scored = row.snapshot.symbols
        .map((sym) => {
          const score = semanticScore(queryTokens, `${sym.name} ${sym.kind} ${sym.file}`);
          return { sym, score };
        })
        .filter((rowInner) => rowInner.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, max);
      const files = new Map<string, number>();
      for (const rowInner of scored) {
        files.set(rowInner.sym.file, (files.get(rowInner.sym.file) || 0) + rowInner.score);
      }
      blocks.push(tableFromObjects(`Semantic Search: ${query}`, scored.map((rowInner) => ({
        score: rowInner.score,
        name: rowInner.sym.name,
        kind: rowInner.sym.kind,
        file: rowInner.sym.file,
        line: rowInner.sym.line,
        col: rowInner.sym.col,
      }))));
      blocks.push({
        kind: "json",
        title: "Semantic Search",
        data: {
          type: "cav_search_semantic_v1",
          query,
          hash: row.hash,
          results: scored.length,
          topFiles: Array.from(files.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([file, score]) => ({ file, score })),
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "rg") {
      const pattern = s(parsed.args[2] || "");
      if (!pattern) throw new CavtoolsExecError("SEARCH_QUERY_REQUIRED", "Usage: cav search rg <pattern> [--path <dir>] [--glob <glob>] [--max <n>]", 400);
      const maxRaw = Number(parseNamedFlag(parsed.args.slice(3), "max"));
      const maxMatches = Number.isFinite(maxRaw) ? Math.max(1, Math.min(2500, Math.trunc(maxRaw))) : 800;
      const pathFlag = s(parseNamedFlag(parsed.args.slice(3), "path") || "");
      const glob = s(parseNamedFlag(parsed.args.slice(3), "glob") || "") || null;
      const workspace = await ensureScmWorkspace(ctx);
      warnings.push(...workspace.sync.warnings);
      const relPath = (() => {
        if (!pathFlag) return ".";
        const resolved = toWorkspaceRelative(resolvePath(pathFlag, "/cavcode"));
        return resolved || ".";
      })();
      await publishCavcodeEvent(ctx, "search.rg.start", {
        pattern,
        relPath,
        glob,
        maxMatches,
      });
      const result = await runRipgrepSearch({
        ctx,
        repoDir: workspace.repoDir,
        pattern,
        relPath,
        glob,
        maxMatches,
      });
      if (result.exitCode > 1) {
        throw new CavtoolsExecError("SEARCH_RG_FAILED", result.stderr || `ripgrep failed with exit code ${result.exitCode}`, 400);
      }
      await publishCavcodeEvent(ctx, "search.rg.done", {
        pattern,
        relPath,
        matches: result.matches.length,
        streamedChunks: result.streamedChunks,
        elapsedMs: result.elapsedMs,
      });
      blocks.push(tableFromObjects(`Ripgrep: ${pattern}`, result.matches.slice(0, maxMatches).map((row) => ({
        file: row.file,
        line: row.line,
        col: row.col,
        text: row.text,
      }))));
      blocks.push({
        kind: "json",
        title: "Ripgrep Search",
        data: {
          type: "cav_search_rg_v1",
          pattern,
          relPath,
          glob,
          matches: result.matches.length,
          streamedChunks: result.streamedChunks,
          elapsedMs: result.elapsedMs,
          truncated: result.matches.length >= maxMatches,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "replace-preview") {
      const pattern = s(parsed.args[2] || "");
      const replaceValue = String(parsed.args[3] || "");
      if (!pattern) throw new CavtoolsExecError("SEARCH_QUERY_REQUIRED", "Usage: cav search replace-preview <pattern> <replace> [--path <dir>] [--glob <glob>] [--max <n>]", 400);
      const maxRaw = Number(parseNamedFlag(parsed.args.slice(4), "max"));
      const maxMatches = Number.isFinite(maxRaw) ? Math.max(1, Math.min(1200, Math.trunc(maxRaw))) : 400;
      const pathFlag = s(parseNamedFlag(parsed.args.slice(4), "path") || "");
      const glob = s(parseNamedFlag(parsed.args.slice(4), "glob") || "") || null;
      const workspace = await ensureScmWorkspace(ctx);
      warnings.push(...workspace.sync.warnings);
      const relPath = (() => {
        if (!pathFlag) return ".";
        const resolved = toWorkspaceRelative(resolvePath(pathFlag, "/cavcode"));
        return resolved || ".";
      })();
      const result = await runRipgrepSearch({
        ctx,
        repoDir: workspace.repoDir,
        pattern,
        relPath,
        glob,
        maxMatches,
      });
      if (result.exitCode > 1) {
        throw new CavtoolsExecError("SEARCH_RG_FAILED", result.stderr || `ripgrep failed with exit code ${result.exitCode}`, 400);
      }
      let regex: RegExp | null = null;
      try {
        regex = new RegExp(pattern, "g");
      } catch {
        regex = null;
      }
      const previewRows = result.matches.map((row) => {
        const before = row.text;
        const after = regex ? before.replace(regex, replaceValue) : before.split(pattern).join(replaceValue);
        return {
          file: row.file,
          line: row.line,
          col: row.col,
          before,
          after,
          changed: before !== after,
        };
      });
      const touchedFiles = new Set(previewRows.filter((row) => row.changed).map((row) => row.file));
      blocks.push(tableFromObjects("Replace Preview", previewRows.slice(0, maxMatches).map((row) => ({
        file: row.file,
        line: row.line,
        col: row.col,
        before: row.before,
        after: row.after,
        changed: row.changed,
      }))));
      blocks.push({
        kind: "json",
        title: "Replace Preview",
        data: {
          type: "cav_search_replace_preview_v1",
          pattern,
          replace: replaceValue,
          relPath,
          glob,
          matches: previewRows.length,
          changed: previewRows.filter((row) => row.changed).length,
          filesChanged: touchedFiles.size,
          truncated: previewRows.length >= maxMatches,
        },
      });
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_SEARCH_COMMAND", "Usage: cav search semantic|rg|replace-preview ...", 400);
  }

  if (sub === "debug") {
    const action = s(parsed.args[1] || "status").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for debug.", 400);
    const needsEdit =
      action === "start"
      || action === "attach"
      || action === "config"
      || action === "frame"
      || action === "stop"
      || action === "continue"
      || action === "cont"
      || action === "pause"
      || action === "next"
      || action === "step"
      || action === "out"
      || action === "break"
      || action === "watch";
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: needsEdit ? "EDIT" : "VIEW",
      errorCode: "UNAUTHORIZED",
    });
    await cleanupDebugSessions();
    const projectKey = runtimeProjectKey(ctx.accountId, ctx.project.id);
    const resolveDebugSession = (candidate: string | null | undefined): DebugSession => {
      const picked = s(candidate || debugSessionByProject.get(projectKey) || "");
      if (!picked) throw new CavtoolsExecError("DEBUG_NOT_FOUND", "No debug session is active for this project.", 404);
      return assertDebugSessionAccess(ctx, picked);
    };
    const sessionTokenIfPresent = (tokens: string[]): string | null => {
      const last = s(tokens[tokens.length - 1] || "");
      if (!last) return null;
      if (!debugSessions.has(last)) return null;
      return last;
    };
    const listProjectDebugSessions = () =>
      Array.from(debugSessions.values())
        .filter((session) => session.accountId === ctx.accountId && session.userId === ctx.userId && session.projectId === ctx.project!.id)
        .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
        .slice(0, 40);

    if (!action || action === "help") {
      blocks.push({
        kind: "text",
        title: "Debug Commands",
        lines: [
          "cav debug start <entryFile>",
          "cav debug start --target <launchName|index|compoundName> [--profile <name>] [--variant <name>]",
          "cav debug config list",
          "cav debug config start|attach <launchName|index|compoundName> [--profile <name>] [--variant <name>] [--compound|--target]",
          "cav debug attach <ws://...|host:port|port> [entryFile]",
          "cav debug attach --target <launchName|index>",
          "cav debug select <sessionId>",
          "cav debug stop [sessionId]",
          "cav debug status [sessionId|--all]",
          "cav debug logs [sessionId] [afterSeq]",
          "cav debug continue [sessionId]",
          "cav debug pause [sessionId]",
          "cav debug next [sessionId]",
          "cav debug step [sessionId]",
          "cav debug out [sessionId]",
          "cav debug threads [sessionId]",
          "cav debug threads select <threadId> [sessionId]",
          "cav debug frame list|select <ordinal> [sessionId]",
          "cav debug scopes [frameOrdinal] [sessionId]",
          "cav debug vars <variablesReference> [start] [count] [sessionId]",
          "cav debug evaluate <expression> [frameOrdinal] [sessionId]",
          "cav debug repl <expression> [sessionId]",
          "cav debug break list [sessionId]",
          "cav debug break set <file>:<line> [sessionId] [--condition <expr>] [--hit <expr>] [--log <message>] [--set <name>] [--disabled]",
          "cav debug break clear <file>:<line> [sessionId]",
          "cav debug break enable|disable <breakpointId> [sessionId]",
          "cav debug break enable-set|disable-set <setName> [sessionId]",
          "cav debug break function add|remove <name> [sessionId] [--condition <expr>] [--hit <expr>] [--set <name>] [--disabled]",
          "cav debug break exceptions list|set <all|uncaught|none> [sessionId]",
          "cav debug break data list|add|remove ... [sessionId]",
          "cav debug watch list [sessionId]",
          "cav debug watch add <expression> [sessionId]",
          "cav debug watch set <oldExpression> <newExpression> [sessionId]",
          "cav debug watch remove <expression> [sessionId]",
        ],
      });
      return { cwd, blocks, warnings };
    }

    if (action === "config") {
      const mode = s(parsed.args[2] || "list").toLowerCase();
      const launchArgs = parseDebugLaunchCliOptions(parsed.args.slice(3));
      const selector = s(launchArgs.positional[0] || "");
      const launch = await readDebugLaunchManifestForContext(ctx, null, {
        profileId: launchArgs.options.profileId || null,
        variantId: launchArgs.options.variantId || null,
      });
      if (launch.warnings.length) warnings.push(...launch.warnings);
      const manifest = launch.manifest;

      if (mode === "list") {
        const rows = manifest.targets.map((target, index) => ({
          index: index + 1,
          id: target.id,
          name: target.name,
          request: target.request,
          debugType: target.debugType,
          adapterId: target.adapterId,
          program: target.entryCavcodePath || "",
          cwd: target.cwdCavcodePath || "",
          attach: target.attachWsUrl || (target.attachPort ? `${target.attachHost || "127.0.0.1"}:${target.attachPort}` : ""),
          stopOnEntry: target.stopOnEntry,
          preLaunchTask: target.preLaunchTask || "",
          postDebugTask: target.postDebugTask || "",
          profileId: target.profileId || "",
          variantId: target.workspaceVariantId || "",
        }));
        blocks.push(tableFromObjects("Debug Launch Targets", rows));
        if (manifest.compounds.length) {
          blocks.push(tableFromObjects("Debug Launch Compounds", manifest.compounds.map((compound, index) => ({
            index: index + 1,
            id: compound.id,
            name: compound.name,
            targets: compound.targetIds.join(", "),
            preLaunchTask: compound.preLaunchTask || "",
            postDebugTask: compound.postDebugTask || "",
            stopAll: compound.stopAll,
          }))));
        }
        if (manifest.profiles.length) {
          blocks.push(tableFromObjects("Debug Launch Profiles", manifest.profiles.map((profile, index) => ({
            index: index + 1,
            id: profile.id,
            name: profile.name,
            runtimeExecutable: profile.runtimeExecutable || "",
            cwd: profile.cwdCavcodePath || "",
            preLaunchTask: profile.preLaunchTask || "",
            postDebugTask: profile.postDebugTask || "",
          }))));
        }
        if (manifest.workspaceVariants.length) {
          blocks.push(tableFromObjects("Debug Workspace Variants", manifest.workspaceVariants.map((variant, index) => ({
            index: index + 1,
            id: variant.id,
            name: variant.name,
            runtimeExecutable: variant.runtimeExecutable || "",
            cwd: variant.cwdCavcodePath || "",
            preLaunchTask: variant.preLaunchTask || "",
            postDebugTask: variant.postDebugTask || "",
          }))));
        }
        if (manifest.tasks.length) {
          blocks.push(tableFromObjects("Debug Tasks", manifest.tasks.map((task, index) => ({
            index: index + 1,
            id: task.id,
            label: task.label,
            type: task.type,
            command: task.command,
            cwd: task.cwd || "",
            dependsOn: task.dependsOn.join(", "),
          }))));
        }
        blocks.push({
          kind: "json",
          title: "Debug Launch Manifest",
          data: {
            type: "cav_debug_launch_manifest_v1",
            count: manifest.targets.length,
            targets: manifest.targets,
            compounds: manifest.compounds,
            profiles: manifest.profiles,
            workspaceVariants: manifest.workspaceVariants,
            tasks: manifest.tasks,
          },
        });
        return { cwd, blocks, warnings };
      }

      if (mode === "start" || mode === "launch" || mode === "attach") {
        if (!selector) {
          throw new CavtoolsExecError(
            "DEBUG_CONFIG_USAGE",
            "Usage: cav debug config start|attach <launchName|index|compoundName> [--profile <name>] [--variant <name>] [--compound|--target]",
            400
          );
        }
        const forceCompound = launchArgs.options.selectorType === "compound";
        const forceTarget = launchArgs.options.selectorType === "target";
        const target = forceCompound ? null : resolveDebugLaunchTarget(manifest.targets, selector);
        const compound = forceTarget ? null : resolveDebugLaunchCompound(manifest.compounds, selector);
        if (mode === "attach" && compound) {
          throw new CavtoolsExecError(
            "DEBUG_CONFIG_USAGE",
            "Compound attach is not supported. Select a single attach configuration.",
            400
          );
        }
        if (compound && !target) {
          const startedCompound = await startDebugSessionFromLaunchCompound(ctx, compound, manifest);
          if (startedCompound.warnings.length) warnings.push(...startedCompound.warnings);
          await publishCavcodeEvent(ctx, "debug.compound.start", {
            compoundId: compound.id,
            compoundName: compound.name,
            sessionIds: startedCompound.sessions.map((session) => session.id),
          });
          blocks.push({
            kind: "json",
            title: "Debug Compound Started",
            data: {
              type: "cav_debug_compound_started_v1",
              compound,
              sessions: startedCompound.sessions.map((session) => debugSessionView(session)),
            },
          });
          return { cwd, blocks, warnings };
        }
        if (!target) throw new CavtoolsExecError("DEBUG_LAUNCH_TARGET_NOT_FOUND", `Launch target not found: ${selector}`, 404);
        if (mode === "attach" && target.request !== "attach") {
          throw new CavtoolsExecError("DEBUG_LAUNCH_TARGET_NOT_ATTACH", `Launch target "${target.name}" is not an attach target.`, 400);
        }
        const started = await startDebugSessionFromLaunchTarget(ctx, target);
        if (started.warnings.length) warnings.push(...started.warnings);
        await publishCavcodeEvent(ctx, target.request === "attach" ? "debug.attach" : "debug.start", {
          sessionId: started.session.id,
          launchTarget: target.name,
          request: target.request,
          entryPath: started.session.entryCavcodePath,
        });
        blocks.push({
          kind: "json",
          title: target.request === "attach" ? "Debug Session Attached" : "Debug Session Started",
          data: debugSessionView(started.session),
        });
        return { cwd, blocks, warnings };
      }

      throw new CavtoolsExecError(
        "DEBUG_CONFIG_USAGE",
        "Usage: cav debug config list|start|attach <launchName|index|compoundName> [--profile <name>] [--variant <name>] [--compound|--target]",
        400
      );
    }

    if (action === "attach") {
      const subMode = s(parsed.args[2] || "");
      if (subMode === "--target" || subMode === "-t") {
        const parsedAttachArgs = parseDebugLaunchCliOptions(parsed.args.slice(3));
        const selector = s(parsedAttachArgs.positional[0] || "");
        if (!selector) throw new CavtoolsExecError("DEBUG_ATTACH_USAGE", "Usage: cav debug attach --target <launchName|index>", 400);
        const launch = await readDebugLaunchManifestForContext(ctx, null, {
          profileId: parsedAttachArgs.options.profileId || null,
          variantId: parsedAttachArgs.options.variantId || null,
        });
        if (launch.warnings.length) warnings.push(...launch.warnings);
        const target = resolveDebugLaunchTarget(launch.manifest.targets, selector);
        if (!target) throw new CavtoolsExecError("DEBUG_LAUNCH_TARGET_NOT_FOUND", `Launch target not found: ${selector}`, 404);
        if (target.request !== "attach") {
          throw new CavtoolsExecError("DEBUG_LAUNCH_TARGET_NOT_ATTACH", `Launch target "${target.name}" is not an attach target.`, 400);
        }
        const started = await startDebugSessionFromLaunchTarget(ctx, target);
        if (started.warnings.length) warnings.push(...started.warnings);
        await publishCavcodeEvent(ctx, "debug.attach", {
          sessionId: started.session.id,
          launchTarget: target.name,
          entryPath: started.session.entryCavcodePath,
        });
        blocks.push({
          kind: "json",
          title: "Debug Session Attached",
          data: debugSessionView(started.session),
        });
        return { cwd, blocks, warnings };
      }

      const endpointArg = s(parsed.args[2] || "");
      if (!endpointArg) {
        throw new CavtoolsExecError("DEBUG_ATTACH_USAGE", "Usage: cav debug attach <ws://...|host:port|port> [entryFile]", 400);
      }
      const endpoint = parseDebugAttachEndpoint(endpointArg);
      if (!endpoint.wsUrl && !endpoint.port) {
        throw new CavtoolsExecError("DEBUG_ATTACH_USAGE", "Attach endpoint must be ws://..., host:port, or a port number.", 400);
      }
      const entryArg = s(parsed.args[3] || "");
      const entryPath = entryArg ? resolvePath(entryArg, cwd) : null;
      const started = await startDebugAttachSession(ctx, {
        entryCavcodePath: entryPath && entryPath.startsWith("/cavcode/") ? entryPath : null,
        adapterId: "node-inspector",
        adapterType: "node",
        attachHost: endpoint.host,
        attachPort: endpoint.port,
        attachWsUrl: endpoint.wsUrl,
      });
      if (started.warnings.length) warnings.push(...started.warnings);
      await publishCavcodeEvent(ctx, "debug.attach", {
        sessionId: started.session.id,
        endpoint: endpoint.wsUrl || `${endpoint.host || "127.0.0.1"}:${endpoint.port || ""}`,
        entryPath: started.session.entryCavcodePath,
      });
      blocks.push({
        kind: "json",
        title: "Debug Session Attached",
        data: debugSessionView(started.session),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "start") {
      const startMode = s(parsed.args[2] || "");
      if (startMode === "--target" || startMode === "-t" || startMode === "--config") {
        const parsedStartArgs = parseDebugLaunchCliOptions(parsed.args.slice(3));
        const selector = s(parsedStartArgs.positional[0] || "");
        if (!selector) throw new CavtoolsExecError("DEBUG_CONFIG_USAGE", "Usage: cav debug start --target <launchName|index|compoundName>", 400);
        const launch = await readDebugLaunchManifestForContext(ctx, null, {
          profileId: parsedStartArgs.options.profileId || null,
          variantId: parsedStartArgs.options.variantId || null,
        });
        if (launch.warnings.length) warnings.push(...launch.warnings);
        const forceCompound = parsedStartArgs.options.selectorType === "compound";
        const forceTarget = parsedStartArgs.options.selectorType === "target";
        const target = forceCompound ? null : resolveDebugLaunchTarget(launch.manifest.targets, selector);
        const compound = forceTarget ? null : resolveDebugLaunchCompound(launch.manifest.compounds, selector);
        if (compound && !target) {
          const startedCompound = await startDebugSessionFromLaunchCompound(ctx, compound, launch.manifest);
          if (startedCompound.warnings.length) warnings.push(...startedCompound.warnings);
          await publishCavcodeEvent(ctx, "debug.compound.start", {
            compoundId: compound.id,
            compoundName: compound.name,
            sessionIds: startedCompound.sessions.map((session) => session.id),
          });
          blocks.push({
            kind: "json",
            title: "Debug Compound Started",
            data: {
              type: "cav_debug_compound_started_v1",
              compound,
              sessions: startedCompound.sessions.map((session) => debugSessionView(session)),
            },
          });
          return { cwd, blocks, warnings };
        }
        if (!target) throw new CavtoolsExecError("DEBUG_LAUNCH_TARGET_NOT_FOUND", `Launch target not found: ${selector}`, 404);
        const started = await startDebugSessionFromLaunchTarget(ctx, target);
        await publishCavcodeEvent(ctx, target.request === "attach" ? "debug.attach" : "debug.start", {
          sessionId: started.session.id,
          launchTarget: target.name,
          request: target.request,
          entryPath: started.session.entryCavcodePath,
        });
        blocks.push({
          kind: "json",
          title: target.request === "attach" ? "Debug Session Attached" : "Debug Session Started",
          data: debugSessionView(started.session),
        });
        if (started.warnings.length) warnings.push(...started.warnings);
        return { cwd, blocks, warnings };
      }

      const entryArg = s(parsed.args[2] || "");
      if (!entryArg) {
        const launch = await readDebugLaunchManifestForContext(ctx);
        if (launch.manifest.targets.length) {
          if (launch.warnings.length) warnings.push(...launch.warnings);
          const started = await startDebugSessionFromLaunchTarget(ctx, launch.manifest.targets[0]);
          await publishCavcodeEvent(ctx, launch.manifest.targets[0].request === "attach" ? "debug.attach" : "debug.start", {
            sessionId: started.session.id,
            launchTarget: launch.manifest.targets[0].name,
            request: launch.manifest.targets[0].request,
            entryPath: started.session.entryCavcodePath,
          });
          blocks.push({
            kind: "json",
            title: launch.manifest.targets[0].request === "attach" ? "Debug Session Attached" : "Debug Session Started",
            data: debugSessionView(started.session),
          });
          if (started.warnings.length) warnings.push(...started.warnings);
          return { cwd, blocks, warnings };
        }
      }

      const entryPath = resolvePath(entryArg || cwd, cwd);
      if (!entryPath.startsWith("/cavcode/")) {
        throw new CavtoolsExecError("DEBUG_ENTRY_INVALID", "Usage: cav debug start /cavcode/<entry-file>", 400);
      }
      const started = await startDebugSession(ctx, entryPath);
      await publishCavcodeEvent(ctx, "debug.start", {
        sessionId: started.session.id,
        entryPath: started.session.entryCavcodePath,
      });
      blocks.push({
        kind: "json",
        title: "Debug Session Started",
        data: debugSessionView(started.session),
      });
      if (started.warnings.length) warnings.push(...started.warnings);
      return { cwd, blocks, warnings };
    }

    if (action === "select") {
      const sessionId = s(parsed.args[2] || "");
      if (!sessionId) throw new CavtoolsExecError("DEBUG_SELECT_USAGE", "Usage: cav debug select <sessionId>", 400);
      const session = resolveDebugSession(sessionId);
      debugSessionByProject.set(projectKey, session.id);
      await refreshDebugSessionState(session).catch(() => {});
      blocks.push({
        kind: "json",
        title: "Debug Session Selected",
        data: debugSessionView(session),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "stop") {
      const session = resolveDebugSession(parsed.args[2]);
      await stopDebugSession(session);
      await publishCavcodeEvent(ctx, "debug.stop", {
        sessionId: session.id,
      });
      blocks.push({
        kind: "json",
        title: "Debug Stop Requested",
        data: debugSessionView(session),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "status") {
      const sessionId = s(parsed.args[2] || "");
      const includeAll = sessionId === "--all" || sessionId === "all";
      if (sessionId && !includeAll) {
        const session = resolveDebugSession(sessionId);
        await refreshDebugSessionState(session).catch(() => {});
        debugSessionByProject.set(projectKey, session.id);
        blocks.push({
          kind: "json",
          title: "Debug Session",
          data: debugSessionView(session),
        });
        return { cwd, blocks, warnings };
      }
      const sessions = listProjectDebugSessions()
        .map((session) => ({
          sessionId: session.id,
          status: session.status,
          adapterId: session.adapterId,
          adapterType: session.adapterType,
          request: session.launchRequest,
          launchTarget: session.launchTargetName || "",
          entryPath: session.entryCavcodePath,
          updatedAtISO: new Date(session.updatedAtMs).toISOString(),
          breakpoints: session.breakpoints.size + session.functionBreakpoints.size,
          watches: session.watches.size,
          nextSeq: session.nextSeq,
          exitCode: session.exitCode,
        }));
      blocks.push(tableFromObjects("Debug Sessions", sessions));
      const activeSessionId = s(debugSessionByProject.get(projectKey) || "");
      const fullSessions = listProjectDebugSessions();
      blocks.push({
        kind: "json",
        title: "Debug Sessions",
        data: {
          type: "cav_debug_sessions_v1",
          activeSessionId: activeSessionId || null,
          count: fullSessions.length,
          sessions: fullSessions.map((session) => debugSessionView(session)),
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "logs") {
      const sessionId = s(parsed.args[2] || "");
      const afterSeqRaw = Number(parsed.args[3]);
      const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0;
      const session = resolveDebugSession(sessionId);
      await refreshDebugSessionState(session).catch(() => {});
      blocks.push({
        kind: "json",
        title: "Debug Logs",
        data: readDebugLogs(session, afterSeq),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "continue" || action === "cont" || action === "pause" || action === "next" || action === "step" || action === "out") {
      const session = resolveDebugSession(parsed.args[2]);
      const command = action === "continue" || action === "cont" ? "cont" : action;
      const nextStatus: DebugSessionStatus = command === "pause" ? "running" : "running";
      await sendDebugImmediateCommand(session, command, nextStatus);
      await sleep(120);
      await refreshDebugSessionState(session).catch(() => {});
      const eventKind = action === "cont" ? "debug.continue" : `debug.${action}`;
      await publishCavcodeEvent(ctx, eventKind, {
        sessionId: session.id,
      });
      blocks.push({
        kind: "json",
        title: `Debug ${action}`,
        data: debugSessionView(session),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "threads") {
      const mode = s(parsed.args[2] || "list").toLowerCase();
      const tokens = parsed.args.slice(3).map((row) => s(row)).filter(Boolean);
      const tokenSession = sessionTokenIfPresent(tokens);
      if (tokenSession) tokens.pop();
      const session = resolveDebugSession(tokenSession);
      await refreshDebugSessionState(session).catch(() => {});
      if (mode === "select") {
        const threadIdRaw = Number(tokens[0]);
        if (!Number.isFinite(threadIdRaw) || !Number.isInteger(threadIdRaw) || threadIdRaw < 0) {
          throw new CavtoolsExecError("DEBUG_THREAD_USAGE", "Usage: cav debug threads select <threadId> [sessionId]", 400);
        }
        const threadId = Math.trunc(threadIdRaw);
        const thread = session.threads.find((row) => row.id === threadId);
        if (!thread) throw new CavtoolsExecError("DEBUG_THREAD_NOT_FOUND", `Thread not found: ${threadId}`, 404);
        session.selectedThreadId = thread.id;
        const threadFrame = session.stack.find((row) => row.threadId === thread.id);
        if (threadFrame) {
          session.selectedFrameId = threadFrame.frameId || null;
          session.currentLocation = {
            file: threadFrame.file,
            line: threadFrame.line,
            column: threadFrame.column,
          };
        }
        await publishCavcodeEvent(ctx, "debug.thread.select", {
          sessionId: session.id,
          threadId: thread.id,
        });
      }
      blocks.push(tableFromObjects("Debug Threads", session.threads.map((thread) => ({
        id: thread.id,
        name: thread.name,
        selected: session.selectedThreadId === thread.id,
        stopped: thread.stopped,
        reason: thread.reason || "",
      }))));
      blocks.push({
        kind: "json",
        title: "Debug Session",
        data: debugSessionView(session),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "frame") {
      const mode = s(parsed.args[2] || "list").toLowerCase();
      const tokens = parsed.args.slice(3).map((row) => s(row)).filter(Boolean);
      const tokenSession = sessionTokenIfPresent(tokens);
      if (tokenSession) tokens.pop();
      const session = resolveDebugSession(tokenSession);
      await refreshDebugSessionState(session).catch(() => {});
      if (mode === "list") {
        const selected = debugSelectedFrameOrdinal(session);
        blocks.push(tableFromObjects("Debug Frames", session.stack.map((frame) => ({
          id: frame.id,
          selected: selected === frame.id,
          name: frame.name,
          file: frame.file || "",
          line: frame.line || "",
          column: frame.column || "",
        }))));
        blocks.push({
          kind: "json",
          title: "Debug Session",
          data: debugSessionView(session),
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "select") {
        const ordinalRaw = Number(tokens[0]);
        if (!Number.isFinite(ordinalRaw) || !Number.isInteger(ordinalRaw) || ordinalRaw <= 0) {
          throw new CavtoolsExecError("DEBUG_FRAME_USAGE", "Usage: cav debug frame select <ordinal> [sessionId]", 400);
        }
        const ordinal = Math.trunc(ordinalRaw);
        const frame = session.stack.find((item) => item.id === ordinal);
        if (!frame) {
          throw new CavtoolsExecError("DEBUG_FRAME_NOT_FOUND", `Frame not found: ${ordinal}`, 404);
        }
        session.selectedFrameId = frame.frameId;
        session.currentLocation = {
          file: frame.file,
          line: frame.line,
          column: frame.column,
        };
        await debugRefreshWatches(session).catch(() => {});
        await publishCavcodeEvent(ctx, "debug.frame.select", {
          sessionId: session.id,
          frameOrdinal: ordinal,
          file: frame.file,
          line: frame.line,
        });
        blocks.push({
          kind: "json",
          title: "Debug Frame Selected",
          data: debugSessionView(session),
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("DEBUG_FRAME_USAGE", "Usage: cav debug frame list|select <ordinal> [sessionId]", 400);
    }

    if (action === "scopes") {
      const tokens = parsed.args.slice(2).map((row) => s(row)).filter(Boolean);
      const tokenSession = sessionTokenIfPresent(tokens);
      if (tokenSession) tokens.pop();
      const frameOrdinalRaw = Number(tokens[0]);
      const session = resolveDebugSession(tokenSession);
      await refreshDebugSessionState(session).catch(() => {});
      const frameOrdinal = Number.isFinite(frameOrdinalRaw) && frameOrdinalRaw > 0
        ? Math.trunc(frameOrdinalRaw)
        : debugSelectedFrameOrdinal(session);
      if (!frameOrdinal) throw new CavtoolsExecError("DEBUG_SCOPE_FRAME_REQUIRED", "No selected debug frame.", 400);
      const scopes = session.scopes.get(frameOrdinal) || [];
      blocks.push(tableFromObjects("Debug Scopes", scopes.map((scope) => ({
        name: scope.name,
        variablesReference: scope.variablesReference,
        expensive: scope.expensive,
        presentationHint: scope.presentationHint || "",
      }))));
      blocks.push({
        kind: "json",
        title: "Scope Context",
        data: {
          sessionId: session.id,
          frameOrdinal,
          selectedFrameOrdinal: debugSelectedFrameOrdinal(session),
          scopeCount: scopes.length,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "vars" || action === "variables") {
      const tokens = parsed.args.slice(2).map((row) => s(row)).filter(Boolean);
      const tokenSession = sessionTokenIfPresent(tokens);
      if (tokenSession) tokens.pop();
      const variablesReference = Number(tokens[0]);
      if (!Number.isFinite(variablesReference) || variablesReference <= 0) {
        throw new CavtoolsExecError("DEBUG_VARS_USAGE", "Usage: cav debug vars <variablesReference> [start] [count] [sessionId]", 400);
      }
      const start = Number.isFinite(Number(tokens[1])) ? Math.max(0, Math.trunc(Number(tokens[1]))) : 0;
      const count = Number.isFinite(Number(tokens[2])) ? Math.max(1, Math.min(500, Math.trunc(Number(tokens[2])))) : 200;
      const session = resolveDebugSession(tokenSession);
      await refreshDebugSessionState(session).catch(() => {});
      const rows = await debugListVariables(session, Math.trunc(variablesReference), start, count);
      blocks.push(tableFromObjects("Debug Variables", rows.map((row) => ({
        name: row.name,
        value: row.value,
        type: row.type || "",
        variablesReference: row.variablesReference,
        evaluateName: row.evaluateName || "",
      }))));
      blocks.push({
        kind: "json",
        title: "Variables Cursor",
        data: {
          type: "cav_debug_vars_v1",
          sessionId: session.id,
          variablesReference: Math.trunc(variablesReference),
          start,
          count,
          returned: rows.length,
          rows,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "evaluate" || action === "eval" || action === "hover" || action === "repl") {
      const tokens = parsed.args.slice(2).map((row) => s(row)).filter(Boolean);
      const tokenSession = sessionTokenIfPresent(tokens);
      if (tokenSession) tokens.pop();
      let frameOrdinal: number | null = null;
      if (tokens.length >= 2) {
        const maybeFrame = Number(tokens[tokens.length - 1]);
        if (Number.isFinite(maybeFrame) && maybeFrame > 0) {
          frameOrdinal = Math.trunc(maybeFrame);
          tokens.pop();
        }
      }
      const expression = tokens.join(" ").trim();
      if (!expression) {
        throw new CavtoolsExecError("DEBUG_EVAL_USAGE", "Usage: cav debug evaluate <expression> [frameOrdinal] [sessionId]", 400);
      }
      const session = resolveDebugSession(tokenSession);
      await refreshDebugSessionState(session).catch(() => {});
      const selectedFrame = frameOrdinal
        ? session.stack.find((frame) => frame.id === frameOrdinal)
        : session.stack[0];
      const frameId = selectedFrame?.frameId || null;
      const evaluated = await debugEvaluateExpression(session, expression, frameId);
      if (action === "repl") {
        const text = `[repl] ${expression} => ${evaluated.value}`;
        session.consoleEntries.push({
          seq: session.nextSeq + 1,
          atISO: nowISO(),
          category: "repl",
          text,
          level: "repl",
        });
        pushDebugLogLine(session, "stdout", text);
      }
      blocks.push({
        kind: "json",
        title: "Debug Evaluate",
        data: {
          type: "cav_debug_eval_v1",
          sessionId: session.id,
          expression,
          frameOrdinal: selectedFrame?.id || null,
          value: evaluated.value,
          valueType: evaluated.type,
          variablesReference: evaluated.variablesReference,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "break") {
      const mode = s(parsed.args[2] || "list").toLowerCase();
      if (mode === "list") {
        const session = resolveDebugSession(parsed.args[3]);
        await refreshDebugSessionState(session).catch(() => {});
        blocks.push(tableFromObjects("Debug Breakpoints", [
          ...Array.from(session.breakpoints.values()),
          ...Array.from(session.functionBreakpoints.values()),
        ].map((bp) => ({
          id: bp.id,
          setId: bp.setId || "",
          kind: bp.kind,
          enabled: bp.enabled,
          file: bp.file,
          line: bp.line,
          functionName: bp.functionName || "",
          condition: bp.condition || "",
          hitCondition: bp.hitCondition || "",
          logMessage: bp.logMessage || "",
          verified: bp.verified,
          hitCount: bp.hitCount,
          adapterBreakpointId: bp.adapterBreakpointId || "",
          message: bp.message || "",
        }))));
        if (session.dataBreakpoints.size) {
          blocks.push(tableFromObjects("Debug Data Breakpoints", Array.from(session.dataBreakpoints.values()).map((bp) => ({
            id: bp.id,
            enabled: bp.enabled,
            accessType: bp.accessType,
            variablesReference: bp.variablesReference,
            expression: bp.expression || "",
            message: bp.message || "",
          }))));
        }
        blocks.push({
          kind: "json",
          title: "Debug Session",
          data: debugSessionView(session),
        });
        return { cwd, blocks, warnings };
      }

      if (mode === "set" || mode === "clear") {
        const parsedArgs = parseDebugCliOptions(parsed.args.slice(3));
        const sessionToken = sessionTokenIfPresent(parsedArgs.positional);
        if (sessionToken) parsedArgs.positional.pop();
        const targetArg = s(parsedArgs.positional[0] || "");
        const lineToken = s(parsedArgs.positional[1] || "");
        const target = parseDebugBreakpointTarget(targetArg, lineToken, cwd);
        const session = resolveDebugSession(sessionToken);
        await debugEnsureTransport(session, 8_000);
        if (mode === "set") {
          const bp = await debugSetSourceBreakpoint(session, target, parsedArgs.options);
          await publishCavcodeEvent(ctx, "debug.break.set", {
            sessionId: session.id,
            file: bp.file,
            line: bp.line,
            kind: bp.kind,
            enabled: bp.enabled,
            setId: bp.setId || null,
            condition: bp.condition || null,
            hitCondition: bp.hitCondition || null,
            logMessage: bp.logMessage || null,
            verified: bp.verified,
          });
        } else {
          await debugClearSourceBreakpoint(session, target);
          await publishCavcodeEvent(ctx, "debug.break.clear", {
            sessionId: session.id,
            file: target.file,
            line: target.line,
          });
        }
        await refreshDebugSessionState(session).catch(() => {});
        blocks.push({
          kind: "json",
          title: mode === "set" ? "Breakpoint Set" : "Breakpoint Cleared",
          data: debugSessionView(session),
        });
        return { cwd, blocks, warnings };
      }

      if (mode === "enable" || mode === "disable") {
        const tokens = parsed.args.slice(3).map((row) => s(row)).filter(Boolean);
        const sessionToken = sessionTokenIfPresent(tokens);
        if (sessionToken) tokens.pop();
        const breakpointId = s(tokens[0] || "");
        if (!breakpointId) throw new CavtoolsExecError("DEBUG_BREAK_USAGE", "Usage: cav debug break enable|disable <breakpointId> [sessionId]", 400);
        const session = resolveDebugSession(sessionToken);
        const target = session.breakpoints.get(breakpointId) || session.functionBreakpoints.get(breakpointId);
        if (!target) throw new CavtoolsExecError("DEBUG_BREAK_NOT_FOUND", `Breakpoint not found: ${breakpointId}`, 404);
        const enable = mode === "enable";
        target.enabled = enable;
        if (!enable) {
          await debugRemoveAdapterBreakpoint(session, target.adapterBreakpointId);
          target.adapterBreakpointId = null;
          target.verified = false;
          target.message = "Breakpoint disabled.";
        } else if (target.kind === "function" && target.functionName) {
          await debugSetFunctionBreakpoint(session, target.functionName, {
            condition: target.condition || undefined,
            hitCondition: target.hitCondition || undefined,
            setId: target.setId || undefined,
            enabled: true,
          });
        } else {
          await debugSetSourceBreakpoint(session, { file: target.file, line: target.line }, {
            condition: target.condition || undefined,
            hitCondition: target.hitCondition || undefined,
            logMessage: target.logMessage || undefined,
            setId: target.setId || undefined,
            enabled: true,
          });
        }
        await publishCavcodeEvent(ctx, `debug.break.${mode}`, {
          sessionId: session.id,
          breakpointId,
        });
        await refreshDebugSessionState(session).catch(() => {});
        blocks.push({
          kind: "json",
          title: mode === "enable" ? "Breakpoint Enabled" : "Breakpoint Disabled",
          data: debugSessionView(session),
        });
        return { cwd, blocks, warnings };
      }

      if (mode === "enable-set" || mode === "disable-set") {
        const tokens = parsed.args.slice(3).map((row) => s(row)).filter(Boolean);
        const sessionToken = sessionTokenIfPresent(tokens);
        if (sessionToken) tokens.pop();
        const setName = s(tokens[0] || "");
        if (!setName) {
          throw new CavtoolsExecError("DEBUG_BREAK_USAGE", "Usage: cav debug break enable-set|disable-set <setName> [sessionId]", 400);
        }
        const session = resolveDebugSession(sessionToken);
        const enable = mode === "enable-set";
        const targets = [
          ...Array.from(session.breakpoints.values()),
          ...Array.from(session.functionBreakpoints.values()),
        ].filter((bp) => s(bp.setId || "").toLowerCase() === setName.toLowerCase());
        if (!targets.length) {
          throw new CavtoolsExecError("DEBUG_BREAK_NOT_FOUND", `No breakpoints found for set: ${setName}`, 404);
        }
        for (const target of targets) {
          target.enabled = enable;
          if (!enable) {
            await debugRemoveAdapterBreakpoint(session, target.adapterBreakpointId);
            target.adapterBreakpointId = null;
            target.verified = false;
            target.message = "Breakpoint disabled.";
            continue;
          }
          if (target.kind === "function" && target.functionName) {
            await debugSetFunctionBreakpoint(session, target.functionName, {
              condition: target.condition || undefined,
              hitCondition: target.hitCondition || undefined,
              setId: target.setId || undefined,
              enabled: true,
            });
            continue;
          }
          await debugSetSourceBreakpoint(session, { file: target.file, line: target.line }, {
            condition: target.condition || undefined,
            hitCondition: target.hitCondition || undefined,
            logMessage: target.logMessage || undefined,
            setId: target.setId || undefined,
            enabled: true,
          });
        }
        await publishCavcodeEvent(ctx, `debug.break.${mode}`, {
          sessionId: session.id,
          setId: setName,
          affected: targets.length,
        });
        await refreshDebugSessionState(session).catch(() => {});
        blocks.push({
          kind: "json",
          title: enable ? "Breakpoint Set Enabled" : "Breakpoint Set Disabled",
          data: debugSessionView(session),
        });
        return { cwd, blocks, warnings };
      }

      if (mode === "function") {
        const fnAction = s(parsed.args[3] || "add").toLowerCase();
        const parsedArgs = parseDebugCliOptions(parsed.args.slice(4));
        const sessionToken = sessionTokenIfPresent(parsedArgs.positional);
        if (sessionToken) parsedArgs.positional.pop();
        const functionName = s(parsedArgs.positional.join(" "));
        if (!functionName) throw new CavtoolsExecError("DEBUG_FUNCTION_USAGE", "Usage: cav debug break function add|remove <name> [sessionId]", 400);
        const session = resolveDebugSession(sessionToken);
        await debugEnsureTransport(session, 8_000);
        if (fnAction === "add" || fnAction === "set") {
          const bp = await debugSetFunctionBreakpoint(session, functionName, parsedArgs.options);
          await publishCavcodeEvent(ctx, "debug.break.function.add", {
            sessionId: session.id,
            functionName: bp.functionName,
            enabled: bp.enabled,
            setId: bp.setId || null,
            verified: bp.verified,
          });
        } else if (fnAction === "remove" || fnAction === "clear" || fnAction === "delete") {
          await debugClearFunctionBreakpoint(session, functionName);
          await publishCavcodeEvent(ctx, "debug.break.function.remove", {
            sessionId: session.id,
            functionName,
          });
        } else {
          throw new CavtoolsExecError("DEBUG_FUNCTION_USAGE", "Usage: cav debug break function add|remove <name> [sessionId]", 400);
        }
        await refreshDebugSessionState(session).catch(() => {});
        blocks.push({
          kind: "json",
          title: "Function Breakpoints",
          data: debugSessionView(session),
        });
        return { cwd, blocks, warnings };
      }

      if (mode === "exceptions") {
        const exAction = s(parsed.args[3] || "list").toLowerCase();
        const maybeMode = s(parsed.args[4] || "");
        const maybeSession = s(parsed.args[5] || parsed.args[4] || "");
        const session = resolveDebugSession(debugSessions.has(maybeSession) ? maybeSession : null);
        if (exAction === "list") {
          blocks.push({
            kind: "json",
            title: "Exception Filters",
            data: {
              sessionId: session.id,
              all: session.exceptionFilters.all,
              uncaught: session.exceptionFilters.uncaught,
              mode: debugExceptionPauseState(session),
            },
          });
          return { cwd, blocks, warnings };
        }
        if (exAction === "set") {
          const mode = maybeMode || "none";
          await debugEnsureTransport(session, 8_000);
          await debugSetExceptionFiltersMode(session, mode);
          await publishCavcodeEvent(ctx, "debug.break.exceptions.set", {
            sessionId: session.id,
            mode: debugExceptionPauseState(session),
          });
          blocks.push({
            kind: "json",
            title: "Exception Filters Updated",
            data: {
              sessionId: session.id,
              all: session.exceptionFilters.all,
              uncaught: session.exceptionFilters.uncaught,
              mode: debugExceptionPauseState(session),
            },
          });
          return { cwd, blocks, warnings };
        }
        throw new CavtoolsExecError("DEBUG_EXCEPTIONS_USAGE", "Usage: cav debug break exceptions list|set <all|uncaught|none> [sessionId]", 400);
      }

      if (mode === "data") {
        const dataAction = s(parsed.args[3] || "list").toLowerCase();
        const tokens = parsed.args.slice(4).map((row) => s(row)).filter(Boolean);
        const tokenSession = sessionTokenIfPresent(tokens);
        if (tokenSession) tokens.pop();
        const session = resolveDebugSession(tokenSession);
        if (dataAction === "list") {
          blocks.push(tableFromObjects("Debug Data Breakpoints", Array.from(session.dataBreakpoints.values()).map((bp) => ({
            id: bp.id,
            enabled: bp.enabled,
            accessType: bp.accessType,
            variablesReference: bp.variablesReference,
            expression: bp.expression || "",
            message: bp.message || "",
          }))));
          blocks.push({
            kind: "json",
            title: "Debug Session",
            data: debugSessionView(session),
          });
          return { cwd, blocks, warnings };
        }
        if (!session.protocol.capabilities.supportsDataBreakpoints) {
          throw new CavtoolsExecError(
            "DEBUG_DATA_BREAKPOINT_UNSUPPORTED",
            `Adapter ${session.protocol.adapterLabel} does not expose data breakpoints.`,
            400
          );
        }
        if (dataAction === "add") {
          const variablesReferenceRaw = Number(tokens[0]);
          if (!Number.isFinite(variablesReferenceRaw) || !Number.isInteger(variablesReferenceRaw) || variablesReferenceRaw <= 0) {
            throw new CavtoolsExecError("DEBUG_DATA_BREAKPOINT_USAGE", "Usage: cav debug break data add <variablesReference> [read|write|readWrite] [expression] [sessionId]", 400);
          }
          const accessTypeRaw = s(tokens[1] || "write");
          const accessType = accessTypeRaw === "read" || accessTypeRaw === "write" || accessTypeRaw === "readWrite"
            ? accessTypeRaw
            : "write";
          const expression = s(tokens.slice(2).join(" ")) || null;
          const id = `data:${Math.trunc(variablesReferenceRaw)}:${accessType}:${hashCommandId(expression || "watch", session.id).slice(0, 10)}`;
          session.dataBreakpoints.set(id, {
            id,
            accessType,
            enabled: true,
            variablesReference: Math.trunc(variablesReferenceRaw),
            expression,
            message: null,
          });
          await publishCavcodeEvent(ctx, "debug.break.data.add", {
            sessionId: session.id,
            breakpointId: id,
            variablesReference: Math.trunc(variablesReferenceRaw),
            accessType,
          });
          blocks.push({
            kind: "json",
            title: "Data Breakpoint Added",
            data: debugSessionView(session),
          });
          return { cwd, blocks, warnings };
        }
        if (dataAction === "remove" || dataAction === "clear" || dataAction === "delete") {
          const breakpointId = s(tokens[0] || "");
          if (!breakpointId) {
            throw new CavtoolsExecError("DEBUG_DATA_BREAKPOINT_USAGE", "Usage: cav debug break data remove <breakpointId> [sessionId]", 400);
          }
          session.dataBreakpoints.delete(breakpointId);
          await publishCavcodeEvent(ctx, "debug.break.data.remove", {
            sessionId: session.id,
            breakpointId,
          });
          blocks.push({
            kind: "json",
            title: "Data Breakpoint Removed",
            data: debugSessionView(session),
          });
          return { cwd, blocks, warnings };
        }
        throw new CavtoolsExecError("DEBUG_DATA_BREAKPOINT_USAGE", "Usage: cav debug break data list|add|remove ...", 400);
      }

      throw new CavtoolsExecError("DEBUG_BREAK_USAGE", "Usage: cav debug break list|set|clear|enable|disable|enable-set|disable-set|function|exceptions|data ...", 400);
    }

    if (action === "watch") {
      const mode = s(parsed.args[2] || "list").toLowerCase();
      const tokens = parsed.args.slice(3).map((row) => s(row)).filter(Boolean);
      const tokenSession = sessionTokenIfPresent(tokens);
      if (tokenSession) tokens.pop();
      const session = resolveDebugSession(tokenSession);

      if (mode === "list") {
        await refreshDebugSessionState(session).catch(() => {});
        blocks.push(tableFromObjects("Debug Watches", Array.from(session.watches.entries()).map(([expression, value]) => ({
          expression,
          value,
        }))));
        blocks.push({
          kind: "json",
          title: "Debug Session",
          data: debugSessionView(session),
        });
        return { cwd, blocks, warnings };
      }

      if (mode === "set") {
        const fromExpr = s(tokens[0] || "");
        const toExpr = s(tokens.slice(1).join(" "));
        if (!fromExpr || !toExpr) {
          throw new CavtoolsExecError("DEBUG_WATCH_USAGE", "Usage: cav debug watch set <oldExpression> <newExpression> [sessionId]", 400);
        }
        if (!session.watches.has(fromExpr)) {
          throw new CavtoolsExecError("DEBUG_WATCH_NOT_FOUND", `Watch not found: ${fromExpr}`, 404);
        }
        session.watches.delete(fromExpr);
        session.watches.set(toExpr, null);
        await debugRefreshWatches(session).catch(() => {});
        await publishCavcodeEvent(ctx, "debug.watch.set", {
          sessionId: session.id,
          from: fromExpr,
          to: toExpr,
        });
        blocks.push({
          kind: "json",
          title: "Watch Updated",
          data: debugSessionView(session),
        });
        return { cwd, blocks, warnings };
      }

      if (mode === "add" || mode === "remove" || mode === "rm" || mode === "delete") {
        const expr = s(tokens.join(" "));
        if (!expr) throw new CavtoolsExecError("DEBUG_WATCH_USAGE", "Usage: cav debug watch add|remove <expression>", 400);
        if (mode === "add") {
          session.watches.set(expr, null);
          await debugRefreshWatches(session).catch(() => {});
          await publishCavcodeEvent(ctx, "debug.watch.add", {
            sessionId: session.id,
            expression: expr,
          });
        } else {
          session.watches.delete(expr);
          await publishCavcodeEvent(ctx, "debug.watch.remove", {
            sessionId: session.id,
            expression: expr,
          });
        }
        await refreshDebugSessionState(session).catch(() => {});
        blocks.push({
          kind: "json",
          title: mode === "add" ? "Watch Added" : "Watch Removed",
          data: debugSessionView(session),
        });
        return { cwd, blocks, warnings };
      }

      throw new CavtoolsExecError("DEBUG_WATCH_USAGE", "Usage: cav debug watch list|add|set|remove ...", 400);
    }

    throw new CavtoolsExecError(
      "BAD_DEBUG_COMMAND",
      "Usage: cav debug start|config|attach|select|stop|status|logs|continue|pause|next|step|out|threads|frame|scopes|vars|evaluate|repl|break|watch",
      400
    );
  }

  if (sub === "events") {
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for events.", 400);
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: "VIEW",
      errorCode: "UNAUTHORIZED",
    });
    const afterSeqRaw = Number(parsed.args[1]);
    const limitRaw = Number(parsed.args[2]);
    const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0;
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(CAVCODE_EVENT_BATCH, Math.trunc(limitRaw))) : CAVCODE_EVENT_BATCH;
    const out = await readCavcodeEventsBySeq({
      accountId: ctx.accountId,
      projectId: ctx.project.id,
      afterSeq,
      limit,
    });
    blocks.push(tableFromObjects("CavCode Events", out.events.map((event) => ({
      seq: event.seq,
      kind: event.kind,
      userId: event.userId,
      atISO: event.atISO,
      payload: JSON.stringify(event.payload),
    }))));
    blocks.push({
      kind: "json",
      title: "Events Cursor",
      data: {
        afterSeq,
        nextSeq: out.nextSeq,
        count: out.events.length,
      },
    });
    return { cwd, blocks, warnings };
  }

  if (sub === "extension") {
    const action = s(parsed.args[1] || "list").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for extensions.", 400);
    const needsEdit =
      action === "marketplace"
      || action === "install"
      || action === "update"
      || action === "uninstall"
      || action === "enable"
      || action === "disable"
      || action === "host"
      || action === "activate";
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: needsEdit ? "EDIT" : "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    if (!action || action === "help") {
      blocks.push({
        kind: "text",
        title: "Extension Commands",
        lines: [
          "cav extension marketplace list [extensionId]",
          "cav extension marketplace publish <extensionId> <version> [--manifest <json>] [--from <cavcodePath>] [--publisher <name>] [--package <url>]",
          "cav extension marketplace verify <extensionId>[@version]",
          "cav extension install <extensionId>[@version]",
          "cav extension update <extensionId>",
          "cav extension uninstall <extensionId>",
          "cav extension enable <extensionId>",
          "cav extension disable <extensionId>",
          "cav extension list",
          "cav extension host start|status|logs|stop|restart",
          "cav extension activate <eventName> [--file <cavcodePath>]",
          "cav extension api",
        ],
      });
      return { cwd, blocks, warnings };
    }

    if (action === "marketplace") {
      const marketplaceAction = s(parsed.args[2] || "list").toLowerCase();

      if (marketplaceAction === "list") {
        const extensionId = s(parsed.args[3] || "");
        const rows = await listExtensionMarketplaceEntries({
          extensionId: extensionId || null,
          status: "active",
        });
        blocks.push(tableFromObjects("Extension Marketplace", rows.map((row) => ({
          extensionId: s(row.extensionId || ""),
          version: s(row.version || ""),
          publisher: s(row.publisher || ""),
          status: s(row.status || ""),
          permissions: jsonStringArray(row.permissions).join(", "),
          activationEvents: jsonStringArray(row.activationEvents).join(", "),
          updatedAtISO: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : s(row.updatedAt || ""),
        }))));
        blocks.push({
          kind: "json",
          title: "Extension Marketplace",
          data: {
            type: "cav_extension_marketplace_v1",
            count: rows.length,
            rows,
          },
        });
        return { cwd, blocks, warnings };
      }

      if (marketplaceAction === "publish") {
        const extensionId = s(parsed.args[3] || "");
        const version = s(parsed.args[4] || "");
        if (!extensionId || !version) {
          throw new CavtoolsExecError(
            "EXTENSION_MARKETPLACE_USAGE",
            "Usage: cav extension marketplace publish <extensionId> <version> [--manifest <json>] [--from <cavcodePath>] [--publisher <name>] [--package <url>]",
            400
          );
        }
        const manifestFlag = parseNamedFlag(parsed.args.slice(5), "manifest");
        const fromFlag = parseNamedFlag(parsed.args.slice(5), "from");
        const publisher = s(parseNamedFlag(parsed.args.slice(5), "publisher") || "") || "cavbot";
        const packageUrl = s(parseNamedFlag(parsed.args.slice(5), "package") || "") || null;
        let manifest: Record<string, unknown> = {
          name: extensionId,
          version,
          publisher,
          activationEvents: ["onStartupFinished"],
          permissions: ["workspace.read"],
          main: "./index.js",
        };
        if (manifestFlag) {
          try {
            const parsedManifest = JSON.parse(manifestFlag) as Record<string, unknown>;
            manifest = asRecord(parsedManifest) || manifest;
          } catch {
            throw new CavtoolsExecError("EXTENSION_MANIFEST_INVALID", "Manifest flag must contain valid JSON.", 400);
          }
        } else if (fromFlag) {
          const resolved = resolvePath(fromFlag, cwd);
          if (!resolved.startsWith("/cavcode/")) {
            throw new CavtoolsExecError("EXTENSION_MANIFEST_SCOPE", "Manifest file must be inside /cavcode.", 400);
          }
          const file = await readFileText(ctx, resolved);
          try {
            const parsedManifest = JSON.parse(String(file.content || "")) as Record<string, unknown>;
            manifest = asRecord(parsedManifest) || manifest;
          } catch {
            throw new CavtoolsExecError("EXTENSION_MANIFEST_INVALID", `Manifest JSON is invalid in ${resolved}.`, 400);
          }
        }
        manifest = {
          ...manifest,
          name: s(manifest.name || extensionId) || extensionId,
          version: s(manifest.version || version) || version,
          publisher: s(manifest.publisher || publisher) || publisher,
        };
        const activationEvents = extensionActivationEventsFromManifest(manifest);
        const permissions = extensionPermissionsFromManifest(manifest);
        const signature = s(parseNamedFlag(parsed.args.slice(5), "signature") || "") || extensionComputeSignature(extensionId, version, manifest);
        const id = `${extensionId}@${version}`;
        await ensureCavcodeInfraTables();
        await prisma.$executeRaw(
          Prisma.sql`
            INSERT INTO "CavCodeExtensionMarketplace" (
              "id",
              "extensionId",
              "version",
              "publisher",
              "manifest",
              "activationEvents",
              "permissions",
              "signature",
              "signatureAlgo",
              "packageUrl",
              "status"
            ) VALUES (
              ${id},
              ${extensionId},
              ${version},
              ${publisher},
              CAST(${JSON.stringify(manifest)} AS jsonb),
              CAST(${JSON.stringify(activationEvents)} AS jsonb),
              CAST(${JSON.stringify(permissions)} AS jsonb),
              ${signature},
              ${"hmac-sha256"},
              ${packageUrl},
              ${"active"}
            )
            ON CONFLICT ("id")
            DO UPDATE SET
              "publisher" = EXCLUDED."publisher",
              "manifest" = EXCLUDED."manifest",
              "activationEvents" = EXCLUDED."activationEvents",
              "permissions" = EXCLUDED."permissions",
              "signature" = EXCLUDED."signature",
              "signatureAlgo" = EXCLUDED."signatureAlgo",
              "packageUrl" = EXCLUDED."packageUrl",
              "status" = EXCLUDED."status",
              "updatedAt" = CURRENT_TIMESTAMP
          `
        );
        await publishCavcodeEvent(ctx, "extension.marketplace.publish", {
          extensionId,
          version,
          publisher,
          permissions,
          activationEvents,
        });
        blocks.push({
          kind: "json",
          title: "Extension Published",
          data: {
            type: "cav_extension_marketplace_publish_v1",
            id,
            extensionId,
            version,
            publisher,
            permissions,
            activationEvents,
            signature,
            packageUrl,
          },
        });
        return { cwd, blocks, warnings };
      }

      if (marketplaceAction === "verify") {
        const ref = parseExtensionRef(s(parsed.args[3] || ""));
        const row = await resolveMarketplaceExtensionVersion(ref.extensionId, ref.version);
        if (!row) throw new CavtoolsExecError("EXTENSION_NOT_FOUND", `Marketplace extension not found: ${ref.extensionId}${ref.version ? `@${ref.version}` : ""}`, 404);
        const verified = await verifyMarketplaceExtensionSignature(row);
        blocks.push({
          kind: "json",
          title: "Extension Signature",
          data: {
            type: "cav_extension_signature_v1",
            extensionId: s(row.extensionId || ""),
            version: s(row.version || ""),
            verified,
            signature: s(row.signature || ""),
            signatureAlgo: s(row.signatureAlgo || ""),
          },
        });
        if (!verified) {
          warnings.push("Extension signature verification failed for marketplace entry.");
        }
        return { cwd, blocks, warnings };
      }

      throw new CavtoolsExecError("EXTENSION_MARKETPLACE_USAGE", "Usage: cav extension marketplace list|publish|verify ...", 400);
    }

    if (action === "install" || action === "update") {
      const ref = parseExtensionRef(s(parsed.args[2] || ""));
      const row = await resolveMarketplaceExtensionVersion(ref.extensionId, action === "update" ? null : ref.version);
      if (!row) {
        throw new CavtoolsExecError(
          "EXTENSION_NOT_FOUND",
          `Marketplace extension not found: ${ref.extensionId}${ref.version ? `@${ref.version}` : ""}`,
          404
        );
      }
      const verified = await verifyMarketplaceExtensionSignature(row);
      if (!verified) throw new CavtoolsExecError("EXTENSION_SIGNATURE_INVALID", "Marketplace extension signature verification failed.", 400);
      const policy = await readExecutionPolicy(ctx);
      const manifest = asRecord(row.manifest) || {};
      const requestedPermissions = extensionPermissionsFromManifest(manifest);
      const grantedPermissions = requestedPermissions.filter((permission) => extensionPermissionAllowedByPolicy(permission, policy));
      const install = await upsertExtensionInstallRow(ctx, {
        extensionId: s(row.extensionId || ref.extensionId),
        version: s(row.version || ref.version || ""),
        enabled: true,
        runtimeStatus: "installed",
        requestedPermissions,
        grantedPermissions,
        activationEvents: extensionActivationEventsFromManifest(manifest),
      });
      await publishCavcodeEvent(ctx, action === "update" ? "extension.update" : "extension.install", {
        extensionId: install.extensionId,
        version: install.version,
        grantedPermissions: install.grantedPermissions,
      });
      if (requestedPermissions.length !== grantedPermissions.length) {
        warnings.push("Some extension permissions were denied by execution policy.");
      }
      blocks.push({
        kind: "json",
        title: action === "update" ? "Extension Updated" : "Extension Installed",
        data: {
          type: "cav_extension_install_v1",
          install,
          policy: {
            profile: policy.profile,
            sandboxMode: policy.sandboxMode,
            networkPolicy: policy.networkPolicy,
          },
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "uninstall") {
      const extensionId = s(parsed.args[2] || "");
      if (!extensionId) throw new CavtoolsExecError("EXTENSION_USAGE", "Usage: cav extension uninstall <extensionId>", 400);
      const removed = await removeExtensionInstallRow(ctx, extensionId);
      await publishCavcodeEvent(ctx, "extension.uninstall", { extensionId, removed });
      blocks.push({
        kind: "json",
        title: "Extension Uninstall",
        data: {
          type: "cav_extension_uninstall_v1",
          extensionId,
          removed,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "enable" || action === "disable") {
      const extensionId = s(parsed.args[2] || "");
      if (!extensionId) throw new CavtoolsExecError("EXTENSION_USAGE", `Usage: cav extension ${action} <extensionId>`, 400);
      const changed = await setExtensionEnabledState(ctx, extensionId, action === "enable");
      await publishCavcodeEvent(ctx, action === "enable" ? "extension.enable" : "extension.disable", {
        extensionId,
        changed,
      });
      blocks.push({
        kind: "json",
        title: action === "enable" ? "Extension Enabled" : "Extension Disabled",
        data: {
          type: "cav_extension_enable_state_v1",
          extensionId,
          enabled: action === "enable",
          changed,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "list") {
      const installs = await readInstalledExtensions(ctx);
      blocks.push(tableFromObjects("Installed Extensions", installs.map((row) => ({
        extensionId: row.extensionId,
        version: row.version,
        enabled: row.enabled,
        runtimeStatus: row.runtimeStatus,
        grantedPermissions: row.grantedPermissions.join(", "),
        activationEvents: row.activationEvents.join(", "),
        activationCount: row.activationCount,
        lastActivatedAtISO: row.lastActivatedAtISO || "",
      }))));
      blocks.push({
        kind: "json",
        title: "Installed Extensions",
        data: {
          type: "cav_extension_installed_v1",
          count: installs.length,
          installs,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "api") {
      const installs = await readInstalledExtensions(ctx);
      const rows = installs.map((row) => ({
        extensionId: row.extensionId,
        version: row.version,
        enabled: row.enabled,
        permissions: row.grantedPermissions.join(", "),
        apiSurface: Array.from(new Set(row.grantedPermissions.flatMap((permission) => extensionApiSurfaceFromPermission(permission)))).join(", "),
      }));
      blocks.push(tableFromObjects("Extension API Surface", rows));
      blocks.push({
        kind: "json",
        title: "Extension API Surface",
        data: {
          type: "cav_extension_api_surface_v1",
          rows,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "activate") {
      const eventName = s(parsed.args[2] || "");
      if (!eventName) throw new CavtoolsExecError("EXTENSION_ACTIVATE_USAGE", "Usage: cav extension activate <eventName> [--file <cavcodePath>]", 400);
      const filePath = s(parseNamedFlag(parsed.args.slice(3), "file") || "");
      const activated = await activateExtensionsForEvent(ctx, eventName, {
        filePath: filePath ? resolvePath(filePath, cwd) : null,
      });
      blocks.push({
        kind: "json",
        title: "Extension Activation",
        data: {
          type: "cav_extension_activate_v1",
          eventName,
          activated: activated.activated,
          session: activated.session ? extensionHostSessionView(activated.session) : null,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "host" || action === "logs") {
      const hostAction = action === "logs" ? "logs" : s(parsed.args[2] || "status").toLowerCase();
      const key = runtimeProjectKey(ctx.accountId, ctx.project.id);
      const resolveSession = (candidate: string | null | undefined): ExtensionHostSession => {
        const id = s(candidate || extensionHostSessionByProject.get(key) || "");
        if (!id) throw new CavtoolsExecError("EXTENSION_HOST_NOT_FOUND", "No extension host session is active for this project.", 404);
        return assertExtensionHostSessionAccess(ctx, id);
      };
      if (hostAction === "start") {
        const session = await startExtensionHostSession(ctx, { stopExisting: true });
        blocks.push({
          kind: "json",
          title: "Extension Host Started",
          data: extensionHostSessionView(session),
        });
        return { cwd, blocks, warnings };
      }
      if (hostAction === "restart") {
        const active = extensionHostSessionByProject.get(key);
        if (active) {
          const prior = assertExtensionHostSessionAccess(ctx, active);
          await stopExtensionHostSession(prior, "Extension host restart requested.");
        }
        const session = await startExtensionHostSession(ctx, { stopExisting: true });
        blocks.push({
          kind: "json",
          title: "Extension Host Restarted",
          data: extensionHostSessionView(session),
        });
        return { cwd, blocks, warnings };
      }
      if (hostAction === "stop") {
        const session = resolveSession(s(parsed.args[3] || ""));
        await stopExtensionHostSession(session);
        await publishCavcodeEvent(ctx, "extension.host.stop", { sessionId: session.id });
        blocks.push({
          kind: "json",
          title: "Extension Host Stopped",
          data: extensionHostSessionView(session),
        });
        return { cwd, blocks, warnings };
      }
      if (hostAction === "logs") {
        const session = resolveSession(s(parsed.args[action === "logs" ? 2 : 3] || ""));
        const afterSeqRaw = Number(parsed.args[action === "logs" ? 3 : 4]);
        const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0;
        blocks.push({
          kind: "json",
          title: "Extension Host Logs",
          data: readExtensionHostLogs(session, afterSeq),
        });
        return { cwd, blocks, warnings };
      }
      if (hostAction === "status") {
        const allFlag = parsed.args.some((token) => s(token).toLowerCase() === "--all");
        if (allFlag) {
          const sessions = Array.from(extensionHostSessions.values())
            .filter((session) => session.accountId === ctx.accountId && session.userId === ctx.userId && session.projectId === ctx.project!.id)
            .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
            .slice(0, 30)
            .map((session) => extensionHostSessionView(session));
          blocks.push(tableFromObjects("Extension Host Sessions", sessions as Array<Record<string, unknown>>));
          blocks.push({
            kind: "json",
            title: "Extension Host Sessions",
            data: {
              type: "cav_extension_host_sessions_v1",
              count: sessions.length,
              sessions,
              activeSessionId: extensionHostSessionByProject.get(key) || null,
            },
          });
          return { cwd, blocks, warnings };
        }
        const session = resolveSession(s(parsed.args[3] || ""));
        blocks.push({
          kind: "json",
          title: "Extension Host Status",
          data: extensionHostSessionView(session),
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("EXTENSION_HOST_USAGE", "Usage: cav extension host start|status|logs|stop|restart", 400);
    }

    throw new CavtoolsExecError("BAD_EXTENSION_COMMAND", "Usage: cav extension marketplace|install|update|uninstall|enable|disable|list|host|activate|api", 400);
  }

  if (sub === "collab") {
    const domain = s(parsed.args[1] || "session").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for collaboration.", 400);
    const needsEditDomain = domain === "session" || domain === "presence" || domain === "op" || domain === "share";
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: needsEditDomain ? "EDIT" : "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    if (domain === "session") {
      const action = s(parsed.args[2] || "list").toLowerCase();
      if (action === "list") {
        const sessions = await listCollabSessions(ctx);
        blocks.push(tableFromObjects("Collab Sessions", sessions.map((row) => ({
          sessionId: s(row.id || ""),
          documentPath: s(row.documentPath || ""),
          protocol: s(row.protocol || ""),
          status: s(row.status || ""),
          baseVersion: Number(row.baseVersion || 0),
          updatedAtISO: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : s(row.updatedAt || ""),
        }))));
        blocks.push({
          kind: "json",
          title: "Collab Sessions",
          data: {
            type: "cav_collab_sessions_v1",
            count: sessions.length,
            sessions: sessions.map((row) => collabSessionView(asRecord(row) || {})),
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "start") {
        const docArg = s(parsed.args[3] || "");
        if (!docArg) throw new CavtoolsExecError("COLLAB_SESSION_USAGE", "Usage: cav collab session start <cavcodePath> [ot|crdt]", 400);
        const protocol = parseCollabProtocol(s(parsed.args[4] || "ot"));
        const documentPath = resolvePath(docArg, cwd);
        const session = await createCollabSession(ctx, {
          documentPath,
          protocol,
        });
        await publishCavcodeEvent(ctx, "collab.session.join", {
          sessionId: s(session.id || ""),
          userId: ctx.userId,
        });
        blocks.push({
          kind: "json",
          title: "Collab Session Started",
          data: {
            type: "cav_collab_session_started_v1",
            session: collabSessionView(session),
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "status") {
        const sessionId = s(parsed.args[3] || "");
        if (!sessionId) throw new CavtoolsExecError("COLLAB_SESSION_USAGE", "Usage: cav collab session status <sessionId>", 400);
        const session = await readCollabSessionById(ctx, sessionId);
        if (!session) throw new CavtoolsExecError("COLLAB_SESSION_NOT_FOUND", `Collaboration session not found: ${sessionId}`, 404);
        const presence = await listCollabPresence(ctx, sessionId);
        const ops = await listCollabOperations(ctx, { sessionId, limit: 40 });
        blocks.push({
          kind: "json",
          title: "Collab Session Status",
          data: {
            type: "cav_collab_session_status_v1",
            session: collabSessionView(session),
            presence,
            operations: ops,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "stop") {
        const sessionId = s(parsed.args[3] || "");
        if (!sessionId) throw new CavtoolsExecError("COLLAB_SESSION_USAGE", "Usage: cav collab session stop <sessionId>", 400);
        await ensureCavcodeInfraTables();
        const result = await prisma.$executeRaw(
          Prisma.sql`
            UPDATE "CavCodeCollabSession"
            SET
              "status" = 'closed',
              "endedAt" = CURRENT_TIMESTAMP,
              "updatedAt" = CURRENT_TIMESTAMP
            WHERE "accountId" = ${ctx.accountId}
              AND "projectId" = ${ctx.project.id}
              AND "id" = ${sessionId}
          `
        );
        await publishCavcodeEvent(ctx, "collab.session.stop", {
          sessionId,
          changed: Number(result) > 0,
        });
        blocks.push({
          kind: "json",
          title: "Collab Session Stopped",
          data: {
            type: "cav_collab_session_stopped_v1",
            sessionId,
            changed: Number(result) > 0,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "join" || action === "leave") {
        const sessionId = s(parsed.args[3] || "");
        if (!sessionId) throw new CavtoolsExecError("COLLAB_SESSION_USAGE", `Usage: cav collab session ${action} <sessionId>`, 400);
        if (action === "join") {
          const activeFile = s(parseNamedFlag(parsed.args.slice(4), "file") || "");
          const panelFlag = s(parseNamedFlag(parsed.args.slice(4), "panel") || "");
          const panels = panelFlag ? panelFlag.split(",").map((item) => s(item).toLowerCase()).filter(Boolean) : [];
          const presence = await setCollabPresence(ctx, {
            sessionId,
            activeFile: activeFile ? resolvePath(activeFile, cwd) : null,
            sharedPanels: panels,
          });
          blocks.push({
            kind: "json",
            title: "Collab Session Joined",
            data: {
              type: "cav_collab_session_joined_v1",
              sessionId,
              presence,
            },
          });
        } else {
          await ensureCavcodeInfraTables();
          const result = await prisma.$executeRaw(
            Prisma.sql`
              DELETE FROM "CavCodeCollabPresence"
              WHERE "accountId" = ${ctx.accountId}
                AND "projectId" = ${ctx.project.id}
                AND "sessionId" = ${sessionId}
                AND "userId" = ${ctx.userId}
            `
          );
          await publishCavcodeEvent(ctx, "collab.session.leave", {
            sessionId,
            userId: ctx.userId,
            changed: Number(result) > 0,
          });
          blocks.push({
            kind: "json",
            title: "Collab Session Left",
            data: {
              type: "cav_collab_session_left_v1",
              sessionId,
              changed: Number(result) > 0,
            },
          });
        }
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("COLLAB_SESSION_USAGE", "Usage: cav collab session list|start|status|stop|join|leave ...", 400);
    }

    if (domain === "presence") {
      const action = s(parsed.args[2] || "list").toLowerCase();
      const sessionId = s(parsed.args[3] || "");
      if (!sessionId) throw new CavtoolsExecError("COLLAB_PRESENCE_USAGE", "Usage: cav collab presence set|list|ping <sessionId> ...", 400);
      if (action === "list") {
        const rows = await listCollabPresence(ctx, sessionId);
        blocks.push(tableFromObjects("Collab Presence", rows.map((row) => ({
          userId: s(row.userId || ""),
          displayName: s(row.displayName || ""),
          activeFile: s(row.activeFile || ""),
          sharedPanels: jsonStringArray(row.sharedPanels).join(", "),
          updatedAtISO: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : s(row.updatedAt || ""),
        }))));
        blocks.push({
          kind: "json",
          title: "Collab Presence",
          data: {
            type: "cav_collab_presence_v1",
            sessionId,
            count: rows.length,
            rows,
          },
        });
        return { cwd, blocks, warnings };
      }
      const activeFile = s(parseNamedFlag(parsed.args.slice(4), "file") || "");
      const cursorFlag = s(parseNamedFlag(parsed.args.slice(4), "cursor") || "");
      const selectionFlag = s(parseNamedFlag(parsed.args.slice(4), "selection") || "");
      const panelFlag = s(parseNamedFlag(parsed.args.slice(4), "panel") || "");
      const cursor = (() => {
        if (!cursorFlag) return {};
        const parts = cursorFlag.split(":");
        return {
          line: Math.max(1, Math.trunc(Number(parts[0] || 1)) || 1),
          col: Math.max(1, Math.trunc(Number(parts[1] || 1)) || 1),
        };
      })();
      const selection = (() => {
        if (!selectionFlag) return {};
        return { raw: selectionFlag };
      })();
      const panels = panelFlag ? panelFlag.split(",").map((item) => s(item).toLowerCase()).filter(Boolean) : [];
      const presence = await setCollabPresence(ctx, {
        sessionId,
        activeFile: activeFile ? resolvePath(activeFile, cwd) : null,
        cursor,
        selection,
        sharedPanels: panels,
      });
      blocks.push({
        kind: "json",
        title: action === "ping" ? "Collab Presence Ping" : "Collab Presence Updated",
        data: {
          type: "cav_collab_presence_update_v1",
          sessionId,
          presence,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (domain === "op") {
      const action = s(parsed.args[2] || "history").toLowerCase();
      const sessionId = s(parsed.args[3] || "");
      if (!sessionId) throw new CavtoolsExecError("COLLAB_OP_USAGE", "Usage: cav collab op apply|history <sessionId> ...", 400);
      if (action === "history") {
        const afterSeqRaw = Number(parsed.args[4]);
        const limitRaw = Number(parsed.args[5]);
        const rows = await listCollabOperations(ctx, {
          sessionId,
          afterSeq: Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0,
          limit: Number.isFinite(limitRaw) ? Math.max(1, Math.trunc(limitRaw)) : COLLAB_OP_BATCH,
        });
        blocks.push(tableFromObjects("Collab Operations", rows.map((row) => ({
          seq: Number(row.seq || 0),
          opKind: s(row.opKind || ""),
          userId: s(row.userId || ""),
          clientId: s(row.clientId || ""),
          baseVersion: Number(row.baseVersion || 0),
          appliedVersion: Number(row.appliedVersion || 0),
          createdAtISO: row.createdAt instanceof Date ? row.createdAt.toISOString() : s(row.createdAt || ""),
        }))));
        blocks.push({
          kind: "json",
          title: "Collab Operations",
          data: {
            type: "cav_collab_op_history_v1",
            sessionId,
            count: rows.length,
            rows,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "apply") {
        const opKindRaw = s(parsed.args[4] || "").toLowerCase();
        const opKind = opKindRaw === "insert" || opKindRaw === "delete" ? opKindRaw : "replace";
        const indexRaw = Number(parsed.args[5]);
        if (!Number.isFinite(indexRaw)) throw new CavtoolsExecError("COLLAB_OP_USAGE", "Usage: cav collab op apply <sessionId> <insert|delete|replace> <index> ...", 400);
        let length = 0;
        let textValue = "";
        if (opKind === "insert") {
          textValue = String(parsed.args.slice(6).join(" ") || "");
        } else if (opKind === "delete") {
          const lenRaw = Number(parsed.args[6]);
          length = Number.isFinite(lenRaw) ? Math.max(0, Math.trunc(lenRaw)) : 0;
        } else {
          const lenRaw = Number(parsed.args[6]);
          length = Number.isFinite(lenRaw) ? Math.max(0, Math.trunc(lenRaw)) : 0;
          textValue = String(parsed.args.slice(7).join(" ") || "");
        }
        const baseRaw = Number(parseNamedFlag(parsed.args.slice(4), "base"));
        const clientId = s(parseNamedFlag(parsed.args.slice(4), "client") || "cavcode");
        const applied = await applyCollabOperation(ctx, {
          sessionId,
          clientId,
          baseVersion: Number.isFinite(baseRaw) ? Math.max(0, Math.trunc(baseRaw)) : undefined,
          op: {
            kind: opKind,
            index: Math.max(0, Math.trunc(indexRaw)),
            length,
            text: textValue,
          },
        });
        blocks.push({
          kind: "json",
          title: "Collab Operation Applied",
          data: applied,
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("COLLAB_OP_USAGE", "Usage: cav collab op apply|history <sessionId> ...", 400);
    }

    if (domain === "share") {
      const sessionId = s(parsed.args[2] || "");
      const surface = s(parsed.args[3] || "").toLowerCase();
      if (!sessionId || !surface) throw new CavtoolsExecError("COLLAB_SHARE_USAGE", "Usage: cav collab share <sessionId> <debug|terminal|scm|callstack> [stateJson]", 400);
      const stateText = String(parsed.args.slice(4).join(" ") || "").trim();
      let state: Record<string, unknown> = {};
      if (stateText) {
        try {
          const parsedState = JSON.parse(stateText) as Record<string, unknown>;
          state = asRecord(parsedState) || {};
        } catch {
          state = { raw: stateText };
        }
      }
      await setCollabPresence(ctx, {
        sessionId,
        sharedPanels: [surface],
      });
      await publishCavcodeEvent(ctx, `collab.share.${surface}`, {
        sessionId,
        userId: ctx.userId,
        surface,
        state,
      });
      blocks.push({
        kind: "json",
        title: "Collab Share",
        data: {
          type: "cav_collab_share_v1",
          sessionId,
          surface,
          state,
        },
      });
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_COLLAB_COMMAND", "Usage: cav collab session|presence|op|share ...", 400);
  }

  if (sub === "security") {
    const action = s(parsed.args[1] || "status").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for security.", 400);
    const needsEdit = action === "profile" || action === "secrets" || action === "scan";
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: needsEdit ? "EDIT" : "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    if (action === "status") {
      const policy = await readExecutionPolicy(ctx);
      const activeCounts = {
        runtime: Array.from(runtimeSessions.values()).filter((row) => row.accountId === ctx.accountId && row.projectId === ctx.project!.id && sessionActive(row.status)).length,
        debug: Array.from(debugSessions.values()).filter((row) => row.accountId === ctx.accountId && row.projectId === ctx.project!.id && sessionActive(row.status)).length,
        task: Array.from(taskSessions.values()).filter((row) => row.accountId === ctx.accountId && row.projectId === ctx.project!.id && sessionActive(row.status)).length,
        extensionHost: Array.from(extensionHostSessions.values()).filter((row) => row.accountId === ctx.accountId && row.projectId === ctx.project!.id && sessionActive(row.status)).length,
      };
      const secrets = await listSecretBrokerValues(ctx);
      blocks.push({
        kind: "json",
        title: "Security Status",
        data: {
          type: "cav_security_status_v1",
          policy,
          activeCounts,
          secrets: secrets.map((row) => ({
            alias: row.alias,
            scopes: row.scopes,
            updatedAtISO: row.updatedAtISO,
          })),
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "profile") {
      const mode = s(parsed.args[2] || "status").toLowerCase();
      if (mode === "status") {
        blocks.push({
          kind: "json",
          title: "Execution Policy",
          data: {
            type: "cav_security_profile_v1",
            policy: await readExecutionPolicy(ctx),
          },
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "set" || mode === "reset") {
        const profileToken = mode === "reset" ? "balanced" : s(parsed.args[3] || "");
        const profile = profileToken === "strict" || profileToken === "trusted" ? profileToken : "balanced";
        const defaults = executionPolicyDefaults(ctx.planId);
        const patch: Partial<CavcodeExecutionPolicyRecord> = mode === "reset"
          ? {
              profile: defaults.profile,
              sandboxMode: defaults.sandboxMode,
              networkPolicy: defaults.networkPolicy,
              maxConcurrentRuntime: defaults.maxConcurrentRuntime,
              maxConcurrentDebug: defaults.maxConcurrentDebug,
              maxConcurrentTasks: defaults.maxConcurrentTasks,
              maxConcurrentExtensionHosts: defaults.maxConcurrentExtensionHosts,
              allowedCommandRegex: defaults.allowedCommandRegex,
              blockedCommandRegex: defaults.blockedCommandRegex,
              quotas: defaults.quotas,
              policy: defaults.policy,
            }
          : {
              profile,
              sandboxMode: (() => {
                const raw = s(parseNamedFlag(parsed.args.slice(4), "sandbox") || "");
                if (raw === "restricted" || raw === "extended") return raw as ExecutionSandboxMode;
                return "standard";
              })(),
              networkPolicy: (() => {
                const raw = s(parseNamedFlag(parsed.args.slice(4), "network") || "");
                if (raw === "deny" || raw === "allow") return raw as NetworkPolicyMode;
                return "project-only";
              })(),
              maxConcurrentRuntime: Number.isFinite(Number(parseNamedFlag(parsed.args.slice(4), "max-runtime")))
                ? Math.max(1, Math.trunc(Number(parseNamedFlag(parsed.args.slice(4), "max-runtime"))))
                : undefined,
              maxConcurrentDebug: Number.isFinite(Number(parseNamedFlag(parsed.args.slice(4), "max-debug")))
                ? Math.max(1, Math.trunc(Number(parseNamedFlag(parsed.args.slice(4), "max-debug"))))
                : undefined,
              maxConcurrentTasks: Number.isFinite(Number(parseNamedFlag(parsed.args.slice(4), "max-task")))
                ? Math.max(1, Math.trunc(Number(parseNamedFlag(parsed.args.slice(4), "max-task"))))
                : undefined,
              maxConcurrentExtensionHosts: Number.isFinite(Number(parseNamedFlag(parsed.args.slice(4), "max-ext")))
                ? Math.max(1, Math.trunc(Number(parseNamedFlag(parsed.args.slice(4), "max-ext"))))
                : undefined,
              allowedCommandRegex: (() => {
                const raw = s(parseNamedFlag(parsed.args.slice(4), "allow") || "");
                return raw ? raw.split(",").map((item) => s(item)).filter(Boolean) : undefined;
              })(),
              blockedCommandRegex: (() => {
                const raw = s(parseNamedFlag(parsed.args.slice(4), "block") || "");
                return raw ? raw.split(",").map((item) => s(item)).filter(Boolean) : undefined;
              })(),
            };
        const policy = await upsertExecutionPolicy(ctx, patch);
        await publishCavcodeEvent(ctx, "security.profile.update", {
          profile: policy.profile,
          sandboxMode: policy.sandboxMode,
          networkPolicy: policy.networkPolicy,
        });
        blocks.push({
          kind: "json",
          title: "Execution Policy Updated",
          data: {
            type: "cav_security_profile_v1",
            policy,
          },
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("SECURITY_PROFILE_USAGE", "Usage: cav security profile status|set|reset ...", 400);
    }

    if (action === "secrets") {
      const mode = s(parsed.args[2] || "list").toLowerCase();
      if (mode === "list") {
        const rows = await listSecretBrokerValues(ctx);
        blocks.push(tableFromObjects("Secret Broker", rows.map((row) => ({
          alias: s(row.alias || ""),
          scopes: jsonStringArray(row.scopes).join(", "),
          updatedAtISO: s(row.updatedAtISO || ""),
          rotatedAtISO: s(row.rotatedAtISO || ""),
        }))));
        blocks.push({
          kind: "json",
          title: "Secret Broker",
          data: {
            type: "cav_security_secrets_v1",
            count: rows.length,
            rows: rows.map((row) => ({
              alias: row.alias,
              scopes: row.scopes,
              updatedAtISO: row.updatedAtISO,
            })),
          },
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "set") {
        const alias = s(parsed.args[3] || "");
        const value = String(parsed.args[4] || "");
        if (!alias || !value) {
          throw new CavtoolsExecError("SECURITY_SECRETS_USAGE", "Usage: cav security secrets set <alias> <value> [--scopes runtime,task,debug,project-service,extension-host,*]", 400);
        }
        const scopesFlag = s(parseNamedFlag(parsed.args.slice(5), "scopes") || "");
        const scopes = scopesFlag
          ? scopesFlag.split(",").map((item) => s(item).toLowerCase()).filter(Boolean)
          : ["runtime", "task", "debug", "project-service", "extension-host"];
        await upsertSecretBrokerValue(ctx, alias, value, scopes);
        await publishCavcodeEvent(ctx, "security.secret.set", {
          alias: normalizeSecretAlias(alias),
          scopes,
        });
        blocks.push({
          kind: "json",
          title: "Secret Stored",
          data: {
            type: "cav_security_secret_set_v1",
            alias: normalizeSecretAlias(alias),
            scopes,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "get") {
        const alias = s(parsed.args[3] || "");
        if (!alias) throw new CavtoolsExecError("SECURITY_SECRETS_USAGE", "Usage: cav security secrets get <alias>", 400);
        const rows = await listSecretBrokerValues(ctx, { includeValue: true });
        const picked = rows.find((row) => normalizeSecretAlias(s(row.alias || "")) === normalizeSecretAlias(alias));
        if (!picked) throw new CavtoolsExecError("SECRET_NOT_FOUND", `Secret not found: ${alias}`, 404);
        blocks.push({
          kind: "json",
          title: "Secret Value",
          data: {
            type: "cav_security_secret_get_v1",
            alias: picked.alias,
            scopes: picked.scopes,
            value: picked.value,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "revoke" || mode === "delete") {
        const alias = s(parsed.args[3] || "");
        if (!alias) throw new CavtoolsExecError("SECURITY_SECRETS_USAGE", "Usage: cav security secrets revoke <alias>", 400);
        const revoked = await revokeSecretBrokerValue(ctx, alias);
        await publishCavcodeEvent(ctx, "security.secret.revoke", {
          alias: normalizeSecretAlias(alias),
          revoked,
        });
        blocks.push({
          kind: "json",
          title: "Secret Revoked",
          data: {
            type: "cav_security_secret_revoke_v1",
            alias: normalizeSecretAlias(alias),
            revoked,
          },
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("SECURITY_SECRETS_USAGE", "Usage: cav security secrets list|set|get|revoke ...", 400);
    }

    if (action === "scan") {
      const mode = s(parsed.args[2] || "run").toLowerCase();
      if (mode === "run") {
        const stage = await materializeRuntimeWorkspace(ctx);
        try {
          const targetPath = s(parsed.args[3] || "/cavcode");
          const scan = await runQuarantineScanForWorkspace({
            ctx,
            workspaceDir: stage.workspaceDir,
            targetKind: "manual",
            targetPath,
          });
          blocks.push({
            kind: "json",
            title: "Quarantine Scan",
            data: {
              type: "cav_security_scan_v1",
              ...scan,
            },
          });
          if (scan.verdict === "warn") {
            warnings.push(`Quarantine scan reported ${scan.findings.length} warning finding(s).`);
          }
          if (scan.verdict === "blocked") {
            warnings.push(`Quarantine scan reported ${scan.findings.length} blocked finding(s).`);
          }
        } finally {
          try {
            await rm(stage.workspaceDir, { recursive: true, force: true });
          } catch {}
        }
        return { cwd, blocks, warnings };
      }
      if (mode === "history" || mode === "status") {
        const limitRaw = Number(parsed.args[3]);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, Math.trunc(limitRaw))) : 40;
        await ensureCavcodeInfraTables();
        const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
          Prisma.sql`
            SELECT
              "id",
              "targetKind",
              "targetPath",
              "engine",
              "status",
              "verdict",
              "findings",
              "metadata",
              "createdAt",
              "updatedAt",
              "finishedAt"
            FROM "CavCodeQuarantineScan"
            WHERE "accountId" = ${ctx.accountId}
              AND "projectId" = ${ctx.project.id}
            ORDER BY "createdAt" DESC
            LIMIT ${limit}
          `
        );
        blocks.push(tableFromObjects("Quarantine Scan History", rows.map((row) => ({
          id: s(row.id || ""),
          targetKind: s(row.targetKind || ""),
          targetPath: s(row.targetPath || ""),
          verdict: s(row.verdict || ""),
          findings: Array.isArray(row.findings) ? row.findings.length : 0,
          createdAtISO: row.createdAt instanceof Date ? row.createdAt.toISOString() : s(row.createdAt || ""),
          finishedAtISO: row.finishedAt instanceof Date ? row.finishedAt.toISOString() : s(row.finishedAt || ""),
        }))));
        blocks.push({
          kind: "json",
          title: "Quarantine Scan History",
          data: {
            type: "cav_security_scan_history_v1",
            count: rows.length,
            rows,
          },
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("SECURITY_SCAN_USAGE", "Usage: cav security scan run|history [limit]", 400);
    }

    if (action === "audit") {
      const limitRaw = Number(parsed.args[2]);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(SECURITY_AUDIT_LIMIT, Math.trunc(limitRaw))) : 80;
      await ensureCavcodeInfraTables();
      const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>(
        Prisma.sql`
          SELECT
            "id",
            "action",
            "resource",
            "decision",
            "reason",
            "metadata",
            "createdAt"
          FROM "CavCodeSecurityAudit"
          WHERE "accountId" = ${ctx.accountId}
            AND "projectId" = ${ctx.project.id}
          ORDER BY "createdAt" DESC
          LIMIT ${limit}
        `
      );
      blocks.push(tableFromObjects("Security Audit Trail", rows.map((row) => ({
        id: s(row.id || ""),
        action: s(row.action || ""),
        resource: s(row.resource || ""),
        decision: s(row.decision || ""),
        reason: s(row.reason || ""),
        createdAtISO: row.createdAt instanceof Date ? row.createdAt.toISOString() : s(row.createdAt || ""),
      }))));
      blocks.push({
        kind: "json",
        title: "Security Audit Trail",
        data: {
          type: "cav_security_audit_v1",
          count: rows.length,
          rows,
        },
      });
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_SECURITY_COMMAND", "Usage: cav security status|profile|secrets|scan|audit ...", 400);
  }

  if (sub === "remote") {
    const domain = s(parsed.args[1] || "session").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for remote development.", 400);
    const needsEdit = domain === "provider" || domain === "session" || domain === "port";
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: needsEdit ? "EDIT" : "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    if (domain === "provider") {
      const action = s(parsed.args[2] || "list").toLowerCase();
      if (action === "list") {
        const rows = await listRemoteProviders(ctx);
        blocks.push(tableFromObjects("Remote Providers", rows.map((row) => ({
          providerId: s(row.providerId || ""),
          providerType: s(row.providerType || ""),
          label: s(row.label || ""),
          status: s(row.status || ""),
          updatedAtISO: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : s(row.updatedAt || ""),
        }))));
        blocks.push({
          kind: "json",
          title: "Remote Providers",
          data: {
            type: "cav_remote_provider_list_v1",
            count: rows.length,
            rows,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "upsert" || action === "set") {
        const providerId = s(parsed.args[3] || "");
        const providerType = toRemoteProviderType(s(parsed.args[4] || "ssh"));
        if (!providerId) {
          throw new CavtoolsExecError(
            "REMOTE_PROVIDER_USAGE",
            "Usage: cav remote provider upsert <providerId> <ssh|container|workspace> [--label <text>] [--config <json>]",
            400
          );
        }
        const label = s(parseNamedFlag(parsed.args.slice(5), "label") || providerId) || providerId;
        const configFlag = s(parseNamedFlag(parsed.args.slice(5), "config") || "");
        let config: Record<string, unknown> = {};
        if (configFlag) {
          try {
            config = asRecord(JSON.parse(configFlag)) || {};
          } catch {
            throw new CavtoolsExecError("REMOTE_PROVIDER_CONFIG_INVALID", "Remote provider config must be valid JSON.", 400);
          }
        }
        await upsertRemoteProvider(ctx, {
          providerId,
          providerType,
          label,
          config,
        });
        await publishCavcodeEvent(ctx, "remote.provider.upsert", {
          providerId,
          providerType,
        });
        blocks.push({
          kind: "json",
          title: "Remote Provider Upserted",
          data: {
            type: "cav_remote_provider_upsert_v1",
            providerId,
            providerType,
            label,
            config,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "remove" || action === "delete") {
        const providerId = s(parsed.args[3] || "");
        if (!providerId) throw new CavtoolsExecError("REMOTE_PROVIDER_USAGE", "Usage: cav remote provider remove <providerId>", 400);
        const removed = await removeRemoteProvider(ctx, providerId);
        await publishCavcodeEvent(ctx, "remote.provider.remove", { providerId, removed });
        blocks.push({
          kind: "json",
          title: "Remote Provider Removed",
          data: {
            type: "cav_remote_provider_remove_v1",
            providerId,
            removed,
          },
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("REMOTE_PROVIDER_USAGE", "Usage: cav remote provider list|upsert|remove ...", 400);
    }

    if (domain === "session") {
      const action = s(parsed.args[2] || "status").toLowerCase();
      const key = runtimeProjectKey(ctx.accountId, ctx.project.id);
      const resolveSession = (candidate: string | null | undefined): RemoteSession => {
        const picked = s(candidate || remoteSessionByProject.get(key) || "");
        if (!picked) throw new CavtoolsExecError("REMOTE_SESSION_NOT_FOUND", "No remote session is active for this project.", 404);
        return assertRemoteSessionAccess(ctx, picked);
      };

      if (action === "start") {
        const providerId = s(parsed.args[3] || "");
        if (!providerId) {
          throw new CavtoolsExecError(
            "REMOTE_SESSION_USAGE",
            "Usage: cav remote session start <providerId> [--path <workspacePath>] [--latency <ms>]",
            400
          );
        }
        const workspacePath = s(parseNamedFlag(parsed.args.slice(4), "path") || "");
        const latencyRaw = Number(parseNamedFlag(parsed.args.slice(4), "latency"));
        const session = await startRemoteSession(ctx, {
          providerId,
          workspacePath: workspacePath || null,
          latencyMs: Number.isFinite(latencyRaw) ? Math.max(1, Math.trunc(latencyRaw)) : null,
          stopExisting: true,
        });
        blocks.push({
          kind: "json",
          title: "Remote Session Started",
          data: remoteSessionView(session),
        });
        return { cwd, blocks, warnings };
      }

      if (action === "restart") {
        const prior = resolveSession(s(parsed.args[3] || ""));
        await stopRemoteSession(prior, "Remote session restart requested.");
        const session = await startRemoteSession(ctx, {
          providerId: prior.providerId,
          workspacePath: prior.workspacePath,
          latencyMs: prior.latencyMs,
          stopExisting: true,
        });
        blocks.push({
          kind: "json",
          title: "Remote Session Restarted",
          data: {
            previousSessionId: prior.id,
            ...remoteSessionView(session),
          },
        });
        return { cwd, blocks, warnings };
      }

      if (action === "stop") {
        const session = resolveSession(s(parsed.args[3] || ""));
        await stopRemoteSession(session);
        await publishCavcodeEvent(ctx, "remote.session.stop", { sessionId: session.id });
        blocks.push({
          kind: "json",
          title: "Remote Session Stopped",
          data: remoteSessionView(session),
        });
        return { cwd, blocks, warnings };
      }

      if (action === "logs") {
        const session = resolveSession(s(parsed.args[3] || ""));
        const afterSeqRaw = Number(parsed.args[4]);
        const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0;
        blocks.push({
          kind: "json",
          title: "Remote Session Logs",
          data: readRemoteSessionLogs(session, afterSeq),
        });
        return { cwd, blocks, warnings };
      }

      if (action === "status" || action === "list") {
        const allFlag = parsed.args.some((token) => s(token).toLowerCase() === "--all") || action === "list";
        if (allFlag) {
          const sessions = Array.from(remoteSessions.values())
            .filter((session) => session.accountId === ctx.accountId && session.projectId === ctx.project!.id && session.userId === ctx.userId)
            .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
            .map((session) => remoteSessionView(session));
          const persisted = await listPersistedRemoteSessions(ctx, 80);
          blocks.push(tableFromObjects("Remote Sessions (Active)", sessions as Array<Record<string, unknown>>));
          blocks.push(tableFromObjects("Remote Sessions (Persisted)", persisted.map((row) => ({
            sessionId: s(row.id || ""),
            providerId: s(row.providerId || ""),
            providerType: s(row.providerType || ""),
            workspacePath: s(row.workspacePath || ""),
            status: s(row.status || ""),
            latencyMs: Number(row.latencyMs || 0),
            updatedAtISO: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : s(row.updatedAt || ""),
          }))));
          blocks.push({
            kind: "json",
            title: "Remote Sessions",
            data: {
              type: "cav_remote_sessions_v1",
              activeSessionId: remoteSessionByProject.get(key) || null,
              activeCount: sessions.length,
              persistedCount: persisted.length,
              sessions,
              persisted,
            },
          });
          return { cwd, blocks, warnings };
        }
        const session = resolveSession(s(parsed.args[3] || ""));
        blocks.push({
          kind: "json",
          title: "Remote Session Status",
          data: remoteSessionView(session),
        });
        return { cwd, blocks, warnings };
      }

      throw new CavtoolsExecError("REMOTE_SESSION_USAGE", "Usage: cav remote session start|status|logs|stop|restart|list ...", 400);
    }

    if (domain === "port") {
      const action = s(parsed.args[2] || "list").toLowerCase();
      if (action === "list") {
        const sessionId = s(parsed.args[3] || "");
        const rows = await listRemotePortForwards(ctx, sessionId || null);
        blocks.push(tableFromObjects("Remote Port Forwards", rows.map((row) => ({
          id: s(row.id || ""),
          sessionId: s(row.sessionId || ""),
          local: Number(row.localPort || 0),
          remote: `${s(row.remoteHost || "")}:${Number(row.remotePort || 0)}`,
          protocol: s(row.protocol || ""),
          status: s(row.status || ""),
          updatedAtISO: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : s(row.updatedAt || ""),
        }))));
        blocks.push({
          kind: "json",
          title: "Remote Port Forwards",
          data: {
            type: "cav_remote_port_forwards_v1",
            count: rows.length,
            rows,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "forward" || action === "add") {
        const sessionId = s(parsed.args[3] || "");
        const localPort = Number(parsed.args[4]);
        const remoteHost = s(parsed.args[5] || "");
        const remotePort = Number(parsed.args[6]);
        const protocol = s(parsed.args[7] || "tcp");
        if (!sessionId || !Number.isFinite(localPort) || !remoteHost || !Number.isFinite(remotePort)) {
          throw new CavtoolsExecError("REMOTE_PORT_USAGE", "Usage: cav remote port forward <sessionId> <localPort> <remoteHost> <remotePort> [tcp|udp]", 400);
        }
        const forward = await addRemotePortForward(ctx, {
          sessionId,
          localPort: Math.trunc(localPort),
          remoteHost,
          remotePort: Math.trunc(remotePort),
          protocol,
        });
        blocks.push({
          kind: "json",
          title: "Remote Port Forward Added",
          data: {
            type: "cav_remote_port_forward_v1",
            forward,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "close" || action === "remove") {
        const forwardId = s(parsed.args[3] || "");
        if (!forwardId) throw new CavtoolsExecError("REMOTE_PORT_USAGE", "Usage: cav remote port close <forwardId>", 400);
        const closed = await closeRemotePortForward(ctx, forwardId);
        await publishCavcodeEvent(ctx, "remote.port.close", {
          forwardId,
          closed,
        });
        blocks.push({
          kind: "json",
          title: "Remote Port Forward Closed",
          data: {
            type: "cav_remote_port_close_v1",
            forwardId,
            closed,
          },
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("REMOTE_PORT_USAGE", "Usage: cav remote port list|forward|close ...", 400);
    }

    if (domain === "debug") {
      const action = s(parsed.args[2] || "adapters").toLowerCase();
      if (action !== "adapters" && action !== "list") {
        throw new CavtoolsExecError("REMOTE_DEBUG_USAGE", "Usage: cav remote debug adapters [sessionId]", 400);
      }
      const key = runtimeProjectKey(ctx.accountId, ctx.project.id);
      const sessionId = s(parsed.args[3] || remoteSessionByProject.get(key) || "");
      if (!sessionId) throw new CavtoolsExecError("REMOTE_SESSION_NOT_FOUND", "No remote session is active for remote debug adapters.", 404);
      const session = assertRemoteSessionAccess(ctx, sessionId);
      blocks.push(tableFromObjects("Remote Debug Adapters", session.adapterMap.map((adapter) => ({
        id: adapter.id,
        label: adapter.label,
        type: adapter.type,
        endpoint: `${adapter.host}:${adapter.port}`,
        capability: adapter.capability.join(", "),
      }))));
      blocks.push({
        kind: "json",
        title: "Remote Debug Adapters",
        data: {
          type: "cav_remote_debug_adapters_v1",
          sessionId: session.id,
          adapters: session.adapterMap,
        },
      });
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_REMOTE_COMMAND", "Usage: cav remote provider|session|port|debug ...", 400);
  }

  if (sub === "reliability") {
    const action = s(parsed.args[1] || "status").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for reliability.", 400);
    const needsEdit = action === "restore" || action === "budget" || action === "crash";
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: needsEdit ? "EDIT" : "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    if (action === "status") {
      const budget = await readReliabilityBudget(ctx);
      const metrics = await reliabilitySloMetrics(ctx, RELIABILITY_EVENT_WINDOW_DAYS);
      const snapshots = await listReliabilitySnapshots(ctx, { limit: 20 });
      const burnUsedPct = Math.max(0, (100 - Number(metrics.availability || 100)) / Math.max(0.001, budget.errorBudgetPct) * 100);
      const status = burnUsedPct >= budget.burnAlertPct ? "alert" : burnUsedPct >= budget.burnAlertPct * 0.7 ? "watch" : "good";
      blocks.push({
        kind: "json",
        title: "Reliability Status",
        data: {
          type: "cav_reliability_status_v1",
          budget,
          metrics,
          burnUsedPct,
          status,
          recentSnapshots: snapshots.slice(0, 12),
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "snapshots" || action === "snapshot") {
      const kind = s(parsed.args[2] || "");
      const limitRaw = Number(parsed.args[3]);
      const rows = await listReliabilitySnapshots(ctx, {
        kind: kind || null,
        limit: Number.isFinite(limitRaw) ? Math.max(1, Math.trunc(limitRaw)) : 80,
      });
      blocks.push(tableFromObjects("Reliability Snapshots", rows.map((row) => ({
        id: s(row.id || ""),
        kind: s(row.kind || ""),
        scopeId: s(row.scopeId || ""),
        status: s(row.status || ""),
        createdAtISO: row.createdAt instanceof Date ? row.createdAt.toISOString() : s(row.createdAt || ""),
      }))));
      blocks.push({
        kind: "json",
        title: "Reliability Snapshots",
        data: {
          type: "cav_reliability_snapshots_v1",
          count: rows.length,
          rows,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "restore") {
      const targetKind = s(parsed.args[2] || "").toLowerCase();
      const target = s(parsed.args[3] || "");
      if (!targetKind) {
        throw new CavtoolsExecError(
          "RELIABILITY_RESTORE_USAGE",
          "Usage: cav reliability restore runtime|task|debug|project-service|extension-host|remote|ai-checkpoint <target>",
          400
        );
      }
      let restoreResult: Record<string, unknown> = {};
      if (targetKind === "runtime") {
        const kind = s(target || "dev").toLowerCase();
        const runKind: RuntimeRunKind = kind === "build" ? "build" : kind === "test" ? "test" : "dev";
        const started = await startRuntimeSession(ctx, runKind);
        restoreResult = { kind: targetKind, restored: runtimeSessionView(started.session), warnings: started.warnings };
      } else if (targetKind === "task") {
        const selector = s(target || "test");
        const task = await runDebugTaskForContext(ctx, selector);
        restoreResult = { kind: targetKind, selector, warnings: task.warnings };
      } else if (targetKind === "debug") {
        const entry = normalizePath(s(target || "/cavcode/app/page.tsx"));
        const started = await startDebugSession(ctx, entry, { stopExisting: true });
        restoreResult = { kind: targetKind, restored: debugSessionView(started.session), warnings: started.warnings };
      } else if (targetKind === "project-service") {
        const session = await startProjectServiceSession(ctx, { stopExisting: true });
        restoreResult = { kind: targetKind, restored: projectServiceStatusPayload(session) };
      } else if (targetKind === "extension-host") {
        const session = await startExtensionHostSession(ctx, { stopExisting: true });
        restoreResult = { kind: targetKind, restored: extensionHostSessionView(session) };
      } else if (targetKind === "remote") {
        const providerId = s(target || "");
        if (!providerId) throw new CavtoolsExecError("RELIABILITY_RESTORE_USAGE", "Restore remote requires providerId.", 400);
        const session = await startRemoteSession(ctx, {
          providerId,
          stopExisting: true,
        });
        restoreResult = { kind: targetKind, restored: remoteSessionView(session) };
      } else if (targetKind === "ai-checkpoint" || targetKind === "checkpoint") {
        if (!target) throw new CavtoolsExecError("RELIABILITY_RESTORE_USAGE", "Restore ai-checkpoint requires checkpointId.", 400);
        const restored = await restoreAiCheckpoint(ctx, target);
        restoreResult = { kind: "ai-checkpoint", checkpointId: target, restored };
      } else {
        throw new CavtoolsExecError("RELIABILITY_RESTORE_USAGE", "Unknown restore target kind.", 400);
      }
      await recordReliabilitySnapshot(ctx, {
        kind: `restore:${targetKind}`,
        scopeId: s(target || targetKind),
        status: "restored",
        payload: restoreResult,
      }).catch(() => {});
      blocks.push({
        kind: "json",
        title: "Reliability Restore",
        data: {
          type: "cav_reliability_restore_v1",
          restoreResult,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "replay") {
      const category = s(parsed.args[2] || "");
      const sessionId = s(parsed.args[3] || "");
      const afterSeqRaw = Number(parsed.args[4]);
      const limitRaw = Number(parsed.args[5]);
      const rows = await listDeterministicReplay(ctx, {
        category: category || null,
        sessionId: sessionId || null,
        afterSeq: Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0,
        limit: Number.isFinite(limitRaw) ? Math.max(1, Math.trunc(limitRaw)) : 200,
      });
      blocks.push(tableFromObjects("Deterministic Replay", rows.map((row) => ({
        category: s(row.category || ""),
        sessionId: s(row.sessionId || ""),
        seq: Number(row.seq || 0),
        action: s(row.action || ""),
        createdAtISO: row.createdAt instanceof Date ? row.createdAt.toISOString() : s(row.createdAt || ""),
      }))));
      blocks.push({
        kind: "json",
        title: "Deterministic Replay",
        data: {
          type: "cav_reliability_replay_v1",
          count: rows.length,
          rows,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "budget") {
      const mode = s(parsed.args[2] || "status").toLowerCase();
      if (mode === "status") {
        const budget = await readReliabilityBudget(ctx);
        const metrics = await reliabilitySloMetrics(ctx, RELIABILITY_EVENT_WINDOW_DAYS);
        const burnUsedPct = Math.max(0, (100 - Number(metrics.availability || 100)) / Math.max(0.001, budget.errorBudgetPct) * 100);
        blocks.push({
          kind: "json",
          title: "Reliability Budget",
          data: {
            type: "cav_reliability_budget_v1",
            budget,
            burnUsedPct,
            metrics,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "set") {
        const patch: Partial<ReliabilityBudgetConfig> = {
          targetAvailability: Number.isFinite(Number(parseNamedFlag(parsed.args.slice(3), "availability")))
            ? Number(parseNamedFlag(parsed.args.slice(3), "availability"))
            : undefined,
          errorBudgetPct: Number.isFinite(Number(parseNamedFlag(parsed.args.slice(3), "error-budget")))
            ? Number(parseNamedFlag(parsed.args.slice(3), "error-budget"))
            : undefined,
          burnAlertPct: Number.isFinite(Number(parseNamedFlag(parsed.args.slice(3), "burn-alert")))
            ? Number(parseNamedFlag(parsed.args.slice(3), "burn-alert"))
            : undefined,
          p95LatencyMs: Number.isFinite(Number(parseNamedFlag(parsed.args.slice(3), "p95")))
            ? Number(parseNamedFlag(parsed.args.slice(3), "p95"))
            : undefined,
        };
        const budget = await upsertReliabilityBudget(ctx, patch);
        await publishCavcodeEvent(ctx, "reliability.budget.set", budget as Record<string, unknown>);
        blocks.push({
          kind: "json",
          title: "Reliability Budget Updated",
          data: {
            type: "cav_reliability_budget_v1",
            budget,
          },
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("RELIABILITY_BUDGET_USAGE", "Usage: cav reliability budget status|set ...", 400);
    }

    if (action === "crash") {
      const mode = s(parsed.args[2] || "list").toLowerCase();
      if (mode === "list") {
        const limitRaw = Number(parsed.args[3]);
        const rows = await listCrashRecords(ctx, Number.isFinite(limitRaw) ? Math.max(1, Math.trunc(limitRaw)) : 80);
        blocks.push(tableFromObjects("Crash Records", rows.map((row) => ({
          id: s(row.id || ""),
          kind: s(row.kind || ""),
          scopeId: s(row.scopeId || ""),
          error: s(row.error || ""),
          createdAtISO: row.createdAt instanceof Date ? row.createdAt.toISOString() : s(row.createdAt || ""),
          resolvedAtISO: row.resolvedAt instanceof Date ? row.resolvedAt.toISOString() : s(row.resolvedAt || ""),
        }))));
        blocks.push({
          kind: "json",
          title: "Crash Records",
          data: {
            type: "cav_reliability_crashes_v1",
            count: rows.length,
            rows,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "record") {
        const kind = s(parsed.args[3] || "");
        const scopeId = s(parsed.args[4] || "manual");
        const errorText = s(parsed.args.slice(5).join(" "));
        if (!kind || !errorText) throw new CavtoolsExecError("RELIABILITY_CRASH_USAGE", "Usage: cav reliability crash record <kind> <scopeId> <error>", 400);
        const crashId = await recordCrashRecord(ctx, {
          kind,
          scopeId,
          error: errorText,
        });
        blocks.push({
          kind: "json",
          title: "Crash Recorded",
          data: {
            type: "cav_reliability_crash_record_v1",
            crashId,
            kind,
            scopeId,
            error: errorText,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "resolve") {
        const crashId = s(parsed.args[3] || "");
        if (!crashId) throw new CavtoolsExecError("RELIABILITY_CRASH_USAGE", "Usage: cav reliability crash resolve <crashId>", 400);
        const resolved = await resolveCrashRecord(ctx, crashId);
        blocks.push({
          kind: "json",
          title: "Crash Resolve",
          data: {
            type: "cav_reliability_crash_resolve_v1",
            crashId,
            resolved,
          },
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("RELIABILITY_CRASH_USAGE", "Usage: cav reliability crash list|record|resolve ...", 400);
    }

    throw new CavtoolsExecError("BAD_RELIABILITY_COMMAND", "Usage: cav reliability status|snapshots|restore|replay|budget|crash ...", 400);
  }

  if (sub === "ui") {
    const domain = s(parsed.args[1] || "palette").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for workbench UI.", 400);
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    if (domain === "palette") {
      const action = s(parsed.args[2] || "list").toLowerCase();
      const paletteState = asRecord((await loadWorkbenchState(ctx, "palette"))?.state) || {};
      const commonCommands = [
        "cav run dev",
        "cav run test",
        "cav project service diagnostics",
        "cav task list",
        "cav debug status",
        "cav git status",
        "cav search semantic auth guard",
        "cav extension list",
        "cav collab session list",
        "cav security status",
        "cav remote session status --all",
        "cav reliability status",
      ];
      if (action === "list") {
        const recent = jsonStringArray(paletteState.recent).slice(0, 80);
        blocks.push(tableFromObjects("Command Palette", commonCommands.map((cmd, index) => ({
          index: index + 1,
          command: cmd,
          recent: recent.includes(cmd),
        }))));
        blocks.push({
          kind: "json",
          title: "Command Palette",
          data: {
            type: "cav_ui_palette_v1",
            commands: commonCommands,
            recent,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "run") {
        const commandRaw = s(parsed.args.slice(3).join(" "));
        if (!commandRaw) throw new CavtoolsExecError("UI_PALETTE_USAGE", "Usage: cav ui palette run <cav ...>", 400);
        const parsedNested = parseCommand(commandRaw);
        if (parsedNested.name !== "cav") {
          throw new CavtoolsExecError("UI_PALETTE_SCOPE", "Palette run only accepts cav commands.", 400);
        }
        const nextRecent = [
          commandRaw,
          ...jsonStringArray(paletteState.recent).filter((item) => item !== commandRaw),
        ].slice(0, 60);
        await saveWorkbenchState(ctx, "palette", {
          ...paletteState,
          recent: nextRecent,
          updatedAtISO: nowISO(),
        });
        await publishCavcodeEvent(ctx, "ui.palette.run", { command: commandRaw });
        const nested = await handleCavCommand(ctx, parsedNested, cwd);
        return nested;
      }
      throw new CavtoolsExecError("UI_PALETTE_USAGE", "Usage: cav ui palette list|run ...", 400);
    }

    if (domain === "shortcut" || domain === "shortcuts") {
      const action = s(parsed.args[2] || "list").toLowerCase();
      const current = asRecord((await loadWorkbenchState(ctx, "shortcuts"))?.state) || {
        bindings: {
          "workbench.action.showCommands": "Cmd/Ctrl+Shift+P",
          "workbench.action.terminal.toggleTerminal": "Ctrl+`",
          "workbench.action.files.save": "Cmd/Ctrl+S",
          "workbench.action.debug.start": "F5",
          "workbench.action.debug.stop": "Shift+F5",
          "workbench.view.explorer": "Cmd/Ctrl+Shift+E",
          "workbench.view.scm": "Cmd/Ctrl+Shift+G",
        },
      };
      if (action === "list") {
        const bindings = asRecord(current.bindings) || {};
        blocks.push(tableFromObjects("Keyboard Shortcuts", Object.entries(bindings).map(([commandId, key]) => ({
          commandId,
          key: String(key || ""),
        }))));
        blocks.push({
          kind: "json",
          title: "Keyboard Shortcuts",
          data: {
            type: "cav_ui_shortcuts_v1",
            bindings,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "set") {
        const commandId = s(parsed.args[3] || "");
        const keyValue = s(parsed.args.slice(4).join(" "));
        if (!commandId || !keyValue) throw new CavtoolsExecError("UI_SHORTCUT_USAGE", "Usage: cav ui shortcut set <commandId> <keys>", 400);
        const bindings = asRecord(current.bindings) || {};
        bindings[commandId] = keyValue;
        await saveWorkbenchState(ctx, "shortcuts", {
          bindings,
          updatedAtISO: nowISO(),
        });
        await publishCavcodeEvent(ctx, "ui.shortcut.set", { commandId, key: keyValue });
        blocks.push({
          kind: "json",
          title: "Shortcut Updated",
          data: {
            type: "cav_ui_shortcuts_v1",
            bindings,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "reset") {
        await saveWorkbenchState(ctx, "shortcuts", {});
        await publishCavcodeEvent(ctx, "ui.shortcut.reset", {});
        blocks.push({
          kind: "json",
          title: "Shortcuts Reset",
          data: {
            type: "cav_ui_shortcuts_reset_v1",
            ok: true,
          },
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("UI_SHORTCUT_USAGE", "Usage: cav ui shortcut list|set|reset ...", 400);
    }

    if (domain === "view" || domain === "views") {
      const action = s(parsed.args[2] || "list").toLowerCase();
      const state = asRecord((await loadWorkbenchState(ctx, "views"))?.state) || {
        explorer: true,
        search: true,
        scm: true,
        run: true,
        debug: true,
        extensions: true,
        problems: true,
        output: true,
      };
      if (action === "list") {
        blocks.push(tableFromObjects("Workbench Views", Object.entries(state).map(([viewId, visible]) => ({
          viewId,
          visible: Boolean(visible),
        }))));
        blocks.push({
          kind: "json",
          title: "Workbench Views",
          data: {
            type: "cav_ui_views_v1",
            views: state,
          },
        });
        return { cwd, blocks, warnings };
      }
      const viewId = s(parsed.args[3] || "").toLowerCase();
      if (!viewId) throw new CavtoolsExecError("UI_VIEW_USAGE", "Usage: cav ui view show|hide|toggle <viewId>", 400);
      const next = { ...state };
      if (action === "show") next[viewId] = true;
      else if (action === "hide") next[viewId] = false;
      else if (action === "toggle") next[viewId] = !Boolean(next[viewId]);
      else throw new CavtoolsExecError("UI_VIEW_USAGE", "Usage: cav ui view list|show|hide|toggle ...", 400);
      await saveWorkbenchState(ctx, "views", next);
      await publishCavcodeEvent(ctx, "ui.view.toggle", { viewId, visible: Boolean(next[viewId]) });
      blocks.push({
        kind: "json",
        title: "Workbench Views Updated",
        data: {
          type: "cav_ui_views_v1",
          views: next,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (domain === "layout") {
      const action = s(parsed.args[2] || "list").toLowerCase();
      if (action === "list") {
        const rows = await listWorkbenchStates(ctx);
        blocks.push(tableFromObjects("Workbench Layout States", rows.map((row) => ({
          stateKey: s(row.stateKey || ""),
          updatedAtISO: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : s(row.updatedAt || ""),
        }))));
        blocks.push({
          kind: "json",
          title: "Workbench Layout States",
          data: {
            type: "cav_ui_layout_list_v1",
            count: rows.length,
            rows,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "save") {
        const name = s(parsed.args[3] || "layout.default");
        const stateFlag = s(parseNamedFlag(parsed.args.slice(4), "state") || "");
        let state: Record<string, unknown> = {
          dock: "bottom",
          panelPinned: true,
          sidebar: "left",
          maximizedEditorGroup: false,
          focusedView: "explorer",
        };
        if (stateFlag) {
          try {
            state = asRecord(JSON.parse(stateFlag)) || state;
          } catch {
            throw new CavtoolsExecError("UI_LAYOUT_STATE_INVALID", "Layout state must be valid JSON.", 400);
          }
        }
        await saveWorkbenchState(ctx, `layout:${name}`, state);
        await publishCavcodeEvent(ctx, "ui.layout.save", { name, state });
        blocks.push({
          kind: "json",
          title: "Workbench Layout Saved",
          data: {
            type: "cav_ui_layout_save_v1",
            name,
            state,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "load") {
        const name = s(parsed.args[3] || "layout.default");
        const row = await loadWorkbenchState(ctx, `layout:${name}`);
        if (!row) throw new CavtoolsExecError("UI_LAYOUT_NOT_FOUND", `Layout state not found: ${name}`, 404);
        await publishCavcodeEvent(ctx, "ui.layout.load", { name });
        blocks.push({
          kind: "json",
          title: "Workbench Layout Loaded",
          data: {
            type: "cav_ui_layout_load_v1",
            name,
            state: asRecord(row.state) || {},
            updatedAtISO: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : s(row.updatedAt || ""),
          },
        });
        return { cwd, blocks, warnings };
      }
      if (action === "apply-default") {
        const state = {
          dock: "bottom",
          panelPinned: true,
          sidebar: "left",
          focusedView: "explorer",
          panelHeightPct: 34,
        };
        await saveWorkbenchState(ctx, "layout:default", state);
        await publishCavcodeEvent(ctx, "ui.layout.applyDefault", state);
        blocks.push({
          kind: "json",
          title: "Workbench Default Layout Applied",
          data: {
            type: "cav_ui_layout_apply_default_v1",
            state,
          },
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("UI_LAYOUT_USAGE", "Usage: cav ui layout list|save|load|apply-default ...", 400);
    }

    throw new CavtoolsExecError("BAD_UI_COMMAND", "Usage: cav ui palette|shortcut|view|layout ...", 400);
  }

  if (sub === "git") {
    const action = s(parsed.args[1] || "status").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for SCM.", 400);
    const needsEdit =
      action === "stage"
      || action === "unstage"
      || action === "commit"
      || action === "checkout"
      || action === "branch"
      || action === "rebase"
      || action === "cherry-pick"
      || action === "pull"
      || action === "push"
      || action === "remote"
      || action === "conflicts"
      || action === "sync";
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: needsEdit ? "EDIT" : "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    const workspace = await ensureScmWorkspace(ctx);
    warnings.push(...workspace.sync.warnings);
    const repoDir = workspace.repoDir;

    const toRepoPath = (pathArg: string, fallback = "."): string => {
      const raw = s(pathArg || "");
      if (!raw) return fallback;
      if (raw === ".") return ".";
      return toWorkspaceRelative(resolvePath(raw, "/cavcode")) || raw;
    };

    const parseGitStatusSnapshot = async () => {
      const result = await runGitCommand({
        cwd: repoDir,
        argv: ["status", "--porcelain=v1", "--branch"],
        allowNonZero: true,
      });
      const lines = String(result.stdout || "")
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean);
      const branchLine = lines.find((line) => line.startsWith("##")) || "";
      const branchInfo = parseGitBranchHeader(branchLine);
      const files = lines
        .filter((line) => !line.startsWith("##") && line.length >= 3)
        .map((line) => {
          const index = line.slice(0, 1);
          const worktree = line.slice(1, 2);
          const status = `${index}${worktree}`;
          const rawPath = s(line.slice(3));
          let pathValue = rawPath;
          let renameFrom: string | null = null;
          if (rawPath.includes(" -> ")) {
            const [fromPath, toPath] = rawPath.split(" -> ");
            renameFrom = s(fromPath || "") || null;
            pathValue = s(toPath || "") || rawPath;
          }
          const untracked = status === "??";
          const ignored = status === "!!";
          const conflicted = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(status) || status.includes("U");
          const staged = !untracked && !ignored && index !== " " && index !== "?";
          const unstaged = !untracked && !ignored && worktree !== " " && worktree !== "?";
          return {
            path: pathValue,
            renameFrom,
            index,
            worktree,
            status,
            staged,
            unstaged,
            untracked,
            ignored,
            conflicted,
          };
        });
      const aheadBehind = await readGitAheadBehindCounts(repoDir);
      const remotes = await readGitRemotes(repoDir);
      const conflicts = await readGitConflictPaths(repoDir);
      return {
        type: "cav_git_status_v2",
        branch: branchInfo.branch,
        detached: branchInfo.detached,
        upstream: branchInfo.upstream,
        ahead: Math.max(branchInfo.ahead, aheadBehind.ahead),
        behind: Math.max(branchInfo.behind, aheadBehind.behind),
        stagedCount: files.filter((file) => file.staged).length,
        unstagedCount: files.filter((file) => file.unstaged).length,
        untrackedCount: files.filter((file) => file.untracked).length,
        conflictedCount: files.filter((file) => file.conflicted).length,
        files,
        remotes,
        conflicts,
        workspaceSync: workspace.sync,
      };
    };

    const stageRange = async (relPath: string, startLine: number, endLine: number, mode: "stage" | "unstage") => {
      const diff = await runGitCommand({
        cwd: repoDir,
        argv: mode === "stage" ? ["diff", "-U0", "--", relPath] : ["diff", "--cached", "-U0", "--", relPath],
        allowNonZero: true,
      });
      const patch = buildGitSelectivePatch(diff.stdout, startLine, endLine);
      if (!patch) {
        return { applied: false, selected: 0 };
      }
      const apply = await runGitCommand({
        cwd: repoDir,
        argv:
          mode === "stage"
            ? ["apply", "--cached", "--unidiff-zero", "--whitespace=nowarn", "-"]
            : ["apply", "--cached", "-R", "--unidiff-zero", "--whitespace=nowarn", "-"],
        stdinText: patch,
        allowNonZero: true,
      });
      if (apply.code !== 0) {
        throw new CavtoolsExecError(
          "GIT_PATCH_APPLY_FAILED",
          s(apply.stderr || apply.stdout) || "Failed to apply selected hunk.",
          400
        );
      }
      return { applied: true, selected: patch.split("\n").filter((line) => line.startsWith("@@ ")).length };
    };

    const readGitBlobText = async (spec: string): Promise<{ exists: boolean; text: string; binary: boolean }> => {
      const result = await runGitCommand({
        cwd: repoDir,
        argv: ["show", spec],
        allowNonZero: true,
      });
      if (result.code !== 0) return { exists: false, text: "", binary: false };
      const text = String(result.stdout || "");
      const binary = text.includes("\u0000");
      return { exists: true, text: binary ? "" : text, binary };
    };

    const readWorkspaceFileText = async (relPath: string): Promise<{ exists: boolean; text: string; binary: boolean }> => {
      const abs = path.join(repoDir, relPath);
      if (!await pathExists(abs)) return { exists: false, text: "", binary: false };
      const buf = await readFile(abs);
      const binary = buf.includes(0);
      return { exists: true, text: binary ? "" : buf.toString("utf8"), binary };
    };

    if (action === "status") {
      const snapshot = await parseGitStatusSnapshot();
      const rows = parseGitPorcelainStatus(
        String(snapshot.files.map((file) => `${file.index}${file.worktree} ${file.path}`).join("\n") || "")
      );
      if (snapshot.branch) {
        rows.unshift({
          type: "branch",
          summary: `${snapshot.branch}${snapshot.upstream ? `...${snapshot.upstream}` : ""}${snapshot.ahead || snapshot.behind ? ` [ahead ${snapshot.ahead}, behind ${snapshot.behind}]` : ""}`,
        });
      }
      blocks.push(tableFromObjects("Git Status", rows));
      if (snapshot.conflicts.length) {
        blocks.push(tableFromObjects("Git Conflicts", snapshot.conflicts.map((pathValue) => ({ path: pathValue }))));
      }
      blocks.push({
        kind: "json",
        title: "Git Status",
        data: snapshot,
      });
      return { cwd, blocks, warnings };
    }

    if (action === "compare") {
      const tokens = parsed.args.slice(2).map((row) => s(row)).filter(Boolean);
      const modeFlag = tokens.find((token) => token.startsWith("--mode=")) || "";
      let mode: "staged" | "unstaged" = "unstaged";
      if (tokens.includes("--staged") || tokens.includes("--cached")) mode = "staged";
      if (tokens.includes("--unstaged")) mode = "unstaged";
      if (modeFlag) {
        const value = s(modeFlag.split("=")[1] || "").toLowerCase();
        mode = value === "staged" ? "staged" : "unstaged";
      }

      const filtered = tokens.filter((token) => !token.startsWith("--"));
      const relPath = filtered[0] ? toRepoPath(filtered[0], "") : "";
      if (!relPath || relPath === ".") {
        throw new CavtoolsExecError("GIT_COMPARE_USAGE", "Usage: cav git compare <path> [--staged|--unstaged]", 400);
      }

      const snapshot = await parseGitStatusSnapshot();
      const target = snapshot.files.find((file) => file.path === relPath || file.renameFrom === relPath) || null;
      const renameFrom = target?.renameFrom || null;
      const indexStatus = s(target?.index || " ");
      const worktreeStatus = s(target?.worktree || " ");
      const status = s(target?.status || `${indexStatus}${worktreeStatus}`.trim());
      const untracked = target?.untracked === true;
      const conflicted = target?.conflicted === true;
      const staged = target?.staged === true;

      const isDeleted = mode === "staged" ? indexStatus === "D" : worktreeStatus === "D";
      const isAdded = mode === "staged" ? indexStatus === "A" : worktreeStatus === "A" || untracked;
      const isRenamed = mode === "staged" ? indexStatus === "R" : worktreeStatus === "R";

      const fromPath = isRenamed && renameFrom ? renameFrom : relPath;

      let left = { exists: false, text: "", binary: false };
      let right = { exists: false, text: "", binary: false };

      if (mode === "staged") {
        if (!isAdded) {
          left = await readGitBlobText(`HEAD:${fromPath}`);
        }
        if (!isDeleted) {
          right = await readGitBlobText(`:${relPath}`);
        }
      } else {
        if (!untracked) {
          left = await readGitBlobText(`:${fromPath}`);
        }
        if (!isDeleted) {
          right = await readWorkspaceFileText(relPath);
        }
      }

      const stats = await runGitCommand({
        cwd: repoDir,
        argv: mode === "staged" ? ["diff", "--cached", "--numstat", "--", relPath] : ["diff", "--numstat", "--", relPath],
        allowNonZero: true,
      });
      let addedLines = 0;
      let removedLines = 0;
      const statLine = String(stats.stdout || "")
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean);
      if (statLine) {
        const [addedRaw, removedRaw] = statLine.split(/\s+/);
        const addedNum = Number(addedRaw);
        const removedNum = Number(removedRaw);
        addedLines = Number.isFinite(addedNum) ? Math.max(0, Math.trunc(addedNum)) : 0;
        removedLines = Number.isFinite(removedNum) ? Math.max(0, Math.trunc(removedNum)) : 0;
      }

      const binary = left.binary || right.binary;
      const leftLabel = mode === "staged" ? (isAdded ? "Empty" : "HEAD") : (untracked ? "Empty" : "Index");
      const rightLabel = mode === "staged" ? (isDeleted ? "Empty" : "Index") : (isDeleted ? "Empty" : "Working Tree");

      blocks.push({
        kind: "json",
        title: "Git Compare",
        data: {
          type: "cav_git_compare_v1",
          mode,
          path: relPath,
          renameFrom,
          status,
          staged,
          untracked,
          conflicted,
          binary,
          leftLabel,
          rightLabel,
          leftContent: binary ? "" : left.text,
          rightContent: binary ? "" : right.text,
          addedLines,
          removedLines,
        },
      });
      blocks.push({
        kind: "json",
        title: "Git Status",
        data: snapshot,
      });
      return { cwd, blocks, warnings };
    }

    if (action === "diff") {
      const tokens = parsed.args.slice(2).map((row) => s(row)).filter(Boolean);
      const staged = tokens.includes("--staged") || tokens.includes("--cached");
      const numstat = tokens.includes("--numstat");
      const nameOnly = tokens.includes("--name-only");
      const filtered = tokens.filter((token) => !token.startsWith("--"));
      const relPath = filtered[0] ? toRepoPath(filtered[0], "") : "";
      const argv = ["diff"];
      if (staged) argv.push("--cached");
      if (numstat) argv.push("--numstat");
      if (nameOnly) argv.push("--name-only");
      if (relPath) argv.push("--", relPath);
      const result = await runGitCommand({ cwd: repoDir, argv, allowNonZero: true });
      const outputText = String(result.stdout || result.stderr || "");
      if (numstat) {
        const rows = outputText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            const [added, removed, file] = line.split(/\s+/);
            return { file: s(file), added: s(added), removed: s(removed) };
          });
        blocks.push(tableFromObjects("Git Diff Stats", rows));
      } else if (nameOnly) {
        const rows = outputText
          .split("\n")
          .map((line) => s(line))
          .filter(Boolean)
          .map((file) => ({ file }));
        blocks.push(tableFromObjects("Git Diff Files", rows));
      }
      blocks.push({
        kind: "text",
        title: relPath ? `Git Diff ${relPath}` : "Git Diff",
        lines: outputText.split("\n"),
      });
      blocks.push({
        kind: "json",
        title: "Git Diff",
        data: {
          type: "cav_git_diff_v1",
          staged,
          numstat,
          nameOnly,
          path: relPath || null,
          output: outputText,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "stage") {
      const mode = s(parsed.args[2] || "").toLowerCase();
      if (mode === "hunk" || mode === "line") {
        const relPath = toRepoPath(s(parsed.args[3] || ""), "");
        if (!relPath) {
          throw new CavtoolsExecError("GIT_STAGE_USAGE", "Usage: cav git stage hunk|line <path> <lineStart> [lineEnd]", 400);
        }
        const lineStart = Number(parsed.args[4]);
        const lineEnd = Number(parsed.args[5]);
        if (!Number.isFinite(lineStart) || lineStart <= 0) {
          throw new CavtoolsExecError("GIT_STAGE_USAGE", "Line start must be a positive integer.", 400);
        }
        const start = Math.max(1, Math.trunc(lineStart));
        const end = Number.isFinite(lineEnd) && lineEnd >= start ? Math.trunc(lineEnd) : start;
        const staged = await stageRange(relPath, start, end, "stage");
        await publishCavcodeEvent(ctx, "scm.stage.partial", {
          path: relPath,
          lineStart: start,
          lineEnd: end,
          selectedHunks: staged.selected,
        });
        blocks.push({
          kind: "text",
          lines: [staged.applied ? `Staged ${relPath} lines ${start}-${end}.` : `No matching diff hunks for ${relPath}:${start}-${end}.`],
        });
      } else {
        const pathArg = s(parsed.args[2] || ".");
        const relPath = toRepoPath(pathArg, ".");
        const argv = relPath === "." ? ["add", "-A"] : ["add", "--", relPath];
        await runGitCommand({ cwd: repoDir, argv });
        await publishCavcodeEvent(ctx, "scm.stage", { path: relPath });
        blocks.push({ kind: "text", lines: [`Staged ${relPath}.`] });
      }
      blocks.push({
        kind: "json",
        title: "Git Status",
        data: await parseGitStatusSnapshot(),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "unstage") {
      const mode = s(parsed.args[2] || "").toLowerCase();
      if (mode === "hunk" || mode === "line") {
        const relPath = toRepoPath(s(parsed.args[3] || ""), "");
        if (!relPath) {
          throw new CavtoolsExecError("GIT_UNSTAGE_USAGE", "Usage: cav git unstage hunk|line <path> <lineStart> [lineEnd]", 400);
        }
        const lineStart = Number(parsed.args[4]);
        const lineEnd = Number(parsed.args[5]);
        if (!Number.isFinite(lineStart) || lineStart <= 0) {
          throw new CavtoolsExecError("GIT_UNSTAGE_USAGE", "Line start must be a positive integer.", 400);
        }
        const start = Math.max(1, Math.trunc(lineStart));
        const end = Number.isFinite(lineEnd) && lineEnd >= start ? Math.trunc(lineEnd) : start;
        const unstaged = await stageRange(relPath, start, end, "unstage");
        await publishCavcodeEvent(ctx, "scm.unstage.partial", {
          path: relPath,
          lineStart: start,
          lineEnd: end,
          selectedHunks: unstaged.selected,
        });
        blocks.push({
          kind: "text",
          lines: [unstaged.applied ? `Unstaged ${relPath} lines ${start}-${end}.` : `No matching staged hunks for ${relPath}:${start}-${end}.`],
        });
      } else {
        const pathArg = s(parsed.args[2] || ".");
        const relPath = toRepoPath(pathArg, ".");
        if (relPath === ".") {
          await runGitCommand({ cwd: repoDir, argv: ["reset", "HEAD", "--", "."], allowNonZero: true });
        } else {
          await runGitCommand({ cwd: repoDir, argv: ["restore", "--staged", "--", relPath], allowNonZero: true });
        }
        await publishCavcodeEvent(ctx, "scm.unstage", { path: relPath });
        blocks.push({ kind: "text", lines: [`Unstaged ${relPath}.`] });
      }
      blocks.push({
        kind: "json",
        title: "Git Status",
        data: await parseGitStatusSnapshot(),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "commit") {
      const amend = s(parsed.args[2] || "").toLowerCase() === "--amend";
      const message = amend ? s(parsed.args.slice(3).join(" ")) : s(parsed.args.slice(2).join(" "));
      if (!amend && !message) throw new CavtoolsExecError("GIT_COMMIT_MESSAGE_REQUIRED", "Usage: cav git commit <message>", 400);
      const commitArgv = amend
        ? ["commit", "--amend", ...(message ? ["-m", message] : ["--no-edit"]), "--no-gpg-sign"]
        : ["commit", "-m", message, "--no-gpg-sign"];
      const committed = await runGitCommand({ cwd: repoDir, argv: commitArgv, allowNonZero: true });
      if (committed.code !== 0) {
        const text = s(committed.stderr || committed.stdout);
        if (text.toLowerCase().includes("nothing to commit")) {
          blocks.push({ kind: "text", lines: ["No staged changes to commit."] });
          return { cwd, blocks, warnings };
        }
        throw new CavtoolsExecError("GIT_COMMIT_FAILED", text || "Commit failed.", 400);
      }
      const head = await runGitCommand({ cwd: repoDir, argv: ["log", "--oneline", "-n", "1"], allowNonZero: true });
      await publishCavcodeEvent(ctx, amend ? "scm.commit.amend" : "scm.commit", {
        message: message || null,
        head: s(head.stdout.split("\n")[0] || ""),
      });
      blocks.push({
        kind: "text",
        title: amend ? "Commit Amended" : "Commit Created",
        lines: String(committed.stdout || head.stdout || "").split("\n"),
      });
      blocks.push({
        kind: "json",
        title: "Git Status",
        data: await parseGitStatusSnapshot(),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "log") {
      const countRaw = Number(parsed.args[2]);
      const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(80, Math.trunc(countRaw))) : 20;
      const result = await runGitCommand({
        cwd: repoDir,
        argv: ["log", "--date=iso", `-n`, String(count), "--pretty=format:%h|%ad|%an|%s"],
        allowNonZero: true,
      });
      const rows = String(result.stdout || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [hash, date, author, subject] = line.split("|");
          return { hash: s(hash), date: s(date), author: s(author), subject: s(subject) };
        });
      blocks.push(tableFromObjects("Git Log", rows));
      return { cwd, blocks, warnings };
    }

    if (action === "branch") {
      const mode = s(parsed.args[2] || "list").toLowerCase();
      if (mode === "list") {
        const branches = await runGitCommand({ cwd: repoDir, argv: ["branch", "--all", "--verbose"], allowNonZero: true });
        blocks.push({
          kind: "text",
          title: "Branches",
          lines: String(branches.stdout || branches.stderr || "").split("\n"),
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "create") {
        const name = s(parsed.args[3]);
        if (!name) throw new CavtoolsExecError("GIT_BRANCH_NAME_REQUIRED", "Usage: cav git branch create <name>", 400);
        await runGitCommand({ cwd: repoDir, argv: ["branch", name] });
        await publishCavcodeEvent(ctx, "scm.branch.create", { name });
        blocks.push({ kind: "text", lines: [`Branch created: ${name}`] });
        return { cwd, blocks, warnings };
      }
      if (mode === "delete") {
        const name = s(parsed.args[3]);
        if (!name) throw new CavtoolsExecError("GIT_BRANCH_NAME_REQUIRED", "Usage: cav git branch delete <name>", 400);
        await runGitCommand({ cwd: repoDir, argv: ["branch", "-D", name] });
        await publishCavcodeEvent(ctx, "scm.branch.delete", { name });
        blocks.push({ kind: "text", lines: [`Branch deleted: ${name}`] });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("GIT_BRANCH_USAGE", "Usage: cav git branch list|create|delete <name>", 400);
    }

    if (action === "checkout") {
      const name = s(parsed.args[2]);
      if (!name) throw new CavtoolsExecError("GIT_CHECKOUT_BRANCH_REQUIRED", "Usage: cav git checkout <branch>", 400);
      await runGitCommand({ cwd: repoDir, argv: ["checkout", name] });
      await publishCavcodeEvent(ctx, "scm.checkout", { branch: name });
      blocks.push({ kind: "text", lines: [`Checked out ${name}.`] });
      return { cwd, blocks, warnings };
    }

    if (action === "rebase") {
      const mode = s(parsed.args[2] || "");
      if (!mode) throw new CavtoolsExecError("GIT_REBASE_USAGE", "Usage: cav git rebase <base>|--continue|--abort|--skip|--quit", 400);
      const argv =
        mode === "--continue" || mode === "--abort" || mode === "--skip" || mode === "--quit"
          ? ["rebase", mode]
          : ["rebase", mode];
      const result = await runGitCommand({ cwd: repoDir, argv, allowNonZero: true });
      if (result.code !== 0) {
        throw new CavtoolsExecError("GIT_REBASE_FAILED", s(result.stderr || result.stdout) || "Rebase failed.", 400);
      }
      await publishCavcodeEvent(ctx, "scm.rebase", { mode });
      blocks.push({ kind: "text", title: "Rebase", lines: String(result.stdout || result.stderr || "").split("\n") });
      blocks.push({
        kind: "json",
        title: "Git Status",
        data: await parseGitStatusSnapshot(),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "cherry-pick") {
      const ref = s(parsed.args[2] || "");
      if (!ref) throw new CavtoolsExecError("GIT_CHERRYPICK_USAGE", "Usage: cav git cherry-pick <ref>|--continue|--abort|--quit", 400);
      const argv =
        ref === "--continue" || ref === "--abort" || ref === "--quit"
          ? ["cherry-pick", ref]
          : ["cherry-pick", ref];
      const result = await runGitCommand({ cwd: repoDir, argv, allowNonZero: true });
      if (result.code !== 0) {
        throw new CavtoolsExecError("GIT_CHERRYPICK_FAILED", s(result.stderr || result.stdout) || "Cherry-pick failed.", 400);
      }
      await publishCavcodeEvent(ctx, "scm.cherry_pick", { ref });
      blocks.push({ kind: "text", title: "Cherry-pick", lines: String(result.stdout || result.stderr || "").split("\n") });
      blocks.push({
        kind: "json",
        title: "Git Status",
        data: await parseGitStatusSnapshot(),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "remote") {
      const mode = s(parsed.args[2] || "list").toLowerCase();
      if (mode === "list") {
        const remotes = await readGitRemotes(repoDir);
        blocks.push(tableFromObjects("Git Remotes", remotes.map((remote) => ({
          name: remote.name,
          fetch: remote.fetch,
          push: remote.push,
        }))));
        blocks.push({
          kind: "json",
          title: "Git Remotes",
          data: {
            type: "cav_git_remotes_v1",
            remotes,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "add") {
        const name = s(parsed.args[3] || "");
        const url = s(parsed.args[4] || "");
        if (!name || !url) throw new CavtoolsExecError("GIT_REMOTE_USAGE", "Usage: cav git remote add <name> <url>", 400);
        await runGitCommand({ cwd: repoDir, argv: ["remote", "add", name, url] });
        await publishCavcodeEvent(ctx, "scm.remote.add", { name, url });
        blocks.push({ kind: "text", lines: [`Remote added: ${name}`] });
        return { cwd, blocks, warnings };
      }
      if (mode === "remove" || mode === "rm" || mode === "delete") {
        const name = s(parsed.args[3] || "");
        if (!name) throw new CavtoolsExecError("GIT_REMOTE_USAGE", "Usage: cav git remote remove <name>", 400);
        await runGitCommand({ cwd: repoDir, argv: ["remote", "remove", name] });
        await publishCavcodeEvent(ctx, "scm.remote.remove", { name });
        blocks.push({ kind: "text", lines: [`Remote removed: ${name}`] });
        return { cwd, blocks, warnings };
      }
      if (mode === "set-url") {
        const name = s(parsed.args[3] || "");
        const url = s(parsed.args[4] || "");
        if (!name || !url) throw new CavtoolsExecError("GIT_REMOTE_USAGE", "Usage: cav git remote set-url <name> <url>", 400);
        await runGitCommand({ cwd: repoDir, argv: ["remote", "set-url", name, url] });
        await publishCavcodeEvent(ctx, "scm.remote.set_url", { name, url });
        blocks.push({ kind: "text", lines: [`Remote URL updated: ${name}`] });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("GIT_REMOTE_USAGE", "Usage: cav git remote list|add|remove|set-url ...", 400);
    }

    if (action === "fetch" || action === "pull" || action === "push" || action === "sync") {
      const remote = s(parsed.args[2] || "");
      const branch = s(parsed.args[3] || "");
      const setUpstream = parsed.args.some((arg) => s(arg).toLowerCase() === "--set-upstream" || s(arg).toLowerCase() === "-u");
      const runSyncCommand = async (kind: "fetch" | "pull" | "push") => {
        const argv: string[] = [kind];
        if (kind === "push" && setUpstream) argv.push("--set-upstream");
        if (remote) argv.push(remote);
        if (branch) argv.push(branch);
        const result = await runGitCommand({ cwd: repoDir, argv, allowNonZero: true });
        return { argv, result };
      };
      const runAndHandle = async (kind: "fetch" | "pull" | "push") => {
        const { argv, result } = await runSyncCommand(kind);
        const text = s(result.stderr || result.stdout);
        if (result.code !== 0) {
          if (isGitAuthFailure(text)) {
            blocks.push({
              kind: "json",
              title: "Git Auth Required",
              data: {
                type: "cav_git_auth_required_v1",
                command: `git ${argv.join(" ")}`,
                message: text || "Authentication is required for this remote operation.",
              },
            });
            return false;
          }
          throw new CavtoolsExecError("GIT_SYNC_FAILED", text || `git ${argv.join(" ")} failed.`, 400);
        }
        blocks.push({
          kind: "text",
          title: `Git ${kind}`,
          lines: String(result.stdout || result.stderr || "").split("\n"),
        });
        await publishCavcodeEvent(ctx, `scm.${kind}`, { remote: remote || null, branch: branch || null });
        return true;
      };
      if (action === "sync") {
        const pulled = await runAndHandle("pull");
        if (pulled) await runAndHandle("push");
      } else {
        await runAndHandle(action as "fetch" | "pull" | "push");
      }
      blocks.push({
        kind: "json",
        title: "Git Status",
        data: await parseGitStatusSnapshot(),
      });
      return { cwd, blocks, warnings };
    }

    if (action === "ahead-behind") {
      const counts = await readGitAheadBehindCounts(repoDir);
      blocks.push({
        kind: "json",
        title: "Git Ahead/Behind",
        data: {
          type: "cav_git_ahead_behind_v1",
          ahead: counts.ahead,
          behind: counts.behind,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "conflicts") {
      const mode = s(parsed.args[2] || "list").toLowerCase();
      if (mode === "list") {
        const conflicts = await readGitConflictPaths(repoDir);
        blocks.push(tableFromObjects("Git Conflicts", conflicts.map((pathValue) => ({ path: pathValue }))));
        blocks.push({
          kind: "json",
          title: "Git Conflicts",
          data: {
            type: "cav_git_conflicts_v1",
            conflicts,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "show") {
        const relPath = toRepoPath(s(parsed.args[3] || ""), "");
        if (!relPath) throw new CavtoolsExecError("GIT_CONFLICT_USAGE", "Usage: cav git conflicts show <path>", 400);
        const abs = path.join(repoDir, relPath);
        if (!await pathExists(abs)) throw new CavtoolsExecError("GIT_CONFLICT_FILE_NOT_FOUND", `File not found: ${relPath}`, 404);
        const content = await readFile(abs, "utf8");
        blocks.push({
          kind: "text",
          title: `Conflict File: ${relPath}`,
          lines: String(content || "").split("\n"),
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "resolve") {
        const relPath = toRepoPath(s(parsed.args[3] || ""), "");
        const strategy = s(parsed.args[4] || "ours").toLowerCase();
        if (!relPath) throw new CavtoolsExecError("GIT_CONFLICT_USAGE", "Usage: cav git conflicts resolve <path> <ours|theirs|both>", 400);
        if (strategy !== "ours" && strategy !== "theirs" && strategy !== "both") {
          throw new CavtoolsExecError("GIT_CONFLICT_USAGE", "Strategy must be one of: ours|theirs|both.", 400);
        }
        if (strategy === "ours" || strategy === "theirs") {
          await runGitCommand({
            cwd: repoDir,
            argv: ["checkout", strategy === "ours" ? "--ours" : "--theirs", "--", relPath],
            allowNonZero: true,
          });
        } else {
          const abs = path.join(repoDir, relPath);
          if (!await pathExists(abs)) throw new CavtoolsExecError("GIT_CONFLICT_FILE_NOT_FOUND", `File not found: ${relPath}`, 404);
          const content = await readFile(abs, "utf8");
          const merged = resolveGitConflictMarkersKeepBoth(content);
          await writeFile(abs, merged, "utf8");
        }
        await runGitCommand({ cwd: repoDir, argv: ["add", "--", relPath], allowNonZero: true });
        await publishCavcodeEvent(ctx, "scm.conflict.resolve", { path: relPath, strategy });
        blocks.push({ kind: "text", lines: [`Resolved conflict for ${relPath} using ${strategy}.`] });
        blocks.push({
          kind: "json",
          title: "Git Status",
          data: await parseGitStatusSnapshot(),
        });
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("GIT_CONFLICT_USAGE", "Usage: cav git conflicts list|show|resolve ...", 400);
    }

    throw new CavtoolsExecError(
      "BAD_GIT_COMMAND",
      "Usage: cav git status|compare|diff|stage|unstage|commit|log|branch|checkout|remote|fetch|pull|push|sync|ahead-behind|rebase|cherry-pick|conflicts",
      400
    );
  }

  if (sub === "index") {
    const action = s(parsed.args[1] || "symbols").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for indexing.", 400);
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    const ensureSnapshot = async () => {
      let row = await readIndexerSnapshot({ accountId: ctx.accountId, projectId: ctx.project!.id });
      if (row) return row;
      const workspace = await ensureScmWorkspace(ctx);
      warnings.push(...workspace.sync.warnings);
      const snapshot = await buildIndexerSnapshotFromWorkspaceDir(workspace.repoDir, {
        accountId: ctx.accountId,
        projectId: ctx.project!.id,
      });
      const hash = await persistIndexerSnapshot({
        accountId: ctx.accountId,
        projectId: ctx.project!.id,
        snapshot,
      });
      await publishCavcodeEvent(ctx, "index.refresh", {
        hash,
        filesIndexed: snapshot.filesIndexed,
        symbols: snapshot.symbols.length,
      });
      row = { hash, snapshot };
      return row;
    };

    if (action === "refresh") {
      const workspace = await ensureScmWorkspace(ctx);
      warnings.push(...workspace.sync.warnings);
      const snapshot = await buildIndexerSnapshotFromWorkspaceDir(workspace.repoDir, {
        accountId: ctx.accountId,
        projectId: ctx.project.id,
      });
      const hash = await persistIndexerSnapshot({
        accountId: ctx.accountId,
        projectId: ctx.project.id,
        snapshot,
      });
      await publishCavcodeEvent(ctx, "index.refresh", {
        hash,
        filesIndexed: snapshot.filesIndexed,
        symbols: snapshot.symbols.length,
        references: snapshot.references.length,
        calls: snapshot.calls.length,
      });
      blocks.push({
        kind: "json",
        title: "Indexer Refreshed",
        data: {
          hash,
          generatedAtISO: snapshot.generatedAtISO,
          fileCount: snapshot.fileCount,
          filesIndexed: snapshot.filesIndexed,
          bytesIndexed: snapshot.bytesIndexed,
          symbolCount: snapshot.symbols.length,
          referenceCount: snapshot.references.length,
          callCount: snapshot.calls.length,
          dependencyEdges: snapshot.dependencies.length,
          incremental: snapshot.incremental || null,
          shards: snapshot.shards || [],
        },
      });
      return { cwd, blocks, warnings };
    }

    const row = await ensureSnapshot();
    const snapshot = row.snapshot;

    if (action === "symbols") {
      const query = s(parsed.args[2] || "").toLowerCase();
      const filtered = snapshot.symbols
        .filter((sym) => !query || sym.name.toLowerCase().includes(query) || sym.file.toLowerCase().includes(query))
        .slice(0, CAVCODE_INDEX_RESULT_LIMIT)
        .map((sym) => ({
          name: sym.name,
          kind: sym.kind,
          file: sym.file,
          line: sym.line,
          col: sym.col,
          exported: sym.exported,
        }));
      blocks.push(tableFromObjects(`Indexer Symbols${query ? `: ${query}` : ""}`, filtered));
      blocks.push({
        kind: "json",
        title: "Indexer Snapshot",
        data: {
          hash: row.hash,
          generatedAtISO: snapshot.generatedAtISO,
          symbols: snapshot.symbols.length,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "refs") {
      const query = s(parsed.args[2]);
      if (!query) throw new CavtoolsExecError("INDEX_SYMBOL_REQUIRED", "Usage: cav index refs <symbol>", 400);
      const rows = snapshot.references
        .filter((ref) => ref.name.toLowerCase() === query.toLowerCase() || ref.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, CAVCODE_INDEX_RESULT_LIMIT)
        .map((ref) => ({
          name: ref.name,
          file: ref.file,
          line: ref.line,
          col: ref.col,
          context: ref.context,
        }));
      blocks.push(tableFromObjects(`References: ${query}`, rows));
      return { cwd, blocks, warnings };
    }

    if (action === "calls") {
      const query = s(parsed.args[2]);
      if (!query) throw new CavtoolsExecError("INDEX_SYMBOL_REQUIRED", "Usage: cav index calls <symbol>", 400);
      const rows = snapshot.calls
        .filter((call) => call.callee.toLowerCase() === query.toLowerCase() || call.callee.toLowerCase().includes(query.toLowerCase()))
        .slice(0, CAVCODE_INDEX_RESULT_LIMIT)
        .map((call) => ({
          callee: call.callee,
          file: call.file,
          line: call.line,
          col: call.col,
        }));
      blocks.push(tableFromObjects(`Calls: ${query}`, rows));
      return { cwd, blocks, warnings };
    }

    if (action === "graph") {
      const filter = s(parsed.args[2] || "").toLowerCase();
      const rows = snapshot.dependencies
        .filter((edge) => !filter || edge.from.toLowerCase().includes(filter) || edge.to.toLowerCase().includes(filter))
        .slice(0, CAVCODE_INDEX_RESULT_LIMIT)
        .map((edge) => ({
          from: edge.from,
          to: edge.to,
        }));
      blocks.push(tableFromObjects("Dependency Graph", rows));
      return { cwd, blocks, warnings };
    }

    if (action === "xref") {
      const query = s(parsed.args[2] || "");
      if (!query) throw new CavtoolsExecError("INDEX_SYMBOL_REQUIRED", "Usage: cav index xref <symbol>", 400);
      const lowered = query.toLowerCase();
      const defs = snapshot.symbols
        .filter((sym) => sym.name.toLowerCase() === lowered || sym.name.toLowerCase().includes(lowered))
        .slice(0, CAVCODE_INDEX_RESULT_LIMIT);
      const refs = snapshot.references
        .filter((ref) => ref.name.toLowerCase() === lowered || ref.name.toLowerCase().includes(lowered))
        .slice(0, CAVCODE_INDEX_RESULT_LIMIT);
      const calls = snapshot.calls
        .filter((call) => call.callee.toLowerCase() === lowered || call.callee.toLowerCase().includes(lowered))
        .slice(0, CAVCODE_INDEX_RESULT_LIMIT);
      blocks.push(tableFromObjects(`Xref Definitions: ${query}`, defs.map((rowInner) => ({
        name: rowInner.name,
        kind: rowInner.kind,
        file: rowInner.file,
        line: rowInner.line,
        col: rowInner.col,
      }))));
      blocks.push(tableFromObjects(`Xref References: ${query}`, refs.map((rowInner) => ({
        name: rowInner.name,
        file: rowInner.file,
        line: rowInner.line,
        col: rowInner.col,
        context: rowInner.context,
      }))));
      blocks.push({
        kind: "json",
        title: "Xref Summary",
        data: {
          type: "cav_index_xref_v1",
          query,
          definitions: defs.length,
          references: refs.length,
          calls: calls.length,
        },
      });
      return { cwd, blocks, warnings };
    }

    if (action === "semantic") {
      const query = s(parsed.args.slice(2).join(" "));
      if (!query) throw new CavtoolsExecError("INDEX_SYMBOL_REQUIRED", "Usage: cav index semantic <query>", 400);
      const maxRaw = Number(parseNamedFlag(parsed.args.slice(2), "max"));
      const max = Number.isFinite(maxRaw) ? Math.max(1, Math.min(500, Math.trunc(maxRaw))) : 120;
      const tokens = semanticTokens(query);
      const scored = snapshot.symbols
        .map((sym) => ({
          score: semanticScore(tokens, `${sym.name} ${sym.kind} ${sym.file}`),
          sym,
        }))
        .filter((rowInner) => rowInner.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, max);
      blocks.push(tableFromObjects(`Indexer Semantic: ${query}`, scored.map((rowInner) => ({
        score: rowInner.score,
        name: rowInner.sym.name,
        kind: rowInner.sym.kind,
        file: rowInner.sym.file,
        line: rowInner.sym.line,
        col: rowInner.sym.col,
      }))));
      blocks.push({
        kind: "json",
        title: "Indexer Semantic",
        data: {
          type: "cav_index_semantic_v1",
          query,
          hash: row.hash,
          resultCount: scored.length,
          shardCount: (snapshot.shards || []).length,
        },
      });
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_INDEX_COMMAND", "Usage: cav index refresh|symbols|refs|calls|graph|xref|semantic", 400);
  }

  if (sub === "template") {
    const action = s(parsed.args[1] || "list").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for templates.", 400);
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    if (action === "list") {
      blocks.push(tableFromObjects("Template Catalog", CAVCODE_TEMPLATES.map((tpl) => ({
        id: tpl.id,
        label: tpl.label,
        files: tpl.files.length,
      }))));
      return { cwd, blocks, warnings };
    }

    if (action === "init") {
      const templateId = s(parsed.args[2]);
      const template = pickTemplateById(templateId);
      if (!template) throw new CavtoolsExecError("TEMPLATE_NOT_FOUND", "Usage: cav template init <website|software|game> [folder]", 400);
      const folder = s(parsed.args[3] || template.id).replace(/^\/+/, "").replace(/\/+$/, "");
      if (!folder || folder.includes("..")) throw new CavtoolsExecError("TEMPLATE_FOLDER_INVALID", "Template folder is invalid.", 400);
      const writes: Array<{ path: string; mimeType: string; bytes: number }> = [];
      for (const file of template.files) {
        const target = normalizePath(`/cavcode/${folder}/${file.relPath.replace(/^\/+/, "")}`);
        const saved = await writeCavcodeText(ctx, target, file.content, file.mimeType, null);
        writes.push({
          path: saved.path,
          mimeType: saved.mimeType,
          bytes: Buffer.byteLength(file.content, "utf8"),
        });
      }
      await publishCavcodeEvent(ctx, "template.init", {
        templateId: template.id,
        folder,
        fileCount: writes.length,
      });
      blocks.push(tableFromObjects(`Template Initialized: ${template.label}`, writes));
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_TEMPLATE_COMMAND", "Usage: cav template list|init <website|software|game> [folder]", 400);
  }

  if (sub === "loop") {
    const action = s(parsed.args[1] || "plan").toLowerCase();
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for loop.", 400);
    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: "EDIT",
      errorCode: "UNAUTHORIZED",
    });

    if (action === "plan") {
      const goal = s(parsed.args.slice(2).join(" "));
      if (!goal) throw new CavtoolsExecError("LOOP_GOAL_REQUIRED", "Usage: cav loop plan <goal>", 400);
      const baseline = await runCavcodeWorkspaceDiagnostics(ctx);
      const result = {
        goal,
        generatedAtISO: nowISO(),
        baseline: baseline.summary,
        steps: [
          "Collect context from diagnostics, index, and affected files.",
          "Apply one scoped deterministic change set.",
          "Re-run diagnostics and compare deltas.",
          "Run test/build command when scripts exist.",
          "Commit only if quality gates improve.",
        ],
      };
      await ensureCavcodeInfraTables();
      await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "CavCodeAiLoopRun" (
            "id",
            "accountId",
            "projectId",
            "userId",
            "goal",
            "result"
          ) VALUES (
            ${`loop_${crypto.randomUUID()}`},
            ${ctx.accountId},
            ${ctx.project.id},
            ${ctx.userId},
            ${goal},
            CAST(${JSON.stringify(result)} AS jsonb)
          )
        `
      );
      await publishCavcodeEvent(ctx, "loop.plan", {
        goal,
        errors: baseline.summary.errors,
        warnings: baseline.summary.warnings,
      });
      await recordDeterministicReplay(ctx, {
        category: "ai",
        sessionId: `plan:${hashCommandId(goal, "/cavcode")}`,
        action: "loop.plan",
        payload: result as Record<string, unknown>,
      }).catch(() => {});
      blocks.push({ kind: "json", title: "Deterministic Loop Plan", data: result });
      return { cwd, blocks, warnings };
    }

    if (action === "replace") {
      const fileArg = s(parsed.args[2]);
      const searchValue = String(parsed.args[3] || "");
      const replaceValue = String(parsed.args[4] || "");
      if (!fileArg || !searchValue) {
        throw new CavtoolsExecError("LOOP_REPLACE_USAGE", "Usage: cav loop replace <file> <search> <replace>", 400);
      }
      const target = resolvePath(fileArg, cwd);
      if (!target.startsWith("/cavcode/")) {
        throw new CavtoolsExecError("LOOP_REPLACE_SCOPE", "loop replace only supports /cavcode paths.", 400);
      }
      const before = await runCavcodeWorkspaceDiagnostics(ctx);
      const file = await readFileText(ctx, target);
      const prior = String(file.content || "");
      if (!prior.includes(searchValue)) {
        throw new CavtoolsExecError("LOOP_SEARCH_NOT_FOUND", "Search text was not found in target file.", 400);
      }
      const next = prior.split(searchValue).join(replaceValue);
      const write = await writeFileText(ctx, target, next, file.mimeType, file.sha256 || null);
      const after = await runCavcodeWorkspaceDiagnostics(ctx);
      const result = {
        action: "replace",
        file: target,
        replacedAll: true,
        before: before.summary,
        after: after.summary,
        delta: {
          errors: after.summary.errors - before.summary.errors,
          warnings: after.summary.warnings - before.summary.warnings,
          total: after.summary.total - before.summary.total,
        },
        write,
      };
      await ensureCavcodeInfraTables();
      await prisma.$executeRaw(
        Prisma.sql`
          INSERT INTO "CavCodeAiLoopRun" (
            "id",
            "accountId",
            "projectId",
            "userId",
            "goal",
            "result"
          ) VALUES (
            ${`loop_${crypto.randomUUID()}`},
            ${ctx.accountId},
            ${ctx.project.id},
            ${ctx.userId},
            ${`replace:${target}`},
            CAST(${JSON.stringify(result)} AS jsonb)
          )
        `
      );
      await publishCavcodeEvent(ctx, "loop.replace", {
        file: target,
        beforeErrors: before.summary.errors,
        afterErrors: after.summary.errors,
      });
      await recordDeterministicReplay(ctx, {
        category: "ai",
        sessionId: `replace:${target}`,
        action: "loop.replace",
        payload: result as Record<string, unknown>,
      }).catch(() => {});
      blocks.push({ kind: "json", title: "Deterministic Loop Replace", data: result });
      return { cwd, blocks, warnings };
    }

    if (action === "checkpoint") {
      const mode = s(parsed.args[2] || "list").toLowerCase();
      if (mode === "create") {
        const label = s(parsed.args.slice(3).join(" "));
        const checkpoint = await captureAiCheckpoint(ctx, label || `manual-${nowISO()}`);
        blocks.push({
          kind: "json",
          title: "AI Checkpoint Created",
          data: {
            type: "cav_loop_checkpoint_create_v1",
            checkpoint,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "list") {
        const limitRaw = Number(parsed.args[3]);
        const rows = await listAiCheckpoints(ctx, Number.isFinite(limitRaw) ? Math.max(1, Math.trunc(limitRaw)) : 40);
        blocks.push(tableFromObjects("AI Checkpoints", rows.map((row) => ({
          id: s(row.id || ""),
          label: s(row.label || ""),
          fileCount: Number(row.fileCount || 0),
          byteCount: Number(row.byteCount || 0),
          createdAtISO: row.createdAt instanceof Date ? row.createdAt.toISOString() : s(row.createdAt || ""),
        }))));
        blocks.push({
          kind: "json",
          title: "AI Checkpoints",
          data: {
            type: "cav_loop_checkpoints_v1",
            count: rows.length,
            rows,
          },
        });
        return { cwd, blocks, warnings };
      }
      if (mode === "restore") {
        const checkpointId = s(parsed.args[3] || "");
        if (!checkpointId) throw new CavtoolsExecError("LOOP_CHECKPOINT_USAGE", "Usage: cav loop checkpoint restore <checkpointId>", 400);
        const restored = await restoreAiCheckpoint(ctx, checkpointId);
        blocks.push({
          kind: "json",
          title: "AI Checkpoint Restored",
          data: {
            type: "cav_loop_checkpoint_restore_v1",
            checkpointId,
            restored,
          },
        });
        if (restored.warnings.length) warnings.push(...restored.warnings.slice(0, 12));
        return { cwd, blocks, warnings };
      }
      throw new CavtoolsExecError("LOOP_CHECKPOINT_USAGE", "Usage: cav loop checkpoint create|list|restore ...", 400);
    }

    if (action === "run" || action === "execute") {
      const goal = s(parsed.args.slice(2).join(" "));
      if (!goal) throw new CavtoolsExecError("LOOP_GOAL_REQUIRED", "Usage: cav loop run <goal> [--cycles <n>] [--test-task <label>] [--rollback]", 400);
      const cyclesRaw = Number(parseNamedFlag(parsed.args.slice(2), "cycles"));
      const testTaskLabel = s(parseNamedFlag(parsed.args.slice(2), "test-task") || "") || null;
      const rollbackOnFail = parsed.args.some((token) => s(token).toLowerCase() === "--rollback");
      const result = await runDeterministicAiRepairLoop(ctx, {
        goal,
        maxCycles: Number.isFinite(cyclesRaw) ? Math.max(1, Math.trunc(cyclesRaw)) : 3,
        testTaskLabel,
        rollbackOnFail,
      });
      blocks.push({
        kind: "json",
        title: "Deterministic Loop Run",
        data: result,
      });
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_LOOP_COMMAND", "Usage: cav loop plan|replace|checkpoint|run ...", 400);
  }

  if (sub === "cloud") {
    const action = s(parsed.args[1] || "").toLowerCase();
    if (action === "share") {
      const pathArg = resolvePath(parsed.args[2], cwd);
      const days = Number(parsed.args[3]);
      const share = await cavCloudShareByPath(ctx, pathArg, Number.isFinite(days) ? days : 7);
      blocks.push({ kind: "json", title: "CavCloud Share Created", data: share });
      blocks.push({ kind: "open", title: "Share URL", url: share.shareUrl, label: "Open share" });
      return { cwd, blocks, warnings };
    }

    if (action === "publish") {
      const pathArg = resolvePath(parsed.args[2], cwd);
      const artifact = await cavCloudPublishByPath(ctx, pathArg);
      blocks.push({ kind: "json", title: "CavCloud Artifact Published", data: artifact });
      blocks.push({ kind: "open", title: "Public Artifact", url: artifact.artifactUrl, label: "Open artifact" });
      return { cwd, blocks, warnings };
    }

    if (action === "unpublish") {
      const pathArg = resolvePath(parsed.args[2], cwd);
      const artifact = await cavCloudUnpublishByPath(ctx, pathArg);
      blocks.push({ kind: "json", title: "CavCloud Artifact Unpublished", data: artifact });
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_CLOUD_COMMAND", "Usage: cav cloud share|publish|unpublish <path>", 400);
  }

  if (sub === "safe") {
    const action = s(parsed.args[1] || "").toLowerCase();

    if (action === "invite") {
      const pathArg = resolvePath(parsed.args[2], cwd);
      const invitee = s(parsed.args[3]);
      const role = s(parsed.args[4] || "viewer");
      const invite = await cavsafeInviteByPath(ctx, pathArg, invitee, role);
      blocks.push({ kind: "json", title: "CavSafe Invite", data: invite });
      return { cwd, blocks, warnings };
    }

    if (action === "revoke") {
      const pathArg = resolvePath(parsed.args[2], cwd);
      const targetUserId = s(parsed.args[3]);
      const result = await cavsafeRevokeByPath(ctx, pathArg, targetUserId);
      blocks.push({ kind: "json", title: "CavSafe Revoke", data: result });
      return { cwd, blocks, warnings };
    }

    if (action === "audit") {
      const rows = await cavsafeAudit(ctx, parsed.args[2] || null);
      blocks.push(tableFromObjects("CavSafe Audit", rows));
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("BAD_SAFE_COMMAND", "Usage: cav safe invite|revoke|audit ...", 400);
  }

  throw new CavtoolsExecError("UNKNOWN_CAV_COMMAND", `Unknown cav command: ${sub}`, 400);
}

async function commandTree(ctx: ExecContext, path: string, depthArg: string | null): Promise<CavtoolsExecBlock> {
  const normalizedPath = normalizePath(path);
  const root = pathRoot(normalizedPath);
  if (!root) throw new CavtoolsExecError("UNKNOWN_NAMESPACE", `Unknown namespace: ${path}`, 400);

  const depthRaw = Number(depthArg);
  const depth = Number.isFinite(depthRaw) && Number.isInteger(depthRaw)
    ? Math.max(1, Math.min(MAX_TREE_DEPTH, depthRaw))
    : 2;

  const lines: string[] = [];

  async function walk(currentPath: string, prefix: string, currentDepth: number): Promise<void> {
    if (currentDepth > depth) return;

    const listing = await listForPath(ctx, currentPath);
    const folders = listing.items.filter((item) => item.type === "folder");
    const files = listing.items.filter((item) => item.type === "file");
    const items = [...folders, ...files];

    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const isLast = index === items.length - 1;
      const branch = isLast ? "└─" : "├─";
      lines.push(`${prefix}${branch} ${item.name}${item.type === "folder" ? "/" : ""}`);

      if (item.type === "folder") {
        const nextPrefix = `${prefix}${isLast ? "  " : "│ "}`;
        await walk(item.path, nextPrefix, currentDepth + 1);
      }
    }
  }

  lines.push(normalizedPath);
  await walk(normalizedPath, "", 1);

  return {
    kind: "text",
    title: `Tree (${depth} levels)`,
    lines,
  };
}

async function commandOpen(ctx: ExecContext, path: string): Promise<CavtoolsExecBlock[]> {
  const normalized = normalizePath(path);
  const root = pathRoot(normalized);
  if (!root) throw new CavtoolsExecError("UNKNOWN_NAMESPACE", `Unknown namespace: ${path}`, 400);

  if (root === "/cavcloud") {
    const sourcePath = toSourcePath("/cavcloud", normalized);
    const node = await getCloudNodeByPath(ctx.accountId, sourcePath);
    if (node.file) {
      await requireCloudPermission(ctx, {
        action: "EDIT_FILE_CONTENT",
        resourceType: "FILE",
        resourceId: node.file.id,
        neededPermission: "VIEW",
      });
      return [{ kind: "open", title: "Open File", url: `/api/cavcloud/files/${node.file.id}?raw=1&access=1`, label: normalized }];
    }
    if (node.folder) {
      await requireCloudPermission(ctx, {
        action: "EDIT_FILE_CONTENT",
        resourceType: "FOLDER",
        resourceId: node.folder.id,
        neededPermission: "VIEW",
      });
      return [{ kind: "open", title: "Open Folder", url: `/cavcloud`, label: normalized }];
    }
    throw new CavtoolsExecError("PATH_NOT_FOUND", `Path not found: ${normalized}`, 404);
  }

  if (root === "/cavsafe") {
    const sourcePath = toSourcePath("/cavsafe", normalized);
    const node = await getSafeNodeByPath(ctx.accountId, sourcePath);
    if (node.file) {
      await requireSafeRole(ctx, node.file.id, "VIEWER");
      return [{ kind: "open", title: "Open Secure File", url: `/api/cavsafe/files/${node.file.id}?raw=1&access=1`, label: normalized }];
    }
    if (node.folder) {
      await requireSafeRole(ctx, node.folder.id, "VIEWER");
      return [{ kind: "open", title: "Open Secure Folder", url: `/cavsafe`, label: normalized }];
    }
    throw new CavtoolsExecError("PATH_NOT_FOUND", `Path not found: ${normalized}`, 404);
  }

  if (root === "/cavcode") {
    if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found.", 400);

    await assertCavCodeProjectAccess({
      accountId: ctx.accountId,
      userId: ctx.userId,
      projectId: ctx.project.id,
      needed: "VIEW",
      errorCode: "UNAUTHORIZED",
    });

    const mounts = await cavcodeMounts(ctx);
    const sub = normalizePath(normalized === "/cavcode" ? "/" : normalized.slice("/cavcode".length));
    const match = findMountForVirtualPath(mounts, sub);
    if (!match) {
      return [{ kind: "open", title: "Open CavCode", url: `/cavcode`, label: normalized }];
    }

    if (match.sourceType === "CAVCLOUD") {
      const node = await getCloudNodeByPath(ctx.accountId, match.sourcePath);
      if (node.file) {
        await requireCloudPermission(ctx, {
          action: "EDIT_FILE_CONTENT",
          resourceType: "FILE",
          resourceId: node.file.id,
          neededPermission: "VIEW",
        });
        return [{ kind: "open", title: "Open Mounted File", url: `/api/cavcloud/files/${node.file.id}?raw=1&access=1`, label: normalized }];
      }
      return [{ kind: "open", title: "Open CavCode", url: `/cavcode?project=${ctx.project.id}&file=${encodeURIComponent(normalized)}`, label: normalized }];
    }

    const node = await getSafeNodeByPath(ctx.accountId, match.sourcePath);
    if (node.file) {
      await requireSafeRole(ctx, node.file.id, "VIEWER");
      return [{ kind: "open", title: "Open Mounted Secure File", url: `/api/cavsafe/files/${node.file.id}?raw=1&access=1`, label: normalized }];
    }

    return [{ kind: "open", title: "Open CavCode", url: `/cavcode?project=${ctx.project.id}&file=${encodeURIComponent(normalized)}`, label: normalized }];
  }

  if (root === "/telemetry") {
    return [{ kind: "open", title: "Telemetry Console", url: `/console`, label: normalized }];
  }

  return [{ kind: "open", title: "Workspace", url: `/`, label: normalized }];
}

async function shellCommand(ctx: ExecContext, parsed: ParsedCommand, cwdInput: string): Promise<{ cwd: string; blocks: CavtoolsExecBlock[]; warnings: string[] }> {
  const warnings: string[] = [];
  const blocks: CavtoolsExecBlock[] = [];
  let cwd = normalizePath(cwdInput || DEFAULT_CWD);

  if (!pathRoot(cwd)) cwd = DEFAULT_CWD;

  const name = parsed.name;
  const arg0 = parsed.args[0] || "";

  if (name === "pwd") {
    blocks.push({ kind: "text", lines: [cwd] });
    return { cwd, blocks, warnings };
  }

  if (name === "cd") {
    const target = resolvePath(arg0 || DEFAULT_CWD, cwd);
    assertKnownRoot(target);

    if (target.startsWith("/telemetry") && target !== "/telemetry") {
      cwd = "/telemetry";
    } else if (target.startsWith("/workspace") && target !== "/workspace") {
      cwd = "/workspace";
    } else {
      const listing = await listForPath(ctx, target);
      cwd = listing.cwd;
      blocks.push({
        kind: "files",
        title: `Listing ${listing.cwd}`,
        cwd: listing.cwd,
        items: listing.items,
      });
    }

    return { cwd, blocks, warnings };
  }

  if (name === "ls") {
    const target = resolvePath(arg0 || cwd, cwd);
    const listing = await listForPath(ctx, target);
    cwd = listing.cwd;
    blocks.push({
      kind: "files",
      title: `Listing ${listing.cwd}`,
      cwd: listing.cwd,
      items: listing.items,
    });
    return { cwd, blocks, warnings };
  }

  if (name === "tree") {
    const target = resolvePath(arg0 || cwd, cwd);
    const depth = parsed.args[1] || null;
    const treeBlock = await commandTree(ctx, target, depth);
    blocks.push(treeBlock);
    return { cwd, blocks, warnings };
  }

  if (name === "cat") {
    const target = resolvePath(arg0, cwd);
    const file = await readFileText(ctx, target);
    blocks.push({
      kind: "text",
      title: `${file.path} (${file.mimeType})`,
      lines: file.content.split("\n"),
    });
    return { cwd, blocks, warnings };
  }

  if (name === "write" || name === "edit") {
    const parsedWrite = parseWriteContent(parsed);
    const target = resolvePath(parsedWrite.pathArg, cwd);
    const saved = await writeFileText(ctx, target, parsedWrite.content);
    blocks.push({
      kind: "json",
      title: "File Saved",
      data: saved,
    });
    return { cwd, blocks, warnings };
  }

  if (name === "touch") {
    const target = resolvePath(arg0, cwd);
    const existing = await readFileText(ctx, target).catch(() => null);
    if (existing?.ok) {
      blocks.push({ kind: "text", lines: [`Already exists: ${existing.path}`] });
      return { cwd, blocks, warnings };
    }

    const saved = await writeFileText(ctx, target, "");
    blocks.push({
      kind: "json",
      title: "File Created",
      data: saved,
    });
    return { cwd, blocks, warnings };
  }

  if (name === "mkdir") {
    const target = resolvePath(arg0, cwd);
    const root = pathRoot(target);
    if (!root) throw new CavtoolsExecError("UNKNOWN_NAMESPACE", `Unknown namespace: ${target}`, 400);

    if (root === "/cavcloud") {
      const created = await cloudMkdir(ctx, target);
      blocks.push({ kind: "json", title: "Folder Created", data: created });
      return { cwd, blocks, warnings };
    }

    if (root === "/cavsafe") {
      const created = await safeMkdir(ctx, target);
      blocks.push({ kind: "json", title: "Secure Folder Created", data: created });
      return { cwd, blocks, warnings };
    }

    if (root === "/cavcode") {
      const created = await cavcodeMkdir(ctx, target);
      blocks.push({ kind: "json", title: "Mounted Folder Created", data: created });
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("MKDIR_UNSUPPORTED", `mkdir is not supported for ${root}.`, 400);
  }

  if (name === "rm") {
    const target = resolvePath(arg0, cwd);
    const removed = await rmPath(ctx, target);
    blocks.push({
      kind: "text",
      lines: [`Removed ${removed.kind}: ${removed.path}`],
    });
    return { cwd, blocks, warnings };
  }

  if (name === "mv") {
    const sourcePath = resolvePath(parsed.args[0], cwd);
    const targetPath = resolvePath(parsed.args[1], cwd);
    if (!parsed.args[0] || !parsed.args[1]) {
      throw new CavtoolsExecError("MOVE_USAGE", "Usage: mv <source> <destination>", 400);
    }
    const moved = await movePath(ctx, sourcePath, targetPath);
    blocks.push({
      kind: "json",
      title: "Moved",
      data: moved,
    });
    return { cwd, blocks, warnings };
  }

  if (name === "cp") {
    const sourcePath = resolvePath(parsed.args[0], cwd);
    const targetPath = resolvePath(parsed.args[1], cwd);
    if (!parsed.args[0] || !parsed.args[1]) {
      throw new CavtoolsExecError("COPY_USAGE", "Usage: cp <source> <destination>", 400);
    }
    const copied = await copyPath(ctx, sourcePath, targetPath);
    blocks.push({
      kind: "json",
      title: "Copied",
      data: copied,
    });
    return { cwd, blocks, warnings };
  }

  if (name === "open") {
    const target = resolvePath(arg0 || cwd, cwd);
    const openBlocks = await commandOpen(ctx, target);
    blocks.push(...openBlocks);
    return { cwd, blocks, warnings };
  }

  if (name === "search") {
    const query = s(parsed.args[0]);
    if (!query) throw new CavtoolsExecError("QUERY_REQUIRED", "Usage: search <text>", 400);

    const root = pathRoot(cwd);
    if (root === "/cavcloud") {
      const sourceCwd = toSourcePath("/cavcloud", cwd);
      const files = await prisma.cavCloudFile.findMany({
        where: {
          accountId: ctx.accountId,
          deletedAt: null,
          path: {
            startsWith: sourceCwd === "/" ? "/" : `${sourceCwd}/`,
          },
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { path: { contains: query, mode: "insensitive" } },
            { previewSnippet: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 80,
        select: {
          path: true,
          name: true,
          mimeType: true,
          updatedAt: true,
        },
      });

      blocks.push(tableFromObjects(
        `Search ${query}`,
        files.map((file) => ({
          name: file.name,
          path: toNamespacePath("/cavcloud", file.path),
          mimeType: file.mimeType,
          updatedAtISO: file.updatedAt.toISOString(),
        }))
      ));
      return { cwd, blocks, warnings };
    }

    if (root === "/cavcode") {
      const files = await prisma.cavCloudFile.findMany({
        where: {
          accountId: ctx.accountId,
          deletedAt: null,
          OR: [
            { name: { contains: query, mode: "insensitive" } },
            { path: { contains: query, mode: "insensitive" } },
            { previewSnippet: { contains: query, mode: "insensitive" } },
          ],
        },
        orderBy: {
          updatedAt: "desc",
        },
        take: 80,
        select: {
          name: true,
          path: true,
          mimeType: true,
          updatedAt: true,
        },
      });
      blocks.push(tableFromObjects(
        `Search ${query}`,
        files.map((file) => ({
          name: file.name,
          path: toNamespacePath("/cavcloud", file.path),
          mimeType: file.mimeType,
          updatedAtISO: file.updatedAt.toISOString(),
        }))
      ));
      warnings.push("/cavcode search currently indexes mounted CavCloud files directly.");
      return { cwd, blocks, warnings };
    }

    throw new CavtoolsExecError("SEARCH_UNSUPPORTED", "search is available in /cavcloud and /cavcode.", 400);
  }

  if (name === "lint") {
    const lint = await runCavcodeWorkspaceDiagnostics(ctx);
    blocks.push({
      kind: "diagnostics",
      title: "Workspace Diagnostics",
      diagnostics: lint.diagnostics,
      summary: lint.summary,
    });
    blocks.push({
      kind: "text",
      lines: [
        `Scanned ${lint.summary.filesScanned} file(s): ${lint.summary.errors} error(s), ${lint.summary.warnings} warning(s), ${lint.summary.infos} info.`,
        `Generated ${lint.summary.generatedAtISO}`,
      ],
    });
    if (lint.summary.truncated) {
      warnings.push("Diagnostics output was truncated due to workspace size limits. Narrow mount scope for full precision.");
    }
    return { cwd, blocks, warnings };
  }

  if (name === "help") {
    blocks.push({
      kind: "text",
      title: "Shell Commands",
      lines: [
        "pwd",
        "cd <path>",
        "ls [path]",
        "tree [path] [depth]",
        "cat <file>",
        "write <file> <content>",
        "mkdir <path>",
        "touch <file>",
        "mv <src> <dest>",
        "cp <src> <dest>",
        "rm <path>",
        "open <path>",
        "search <text>",
        "cav help",
      ],
    });
    return { cwd, blocks, warnings };
  }

  if (name === "cav") {
    return handleCavCommand(ctx, parsed, cwd);
  }

  throw new CavtoolsExecError("UNKNOWN_COMMAND", `Unknown command: ${parsed.name}`, 400);
}

export async function executeCavtoolsCommand(req: Request, input: CavtoolsExecInput): Promise<CavtoolsExecOutput> {
  const started = Date.now();
  const command = s(input.command);
  const cwdInput = normalizePath(s(input.cwd) || DEFAULT_CWD);
  const commandId = hashCommandId(command, cwdInput);

  let ctx: ExecContext | null = null;

  try {
    if (!command) throw new CavtoolsExecError("COMMAND_REQUIRED", "Command is required.", 400);
    ctx = await resolveExecContext(req, input);

    const parsed = parseCommand(command);
    const result = await shellCommand(ctx, parsed, cwdInput);
    const durationMs = Date.now() - started;

    await writeCommandAudit(ctx, {
      commandId,
      command,
      cwd: cwdInput,
      ok: true,
      denied: false,
      durationMs,
    });

    return {
      ok: true,
      cwd: result.cwd,
      command,
      warnings: result.warnings,
      blocks: result.blocks,
      durationMs,
      audit: {
        commandId,
        atISO: nowISO(),
        denied: false,
      },
      actor: {
        memberRole: ctx.memberRole,
        planId: ctx.planId,
        includeCavsafe: ctx.includeCavsafe,
      },
    };
  } catch (error) {
    const err = formatErrorMessage(error);
    const durationMs = Date.now() - started;

    if (!ctx) {
      try {
        ctx = await resolveExecContext(req, input);
      } catch {
        ctx = null;
      }
    }

    if (ctx) {
      await writeCommandAudit(ctx, {
        commandId,
        command,
        cwd: cwdInput,
        ok: false,
        denied: err.status === 401 || err.status === 403,
        durationMs,
        code: err.code,
      });
    }

    const role = s(ctx?.memberRole || "ANON").toUpperCase() as "OWNER" | "ADMIN" | "MEMBER" | "ANON";
    const plan = (() => {
      const p = s(ctx?.planId || "free").toUpperCase();
      if (p === "PREMIUM_PLUS") return "PREMIUM_PLUS" as const;
      if (p === "PREMIUM") return "PREMIUM" as const;
      return "FREE" as const;
    })();

    const guardDecision = err.guardActionId
      ? buildCavGuardDecision(err.guardActionId, {
          role,
          plan,
          flags: {
            source: "cavtools_exec",
          },
        })
      : undefined;

    return {
      ok: false,
      cwd: cwdInput,
      command,
      warnings: [],
      blocks: [
        {
          kind: "text",
          title: "Command Failed",
          lines: [err.message],
        },
      ],
      durationMs,
      audit: {
        commandId,
        atISO: nowISO(),
        denied: err.status === 401 || err.status === 403,
      },
      actor: {
        memberRole: role,
        planId: (ctx?.planId || "free") as PlanId | "free",
        includeCavsafe: Boolean(ctx?.includeCavsafe),
      },
      error: {
        code: err.code,
        message: err.message,
        guardDecision,
      },
    };
  }
}

export type CavtoolsRuntimeStatusPayload = ReturnType<typeof runtimeSessionView>;
export type CavtoolsRuntimeLogsPayload = ReturnType<typeof readRuntimeLogs>;
export type CavtoolsDebugStatusPayload = ReturnType<typeof debugSessionView>;
export type CavtoolsDebugLogsPayload = ReturnType<typeof readDebugLogs>;
export type CavcodeEventsSnapshotPayload = {
  projectId: number;
  afterSeq: number;
  nextSeq: number;
  events: CavcodeEventEnvelope[];
};

export async function readCavtoolsRuntimeSnapshot(
  req: Request,
  input: {
    sessionId?: string | null;
    afterSeq?: number | string | null;
    projectId?: number | string | null;
    siteOrigin?: string | null;
  }
): Promise<{
  status: CavtoolsRuntimeStatusPayload;
  logs: CavtoolsRuntimeLogsPayload;
} | null> {
  const ctx = await resolveExecContext(req, {
    command: "cav run logs",
    cwd: "/cavcode",
    projectId: input.projectId,
    siteOrigin: input.siteOrigin,
  });
  await cleanupRuntimeSessions();
  if (!ctx.project?.id) {
    throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for runtime.", 400);
  }

  const projectKey = runtimeProjectKey(ctx.accountId, ctx.project.id);
  const sessionId = s(input.sessionId || runtimeSessionByProject.get(projectKey) || "");
  if (!sessionId) return null;

  const session = assertRuntimeSessionAccess(ctx, sessionId);
  const afterSeqRaw = Number(input.afterSeq);
  const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0;

  return {
    status: runtimeSessionView(session),
    logs: readRuntimeLogs(session, afterSeq),
  };
}

export async function readCavtoolsDebugSnapshot(
  req: Request,
  input: {
    sessionId?: string | null;
    afterSeq?: number | string | null;
    projectId?: number | string | null;
    siteOrigin?: string | null;
  }
): Promise<{
  status: CavtoolsDebugStatusPayload;
  logs: CavtoolsDebugLogsPayload;
} | null> {
  const ctx = await resolveExecContext(req, {
    command: "cav debug logs",
    cwd: "/cavcode",
    projectId: input.projectId,
    siteOrigin: input.siteOrigin,
  });
  await cleanupDebugSessions();
  if (!ctx.project?.id) {
    throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for debug.", 400);
  }

  const projectKey = runtimeProjectKey(ctx.accountId, ctx.project.id);
  const sessionId = s(input.sessionId || debugSessionByProject.get(projectKey) || "");
  if (!sessionId) return null;

  const session = assertDebugSessionAccess(ctx, sessionId);
  const afterSeqRaw = Number(input.afterSeq);
  const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0;

  return {
    status: debugSessionView(session),
    logs: readDebugLogs(session, afterSeq),
  };
}

export async function readCavcodeEventsSnapshot(
  req: Request,
  input: {
    projectId?: number | string | null;
    afterSeq?: number | string | null;
    limit?: number | string | null;
    siteOrigin?: string | null;
  }
): Promise<CavcodeEventsSnapshotPayload> {
  const ctx = await resolveExecContext(req, {
    command: "cav events",
    cwd: "/cavcode",
    projectId: input.projectId,
    siteOrigin: input.siteOrigin,
  });
  if (!ctx.project?.id) throw new CavtoolsExecError("PROJECT_REQUIRED", "No active project found for events.", 400);
  await assertCavCodeProjectAccess({
    accountId: ctx.accountId,
    userId: ctx.userId,
    projectId: ctx.project.id,
    needed: "VIEW",
    errorCode: "UNAUTHORIZED",
  });
  const afterSeqRaw = Number(input.afterSeq);
  const limitRaw = Number(input.limit);
  const afterSeq = Number.isFinite(afterSeqRaw) ? Math.max(0, Math.trunc(afterSeqRaw)) : 0;
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(CAVCODE_EVENT_BATCH, Math.trunc(limitRaw))) : CAVCODE_EVENT_BATCH;
  const payload = await readCavcodeEventsBySeq({
    accountId: ctx.accountId,
    projectId: ctx.project.id,
    afterSeq,
    limit,
  });
  return {
    projectId: ctx.project.id,
    afterSeq,
    nextSeq: payload.nextSeq,
    events: payload.events,
  };
}

export async function readCavtoolsFile(req: Request, input: { path: string; projectId?: number | string | null; siteOrigin?: string | null }): Promise<CavtoolsFileReadOutput> {
  const ctx = await resolveExecContext(req, {
    command: "cat",
    cwd: normalizePath(s(input.path) || DEFAULT_CWD),
    projectId: input.projectId,
    siteOrigin: input.siteOrigin,
  });

  return readFileText(ctx, normalizePath(input.path));
}

export async function writeCavtoolsFile(req: Request, input: {
  path: string;
  content: string;
  mimeType?: string | null;
  baseSha256?: string | null;
  projectId?: number | string | null;
  siteOrigin?: string | null;
}): Promise<CavtoolsFileWriteOutput> {
  const ctx = await resolveExecContext(req, {
    command: "write",
    cwd: normalizePath(s(input.path) || DEFAULT_CWD),
    projectId: input.projectId,
    siteOrigin: input.siteOrigin,
  });

  return writeFileText(
    ctx,
    normalizePath(input.path),
    String(input.content || ""),
    input.mimeType || null,
    input.baseSha256 || null
  );
}
