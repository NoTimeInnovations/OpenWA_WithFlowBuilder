// API Service Layer for OpenWA Dashboard
// Centralized API client with TypeScript types

const API_BASE_URL = '/api';

// =============================================================================
// Types
// =============================================================================

export interface Session {
  id: string;
  name: string;
  status: 'created' | 'idle' | 'initializing' | 'connecting' | 'qr_ready' | 'ready' | 'disconnected';
  phone?: string;
  pushName?: string;
  lastActive?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WaGroup {
  id: string;
  name: string;
  participantsCount?: number;
  isCommunity?: boolean; // a Community's parent / announcement group
  isCommunitySubGroup?: boolean; // a group linked under a Community
  isAnnounce?: boolean; // announcement-only group
}

export interface SessionStats {
  total: number;
  active: number;
  ready: number;
  disconnected: number;
  byStatus: Record<string, number>;
  memoryUsage: { heapUsed: number; heapTotal: number; rss: number };
}

export interface Webhook {
  id: string;
  sessionId: string;
  url: string;
  events: string[];
  active: boolean;
  secret?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  role: 'admin' | 'user' | 'readonly';
  allowedIps?: string[];
  allowedSessions?: string[];
  isActive: boolean;
  expiresAt?: string;
  lastUsedAt?: string;
  usageCount: number;
  createdAt: string;
  apiKey?: string; // Only returned on creation
}

export interface AuditLog {
  id: string;
  action: string;
  severity: 'info' | 'warn' | 'error';
  apiKeyId?: string;
  apiKeyName?: string;
  sessionId?: string;
  sessionName?: string;
  ipAddress?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  errorMessage?: string;
  createdAt: string;
}

export interface MessageResponse {
  messageId: string;
  timestamp: number;
}

export interface HealthStatus {
  status: 'ok' | 'error';
  timestamp?: string;
  details?: {
    database?: { status: string };
    redis?: { status: string };
    queue?: { status: string };
  };
}

export interface InfraStatus {
  database: { connected: boolean; type: string; host: string };
  redis: { connected: boolean; host: string; port: number };
  queue: {
    enabled: boolean;
    messages: { pending: number; completed: number; failed: number };
    webhooks: { pending: number; completed: number; failed: number };
  };
  storage: { type: 'local' | 's3'; path?: string; bucket?: string };
  engine: { type: string; headless: boolean };
}

export interface SaveConfigPayload {
  database?: {
    type: 'sqlite' | 'postgres';
    builtIn?: boolean;
    host?: string;
    port?: string;
    username?: string;
    password?: string;
    database?: string;
    poolSize?: number;
    sslEnabled?: boolean;
  };
  redis?: {
    enabled?: boolean;
    builtIn?: boolean;
    host?: string;
    port?: string;
    password?: string;
  };
  queue?: {
    enabled?: boolean;
  };
  storage?: {
    type: 'local' | 's3';
    builtIn?: boolean;
    localPath?: string;
    s3Bucket?: string;
    s3Region?: string;
    s3AccessKey?: string;
    s3SecretKey?: string;
    s3Endpoint?: string;
  };
  engine?: {
    headless?: boolean;
    sessionDataPath?: string;
    browserArgs?: string;
  };
}

export interface Settings {
  general: { apiBaseUrl: string; sessionTimeout: number; autoReconnect: boolean; debugMode: boolean };
  api: { rateLimit: number; rateLimitWindow: number; enableDocs: boolean };
  notifications: { emailEnabled: boolean; notificationEmail: string; webhookAlerts: boolean };
}

// =============================================================================
// API Client
// =============================================================================

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;

