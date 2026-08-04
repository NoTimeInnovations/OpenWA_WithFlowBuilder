import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  sessionApi,
  webhookApi,
  apiKeyApi,
  auditApi,
  infraApi,
  pluginsApi,
  flowApi,
  groupLeaveApi,
  customerListApi,
  campaignApi,
  type Webhook,
  type SaveFlowPayload,
  type CreateGroupLeaveRulePayload,
  type ImportListPayload,
  type CreateCampaignPayload,
  type Campaign,
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
  groupLeaveRules: ['group-leave-rules'] as const,
  customerLists: ['customer-lists'] as const,
  customerList: (id: string) => ['customer-lists', id] as const,
  listCampaigns: (id: string) => ['customer-lists', id, 'campaigns'] as const,
  campaigns: (listId?: string) => ['campaigns', listId ?? 'all'] as const,
  campaign: (id: string) => ['campaigns', 'detail', id] as const,
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

export function useDuplicateFlowMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => flowApi.duplicate(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.flows });
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

// ── Group-Leave Rule Queries ──────────────────────────────────────────

export function useGroupLeaveRulesQuery() {
  return useQuery({
    queryKey: queryKeys.groupLeaveRules,
    queryFn: groupLeaveApi.list,
    staleTime: 30_000,
  });
}

export function useCreateGroupLeaveRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateGroupLeaveRulePayload) => groupLeaveApi.create(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groupLeaveRules });
    },
  });
}

export function useUpdateGroupLeaveRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; data: Partial<CreateGroupLeaveRulePayload> }) =>
      groupLeaveApi.update(params.id, params.data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groupLeaveRules });
    },
  });
}

export function useDeleteGroupLeaveRuleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => groupLeaveApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.groupLeaveRules });
    },
  });
}

// ── Customer List Queries ─────────────────────────────────────────────

export function useCustomerListsQuery() {
  return useQuery({
    queryKey: queryKeys.customerLists,
    queryFn: customerListApi.list,
    staleTime: 15_000,
  });
}

export function useCustomerListQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.customerList(id),
    queryFn: () => customerListApi.get(id),
    enabled: enabled && !!id,
    staleTime: 15_000,
  });
}

export function useListCampaignsQuery(listId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.listCampaigns(listId),
    queryFn: () => customerListApi.campaigns(listId),
    enabled: enabled && !!listId,
    // Poll while any run for this list is in flight.
    refetchInterval: query => {
      const rows = query.state.data;
      const active = Array.isArray(rows) && rows.some(c => c.status === 'running' || c.status === 'paused');
      return active ? 3000 : false;
    },
  });
}

export function useImportListMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ImportListPayload) => customerListApi.import(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.customerLists });
    },
  });
}

export function useUpdateListMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (params: { id: string; data: { name?: string; description?: string } }) =>
      customerListApi.update(params.id, params.data),
    onSuccess: (_result, params) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.customerLists });
      void queryClient.invalidateQueries({ queryKey: queryKeys.customerList(params.id) });
    },
  });
}

export function useDeleteListMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => customerListApi.delete(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.customerLists });
    },
  });
}

// ── Campaign Queries ──────────────────────────────────────────────────

export function useCampaignsQuery(listId?: string) {
  return useQuery({
    queryKey: queryKeys.campaigns(listId),
    queryFn: () => campaignApi.list(listId),
    refetchInterval: query => {
      const rows = query.state.data;
      const active = Array.isArray(rows) && rows.some(c => c.status === 'running' || c.status === 'paused');
      return active ? 3000 : false;
    },
  });
}

export function useCampaignQuery(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.campaign(id),
    queryFn: () => campaignApi.get(id),
    enabled: enabled && !!id,
    // Live-poll the per-recipient status table while the run is active.
    refetchInterval: query => {
      const c = query.state.data as Campaign | undefined;
      return c && (c.status === 'running' || c.status === 'paused') ? 2000 : false;
    },
  });
}

function invalidateCampaignViews(queryClient: ReturnType<typeof useQueryClient>, listId?: string | null) {
  void queryClient.invalidateQueries({ queryKey: ['campaigns'] });
  void queryClient.invalidateQueries({ queryKey: queryKeys.customerLists });
  if (listId) void queryClient.invalidateQueries({ queryKey: queryKeys.listCampaigns(listId) });
}

export function useCreateCampaignMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateCampaignPayload) => campaignApi.create(data),
    onSuccess: result => invalidateCampaignViews(queryClient, result.listId),
  });
}

export function usePauseCampaignMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => campaignApi.pause(id),
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.campaign(result.id) });
      invalidateCampaignViews(queryClient, result.listId);
    },
  });
}

export function useResumeCampaignMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => campaignApi.resume(id),
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.campaign(result.id) });
      invalidateCampaignViews(queryClient, result.listId);
    },
  });
}

export function useCancelCampaignMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => campaignApi.cancel(id),
    onSuccess: result => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.campaign(result.id) });
      invalidateCampaignViews(queryClient, result.listId);
    },
  });
}

export function useDeleteCampaignMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => campaignApi.delete(id),
    onSuccess: () => invalidateCampaignViews(queryClient),
  });
}
