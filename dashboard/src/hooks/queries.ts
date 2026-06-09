import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  sessionApi,
  webhookApi,
  apiKeyApi,
  auditApi,
  infraApi,
  pluginsApi,
  flowApi,
  type Webhook,
  type SaveFlowPayload,
} from '../services/api';

// ── Query Keys ────────────────────────────────────────────────────────

export const queryKeys = {
  sessions: ['sessions'] as const,
  sessionStats: ['sessions', 'stats'] as const,
  sessionGroups: (sessionId: string) => ['sessions', sessionId, 'groups'] as const,
  webhooks: ['webhooks'] as const,
  apiKeys: ['apiKeys'] as const,
  logs: (params: { severity?: string; page: number; limit: number }) =>
    ['logs', params] as const,
  infraStatus: ['infra', 'status'] as const,
  plugins: ['plugins'] as const,
  engines: ['engines'] as const,
  currentEngine: ['engines', 'current'] as const,
  flows: ['flows'] as const,
  flow: (id: string) => ['flows', id] as const,
};

// ── Session Queries ───────────────────────────────────────────────────

export function useSessionsQuery() {
  return useQuery({
    queryKey: queryKeys.sessions,
    queryFn: sessionApi.list,
    staleTime: 30_000,
  });
}

export function useSessionStatsQuery() {
  return useQuery({
    queryKey: queryKeys.sessionStats,
    queryFn: sessionApi.getStats,
    staleTime: 30_000,
  });
}

export function useSessionGroupsQuery(sessionId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.sessionGroups(sessionId),
    queryFn: () => sessionApi.getGroups(sessionId),
    enabled: enabled && !!sessionId,
    staleTime: 60_000,
  });
}

export function useCreateSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => sessionApi.create(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionStats });
    },
  });
}

export function useDeleteSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sessionApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessionStats });
    },
  });
}

export function useStartSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sessionApi.start(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

export function useStopSessionMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sessionApi.stop(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
    },
  });
}

// ── Webhook Queries ───────────────────────────────────────────────────

export function useWebhooksQuery() {
  return useQuery({
    queryKey: queryKeys.webhooks,
    queryFn: webhookApi.listAll,
    staleTime: 30_000,
  });
}

export function useCreateWebhookMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { sessionId: string; url: string; events: string[] }) =>
      webhookApi.create(params.sessionId, { url: params.url, events: params.events }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.webhooks });
    },
  });
}

export function useUpdateWebhookMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { sessionId: string; id: string; data: Partial<Webhook> }) =>
      webhookApi.update(params.sessionId, params.id, params.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.webhooks });
    },
  });
}

export function useDeleteWebhookMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { sessionId: string; id: string }) =>
      webhookApi.delete(params.sessionId, params.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.webhooks });
    },
  });
}

// ── API Key Queries ───────────────────────────────────────────────────

export function useApiKeysQuery() {
  return useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: apiKeyApi.list,
    staleTime: 30_000,
  });
}

export function useCreateApiKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; role: string; allowedIps?: string[]; allowedSessions?: string[]; expiresAt?: string }) =>
      apiKeyApi.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
  });
}

export function useDeleteApiKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiKeyApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
  });
}

export function useRevokeApiKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiKeyApi.revoke(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys });
    },
  });
}

// ── Logs Queries ──────────────────────────────────────────────────────

export function useLogsQuery(params: { severity?: string; page: number; limit: number }) {
  return useQuery({
    queryKey: queryKeys.logs(params),
    queryFn: () =>
      auditApi.list({
        severity: params.severity,
        limit: params.limit,
        offset: (params.page - 1) * params.limit,
      }),
    staleTime: 15_000,
  });
}

// ── Infrastructure Queries ────────────────────────────────────────────

export function useInfraStatusQuery() {
  return useQuery({
    queryKey: queryKeys.infraStatus,
    queryFn: infraApi.getStatus,
    staleTime: 30_000,
  });
}

// ── Plugin Queries ────────────────────────────────────────────────────

export function usePluginsQuery() {
  return useQuery({
    queryKey: queryKeys.plugins,
    queryFn: pluginsApi.list,
    staleTime: 30_000,
  });
}

export function useEnginesQuery() {
  return useQuery({
    queryKey: queryKeys.engines,
    queryFn: pluginsApi.getEngines,
    staleTime: 60_000,
  });
}

export function useCurrentEngineQuery() {
  return useQuery({
    queryKey: queryKeys.currentEngine,
    queryFn: pluginsApi.getCurrentEngine,
    staleTime: 60_000,
  });
}

// ── Messaging Flow Queries ────────────────────────────────────────────

export function useFlowsQuery() {
  return useQuery({
    queryKey: queryKeys.flows,
    queryFn: flowApi.list,
    staleTime: 30_000,
  });
}

export function useFlowQuery(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.flow(id),
    queryFn: () => flowApi.get(id),
    enabled: enabled && !!id,
    staleTime: 30_000,
  });
}

export function useCreateFlowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: SaveFlowPayload) => flowApi.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.flows });
    },
  });
}

export function useUpdateFlowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; data: Partial<SaveFlowPayload> }) => flowApi.update(params.id, params.data),
    onSuccess: (_data, params) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.flows });
      void queryClient.invalidateQueries({ queryKey: queryKeys.flow(params.id) });
    },
  });
}

export function useSetFlowEnabledMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; enabled: boolean }) =>
      params.enabled ? flowApi.enable(params.id) : flowApi.disable(params.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.flows });
    },
  });
}

export function useDeleteFlowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => flowApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.flows });
    },
  });
}