  // Get API key from sessionStorage for authentication
  const apiKey = sessionStorage.getItem('openwa_api_key');

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'X-API-Key': apiKey } : {}),
    ...options.headers,
  };

  const response = await fetch(url, { ...options, headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// Fetch a binary endpoint and trigger a browser download.
async function downloadFile(endpoint: string, fallbackName: string): Promise<void> {
  const apiKey = sessionStorage.getItem('openwa_api_key');
  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    headers: { ...(apiKey ? { 'X-API-Key': apiKey } : {}) },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fallbackName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// =============================================================================
// Session API
// =============================================================================

export const sessionApi = {
  list: () => request<Session[]>('/sessions'),
  get: (id: string) => request<Session>(`/sessions/${id}`),
  create: (name: string) =>
    request<Session>('/sessions', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  delete: (id: string) => request<void>(`/sessions/${id}`, { method: 'DELETE' }),
  start: (id: string) => request<Session>(`/sessions/${id}/start`, { method: 'POST' }),
  stop: (id: string) => request<Session>(`/sessions/${id}/stop`, { method: 'POST' }),
  getQR: (id: string) => request<{ qrCode: string; status: string }>(`/sessions/${id}/qr`),
  getStats: () => request<SessionStats>('/sessions/stats/overview'),
  getGroups: (id: string) => request<WaGroup[]>(`/sessions/${id}/groups`),
};

// =============================================================================
// Export API
// =============================================================================

export const exportApi = {
  // Download chats, contacts and group members for a session as an .xlsx file
  downloadXlsx: (id: string) => {
    const stamp = new Date().toISOString().slice(0, 10);
    return downloadFile(`/sessions/${id}/export/xlsx`, `whatsapp-export-${stamp}.xlsx`);
  },
};

// =============================================================================
// Webhook API
// =============================================================================

export const webhookApi = {
  listBySession: (sessionId: string) => request<Webhook[]>(`/sessions/${sessionId}/webhooks`),
  listAll: () => request<Webhook[]>('/webhooks'),
  get: (sessionId: string, id: string) => request<Webhook>(`/sessions/${sessionId}/webhooks/${id}`),
  create: (sessionId: string, data: { url: string; events: string[] }) =>
    request<Webhook>(`/sessions/${sessionId}/webhooks`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (sessionId: string, id: string, data: Partial<Webhook>) =>
    request<Webhook>(`/sessions/${sessionId}/webhooks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (sessionId: string, id: string) =>
    request<void>(`/sessions/${sessionId}/webhooks/${id}`, { method: 'DELETE' }),
  test: (sessionId: string, id: string) =>
    request<{ success: boolean; statusCode?: number; error?: string }>(`/sessions/${sessionId}/webhooks/${id}/test`, {
      method: 'POST',
    }),
};

// =============================================================================
// API Key API
// =============================================================================

export const apiKeyApi = {
  list: () => request<ApiKey[]>('/auth/api-keys'),
  get: (id: string) => request<ApiKey>(`/auth/api-keys/${id}`),
  create: (data: {
    name: string;
    role: string;
    allowedIps?: string[];
    allowedSessions?: string[];
    expiresAt?: string;
  }) =>
    request<ApiKey>('/auth/api-keys', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<ApiKey>) =>
    request<ApiKey>(`/auth/api-keys/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<void>(`/auth/api-keys/${id}`, { method: 'DELETE' }),
  revoke: (id: string) => request<ApiKey>(`/auth/api-keys/${id}/revoke`, { method: 'POST' }),
};

// =============================================================================
// Audit/Logs API
// =============================================================================

export const auditApi = {
  list: (params?: { action?: string; severity?: string; limit?: number; offset?: number }) => {
    const query = new URLSearchParams();
    if (params?.action) query.set('action', params.action);
    if (params?.severity) query.set('severity', params.severity);
    if (params?.limit) query.set('limit', String(params.limit));
    if (params?.offset) query.set('offset', String(params.offset));
    const queryStr = query.toString();
    return request<{ data: AuditLog[]; total: number }>(`/audit${queryStr ? `?${queryStr}` : ''}`);
  },
};

// =============================================================================
// Message API
// =============================================================================

export const messageApi = {
  sendText: (sessionId: string, chatId: string, text: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-text`, {
      method: 'POST',
      body: JSON.stringify({ chatId, text }),
    }),
  sendImage: (sessionId: string, chatId: string, url: string, caption?: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-image`, {
      method: 'POST',
      body: JSON.stringify({ chatId, url, caption }),
    }),
  sendVideo: (sessionId: string, chatId: string, url: string, caption?: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-video`, {
      method: 'POST',
      body: JSON.stringify({ chatId, url, caption }),
    }),
  sendAudio: (sessionId: string, chatId: string, url: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-audio`, {
      method: 'POST',
      body: JSON.stringify({ chatId, url }),
    }),
  sendDocument: (sessionId: string, chatId: string, url: string, filename?: string) =>
    request<MessageResponse>(`/sessions/${sessionId}/messages/send-document`, {
      method: 'POST',
      body: JSON.stringify({ chatId, url, filename }),
    }),
};

// =============================================================================
// Health & Infrastructure API
// =============================================================================

export const healthApi = {
  check: () => request<HealthStatus>('/health'),
  ready: () => request<HealthStatus>('/health/ready'),
};

export const infraApi = {
  getStatus: () => request<InfraStatus>('/infra/status'),
  updateConfig: (config: Partial<InfraStatus>) =>
    request<InfraStatus>('/infra/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  saveConfig: (config: SaveConfigPayload) =>
    request<{ message: string; saved: boolean; envPath: string; profiles: string[] }>('/infra/config', {
      method: 'PUT',
      body: JSON.stringify(config),
    }),
  restart: (profiles?: string[], profilesToRemove?: string[]) =>
    request<{
      message: string;
      restarting: boolean;
      profiles: string[];
      profilesToRemove: string[];
      estimatedTime: number;
    }>('/infra/restart', {
      method: 'POST',
      body: JSON.stringify({ profiles: profiles || [], profilesToRemove: profilesToRemove || [] }),
    }),
  healthCheck: () => request<{ status: string; timestamp: string }>('/infra/health'),
};

// =============================================================================
// Settings API
// =============================================================================

export const settingsApi = {
  get: () => request<Settings>('/settings'),
  update: (settings: Partial<Settings>) =>
    request<Settings>('/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    }),
};

// =============================================================================
// Messaging Flow Types
// =============================================================================

export type FlowNodeType =
  | 'trigger'
  | 'send_text'
  | 'send_image'
  | 'send_video'
  | 'send_audio'
  | 'send_document'
  | 'buttons'
  | 'wait_for_reply'
  | 'condition'
  | 'delay'
  | 'set_variable'
  | 'jump'
  | 'end';

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

export type FlowScopeType = 'session' | 'sessions' | 'all';
export interface FlowScope {
  type: FlowScopeType;
  sessionIds?: string[];
}

export type TriggerMatchType = 'exact' | 'contains' | 'welcome' | 'any' | 'default';
export interface TriggerDef {
  matchType: TriggerMatchType;
  keywords?: string[];
  priority: number;
}

export interface Flow {
  id: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  scope: FlowScope;
  graph: FlowGraph;
  triggers: TriggerDef[];
  escapeKeyword?: string | null;
  runTtlHours: number;
  createdAt: string;
  updatedAt: string;
}

export interface FlowDryRunOutbound {
  kind: 'text' | 'image' | 'audio';
  chatId: string;
  text?: string;
  media?: string;
  caption?: string;
}

export interface FlowDryRunResult {
  matchedFlow: boolean;
  flowId?: string;
  flowName?: string;
  executedNodes: string[];
  outbound: FlowDryRunOutbound[];
  parkedAt?: string | null;
  status: 'no-match' | 'parked' | 'completed' | 'aborted';
}

export interface FlowExecutionStateDto {
  id: string;
  flowId: string;
  sessionId: string;
  chatId: string;
  currentNodeId: string | null;
  status: string;
  variables: Record<string, unknown>;
  startedAt: string;
  lastInteractionAt?: string | null;
}

export interface SaveFlowPayload {
  name: string;
  description?: string;
  enabled?: boolean;
  scope: FlowScope;
  graph: FlowGraph;
  escapeKeyword?: string;
  runTtlHours?: number;
}

export const flowApi = {
  list: () => request<Flow[]>('/flows'),
  get: (id: string) => request<Flow>(`/flows/${id}`),
  create: (data: SaveFlowPayload) =>
    request<Flow>('/flows', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<SaveFlowPayload>) =>
    request<Flow>(`/flows/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  duplicate: (id: string) => request<Flow>(`/flows/${id}/duplicate`, { method: 'POST' }),
  enable: (id: string) => request<Flow>(`/flows/${id}/enable`, { method: 'PATCH' }),
  disable: (id: string) => request<Flow>(`/flows/${id}/disable`, { method: 'PATCH' }),
  delete: (id: string) => request<void>(`/flows/${id}`, { method: 'DELETE' }),
  test: (id: string, data: { sessionId: string; from: string; body: string }) =>
    request<FlowDryRunResult>(`/flows/${id}/test`, { method: 'POST', body: JSON.stringify(data) }),
  listRuns: (id: string) => request<FlowExecutionStateDto[]>(`/flows/${id}/runs`),
};

// =============================================================================
// Plugin Types
// =============================================================================

export interface Plugin {
  id: string;
  name: string;
  version: string;
  type: 'engine' | 'storage' | 'queue' | 'auth' | 'extension';
  description?: string;
  author?: string;
  status: 'installed' | 'enabled' | 'disabled' | 'error';
  config: Record<string, unknown>;
  builtIn: boolean;
  provides: string[];
  loadedAt?: string;
  enabledAt?: string;
  error?: string;
}

export interface Engine {
  id: string;
  name: string;
  enabled: boolean;
  features: string[];
}

// =============================================================================
// Plugins API
// =============================================================================

export const pluginsApi = {
  list: () => request<Plugin[]>('/plugins'),
  get: (id: string) => request<Plugin>(`/plugins/${id}`),
  enable: (id: string) =>
    request<{ success: boolean; message: string }>(`/plugins/${id}/enable`, {
      method: 'POST',
    }),
  disable: (id: string) =>
    request<{ success: boolean; message: string }>(`/plugins/${id}/disable`, {
      method: 'POST',
    }),
  updateConfig: (id: string, config: Record<string, unknown>) =>
    request<{ success: boolean; message: string }>(`/plugins/${id}/config`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),
  healthCheck: (id: string) => request<{ healthy: boolean; message?: string }>(`/plugins/${id}/health`),
  getEngines: () => request<Engine[]>('/infra/engines'),
  getCurrentEngine: () => request<{ engineType: string }>('/infra/engines/current'),
};

// =============================================================================
// Group-Leave Audio Rules
// =============================================================================

export type GroupEvent = 'join' | 'leave';

export interface GroupLeaveRule {
  id: string;
  sessionId: string;
  event: GroupEvent;
  groupId: string;
  groupName?: string | null;
  audioUrl?: string | null;
  audioStorageKey?: string | null;
  audioMimetype?: string | null;
  audioFilename?: string | null;
  sendAsVoice: boolean;
  delaySeconds: number;
  enabled: boolean;
  lastTriggeredAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AudioUploadResult {
  storageKey: string;
  mimetype: string;
  filename: string;
  size: number;
}

export interface CreateGroupLeaveRulePayload {
  sessionId: string;
  event?: GroupEvent;
  groupId: string;
  groupName?: string;
  audioUrl?: string;
  audioStorageKey?: string;
  audioMimetype?: string;
  audioFilename?: string;
  sendAsVoice?: boolean;
  delaySeconds?: number;
  enabled?: boolean;
}

// Upload an audio file via multipart/form-data (request() only handles JSON).
async function uploadGroupLeaveAudio(file: File): Promise<AudioUploadResult> {
  const apiKey = sessionStorage.getItem('openwa_api_key');
  const form = new FormData();
  form.append('file', file);
  const response = await fetch(`${API_BASE_URL}/group-leave-rules/upload-audio`, {
    method: 'POST',
    headers: { ...(apiKey ? { 'X-API-Key': apiKey } : {}) },
    body: form,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.json();
}

export const groupLeaveApi = {
  list: () => request<GroupLeaveRule[]>('/group-leave-rules'),
  create: (data: CreateGroupLeaveRulePayload) =>
    request<GroupLeaveRule>('/group-leave-rules', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<CreateGroupLeaveRulePayload>) =>
    request<GroupLeaveRule>(`/group-leave-rules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => request<void>(`/group-leave-rules/${id}`, { method: 'DELETE' }),
  uploadAudio: (file: File) => uploadGroupLeaveAudio(file),
};
