import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Plus, Edit, Trash2, Play, Power, Workflow as WorkflowIcon, Loader2, X, Check, AlertTriangle } from 'lucide-react';
import { flowApi, type Flow, type FlowScope, type FlowDryRunResult } from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useFlowsQuery, useSessionsQuery, useSetFlowEnabledMutation, useDeleteFlowMutation } from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import './MessagingFlow.css';

export function MessagingFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t('messagingFlow.title'));
  const { canWrite } = useRole();

  const { data: flows = [], isLoading } = useFlowsQuery();
  const { data: sessions = [] } = useSessionsQuery();
  const enabledMutation = useSetFlowEnabledMutation();
  const deleteMutation = useDeleteFlowMutation();

  const [deleteTarget, setDeleteTarget] = useState<Flow | null>(null);
  const [testResult, setTestResult] = useState<{ flow: Flow; result: FlowDryRunResult } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const sessionName = (id: string) => sessions.find(s => s.id === id)?.name || `${id.substring(0, 8)}…`;

  const triggerSummary = (flow: Flow): string => {
    const tr = flow.triggers?.[0];
    if (!tr) return t('messagingFlow.triggerSummary.none');
    switch (tr.matchType) {
      case 'exact':
        return t('messagingFlow.triggerSummary.exact', { keywords: (tr.keywords ?? []).join(', ') });
      case 'contains':
        return t('messagingFlow.triggerSummary.contains', { keywords: (tr.keywords ?? []).join(', ') });
      case 'welcome':
        return t('messagingFlow.triggerSummary.welcome');
      case 'default':
        return t('messagingFlow.triggerSummary.default');
      default:
        return t('messagingFlow.triggerSummary.any');
    }
  };

  const scopeSummary = (scope: FlowScope): string => {
    if (!scope || scope.type === 'all') return t('messagingFlow.scope.all');
    if ((scope.sessionIds?.length ?? 0) === 1) return sessionName(scope.sessionIds![0]);
    return t('messagingFlow.scope.count', { count: scope.sessionIds?.length ?? 0 });
  };

  const handleToggle = async (flow: Flow) => {
    try {
      await enabledMutation.mutateAsync({ id: flow.id, enabled: !flow.enabled });
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : t('common.unknownError') });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setDeleteTarget(null);
      setToast({ type: 'success', message: t('messagingFlow.toasts.deleted') });
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : t('common.unknownError') });
    }
  };

  const handleTest = async (flow: Flow) => {
    setTestingId(flow.id);
    try {
      const tr = flow.triggers?.[0];
      const body =
        tr && (tr.matchType === 'exact' || tr.matchType === 'contains') && tr.keywords?.length
          ? tr.keywords[0]
          : 'hello';
      const sessionId =
        flow.scope?.type === 'all' ? sessions[0]?.id || 'preview' : flow.scope?.sessionIds?.[0] || 'preview';
      const result = await flowApi.test(flow.id, { sessionId, from: 'preview@c.us', body });
      setTestResult({ flow, result });
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : t('common.unknownError') });
    } finally {
      setTestingId(null);
    }
  };

  if (isLoading) {
    return (
      <div
        className="messaging-flow-page"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="messaging-flow-page">
      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.type === 'success' ? <Check size={18} /> : <AlertTriangle size={18} />}
          <span>{toast.message}</span>
          <button className="toast-close" onClick={() => setToast(null)}>
            <X size={16} />
          </button>
        </div>
      )}

      <PageHeader
        title={t('messagingFlow.title')}
        subtitle={t('messagingFlow.subtitle')}
        actions={
          canWrite && (
            <button className="btn-primary" onClick={() => navigate('/messaging-flow/new/builder')}>
              <Plus size={18} />
              {t('messagingFlow.addFlow')}
            </button>
          )
        }
      />

      {deleteTarget && (
        <div className="modal-overlay" onClick={() => setDeleteTarget(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('messagingFlow.deleteTitle')}</h2>
              <button className="btn-icon" onClick={() => setDeleteTarget(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p>{t('messagingFlow.deleteConfirm', { name: deleteTarget.name })}</p>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setDeleteTarget(null)}>
                {t('common.cancel')}
              </button>
              <button className="btn-danger" onClick={handleDelete}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {testResult && (
        <div className="modal-overlay" onClick={() => setTestResult(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('messagingFlow.testTitle', { name: testResult.flow.name })}</h2>
              <button className="btn-icon" onClick={() => setTestResult(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {!testResult.result.matchedFlow ? (
                <p className="test-nomatch">{t('messagingFlow.test.noMatch')}</p>
              ) : (
                <>
                  <div className="test-status">
                    <span className={`status-badge ${testResult.result.status === 'completed' ? 'active' : 'inactive'}`}>
                      {t(`messagingFlow.runStatus.${testResult.result.status}`, { defaultValue: testResult.result.status })}
                    </span>
                  </div>
                  <label>{t('messagingFlow.test.preview')}</label>
                  <div className="wa-preview">
                    {testResult.result.outbound.length === 0 ? (
                      <span className="wa-empty">{t('messagingFlow.test.noOutbound')}</span>
                    ) : (
                      testResult.result.outbound.map((o, i) => (
                        <div key={i} className="wa-bubble">
                          {o.kind !== 'text' && <span className="wa-kind">[{o.kind}]</span>}
                          <span>{o.text || o.caption || o.media}</span>
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setTestResult(null)}>
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="messaging-flow-content">
        <div className="messaging-flow-table">
          <div className="table-row header">
            <span>{t('messagingFlow.columns.name')}</span>
            <span>{t('messagingFlow.columns.trigger')}</span>
            <span>{t('messagingFlow.columns.scope')}</span>
            <span>{t('messagingFlow.columns.status')}</span>
            <span>{t('messagingFlow.columns.actions')}</span>
          </div>
          {flows.length === 0 ? (
            <div className="empty-table-state">
              <WorkflowIcon size={48} strokeWidth={1} />
              <h3>{t('messagingFlow.empty.title')}</h3>
              <p>{t('messagingFlow.empty.description')}</p>
            </div>
          ) : (
            flows.map(flow => (
              <div key={flow.id} className="table-row">
                <span className="name-cell">{flow.name}</span>
                <span className="trigger-cell">{triggerSummary(flow)}</span>
                <span className="scope-cell">{scopeSummary(flow.scope)}</span>
                <span>
                  <span className={`status-badge ${flow.enabled ? 'active' : 'inactive'}`}>
                    {flow.enabled ? t('common.active') : t('common.inactive')}
                  </span>
                </span>
                <span className="actions-cell">
                  <button
                    className="icon-btn"
                    title={t('messagingFlow.actions.test')}
                    onClick={() => handleTest(flow)}
                    disabled={testingId === flow.id}
                  >
                    {testingId === flow.id ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                  </button>
                  {canWrite && (
                    <>
                      <button
                        className="icon-btn"
                        title={flow.enabled ? t('messagingFlow.actions.disable') : t('messagingFlow.actions.enable')}
                        onClick={() => handleToggle(flow)}
                      >
                        <Power size={16} className={flow.enabled ? 'power-on' : ''} />
                      </button>
                      <button
                        className="icon-btn"
                        title={t('common.edit')}
                        onClick={() => navigate(`/messaging-flow/${flow.id}/builder`)}
                      >
                        <Edit size={16} />
                      </button>
                      <button className="icon-btn danger" title={t('common.delete')} onClick={() => setDeleteTarget(flow)}>
                        <Trash2 size={16} />
                      </button>
                    </>
                  )}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
