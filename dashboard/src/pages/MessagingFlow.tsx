import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Edit,
  Trash2,
  Play,
  Power,
  Workflow as WorkflowIcon,
  PenTool,
  Loader2,
  X,
  Check,
  AlertTriangle,
} from 'lucide-react';
import {
  flowApi,
  type Flow,
  type FlowGraph,
  type FlowNode,
  type FlowScope,
  type FlowScopeType,
  type TriggerMatchType,
  type SaveFlowPayload,
  type FlowDryRunResult,
} from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import {
  useFlowsQuery,
  useSessionsQuery,
  useCreateFlowMutation,
  useUpdateFlowMutation,
  useSetFlowEnabledMutation,
  useDeleteFlowMutation,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import './MessagingFlow.css';

type ReplyKind = 'text' | 'image' | 'audio';

interface FlowForm {
  name: string;
  scopeType: FlowScopeType;
  sessionIds: string[];
  triggerType: TriggerMatchType;
  keywords: string;
  replyKind: ReplyKind;
  replyText: string;
  replyMediaUrl: string;
  replyCaption: string;
  escapeKeyword: string;
}

const emptyForm: FlowForm = {
  name: '',
  scopeType: 'all',
  sessionIds: [],
  triggerType: 'any',
  keywords: '',
  replyKind: 'text',
  replyText: '',
  replyMediaUrl: '',
  replyCaption: '',
  escapeKeyword: '',
};

const splitKeywords = (s: string): string[] =>
  s
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

/** Build a simple linear graph: trigger → send_* → end. */
function buildGraph(form: FlowForm): FlowGraph {
  const trigger: FlowNode = {
    id: 'trigger',
    type: 'trigger',
    position: { x: 80, y: 120 },
    data: {
      matchType: form.triggerType,
      keywords: form.triggerType === 'exact' || form.triggerType === 'contains' ? splitKeywords(form.keywords) : [],
    },
  };
  let reply: FlowNode;
  if (form.replyKind === 'text') {
    reply = { id: 'reply', type: 'send_text', position: { x: 360, y: 120 }, data: { text: form.replyText } };
  } else if (form.replyKind === 'image') {
    reply = {
      id: 'reply',
      type: 'send_image',
      position: { x: 360, y: 120 },
      data: { mediaUrl: form.replyMediaUrl, caption: form.replyCaption || undefined },
    };
  } else {
    reply = { id: 'reply', type: 'send_audio', position: { x: 360, y: 120 }, data: { mediaUrl: form.replyMediaUrl } };
  }
  const end: FlowNode = { id: 'end', type: 'end', position: { x: 620, y: 120 }, data: {} };
  return {
    nodes: [trigger, reply, end],
    edges: [
      { id: 'e1', source: 'trigger', target: 'reply' },
      { id: 'e2', source: 'reply', target: 'end' },
    ],
  };
}

const COMPLEX_TYPES = ['buttons', 'wait_for_reply', 'condition', 'jump', 'set_variable', 'delay'];

/** Reverse of buildGraph: returns a form if the flow is a simple linear auto-reply, else null. */
function parseSimpleFlow(flow: Flow): FlowForm | null {
  const nodes = flow.graph?.nodes ?? [];
  const trigger = nodes.find(n => n.type === 'trigger');
  const sends = nodes.filter(n => n.type === 'send_text' || n.type === 'send_image' || n.type === 'send_audio');
  const hasComplex = nodes.some(n => COMPLEX_TYPES.includes(n.type));
  if (!trigger || sends.length > 1 || hasComplex) return null;

  const reply = sends[0];
  const td = trigger.data as { matchType?: TriggerMatchType; keywords?: string[] };
  const form: FlowForm = {
    ...emptyForm,
    name: flow.name,
    scopeType: flow.scope?.type ?? 'all',
    sessionIds: flow.scope?.sessionIds ?? [],
    triggerType: td.matchType ?? 'any',
    keywords: (td.keywords ?? []).join(', '),
    escapeKeyword: flow.escapeKeyword ?? '',
  };
  if (reply) {
    const rd = reply.data as { text?: string; mediaUrl?: string; caption?: string };
    if (reply.type === 'send_text') {
      form.replyKind = 'text';
      form.replyText = rd.text ?? '';
    } else if (reply.type === 'send_image') {
      form.replyKind = 'image';
      form.replyMediaUrl = rd.mediaUrl ?? '';
      form.replyCaption = rd.caption ?? '';
    } else {
      form.replyKind = 'audio';
      form.replyMediaUrl = rd.mediaUrl ?? '';
    }
  }
  return form;
}

export function MessagingFlow() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  useDocumentTitle(t('messagingFlow.title'));
  const { canWrite } = useRole();

  const { data: flows = [], isLoading } = useFlowsQuery();
  const { data: sessions = [] } = useSessionsQuery();
  const createMutation = useCreateFlowMutation();
  const updateMutation = useUpdateFlowMutation();
  const enabledMutation = useSetFlowEnabledMutation();
  const deleteMutation = useDeleteFlowMutation();

  const [showCreate, setShowCreate] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Flow | null>(null);
  const [form, setForm] = useState<FlowForm>(emptyForm);
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
    if (scope.type === 'sessions') return t('messagingFlow.scope.count', { count: scope.sessionIds?.length ?? 0 });
    return sessionName(scope.sessionIds?.[0] ?? '');
  };

  const buildPayload = (): SaveFlowPayload => {
    const scope: FlowScope =
      form.scopeType === 'all'
        ? { type: 'all' }
        : { type: form.scopeType, sessionIds: form.sessionIds };
    return {
      name: form.name.trim(),
      scope,
      graph: buildGraph(form),
      escapeKeyword: form.escapeKeyword.trim() || undefined,
    };
  };

  const formValid = (): boolean => {
    if (!form.name.trim()) return false;
    if ((form.triggerType === 'exact' || form.triggerType === 'contains') && splitKeywords(form.keywords).length === 0)
      return false;
    if (form.replyKind === 'text' && !form.replyText.trim()) return false;
    if ((form.replyKind === 'image' || form.replyKind === 'audio') && !form.replyMediaUrl.trim()) return false;
    if (form.scopeType !== 'all' && form.sessionIds.length === 0) return false;
    return true;
  };

  const openCreate = () => {
    setForm(emptyForm);
    setShowCreate(true);
  };

  const openEdit = (flow: Flow) => {
    const parsed = parseSimpleFlow(flow);
    if (!parsed) {
      // Built in the visual builder — send the operator there instead.
      navigate(`/messaging-flow/${flow.id}/builder`);
      return;
    }
    setForm(parsed);
    setEditId(flow.id);
  };

  const handleCreate = async () => {
    if (!formValid()) return;
    try {
      await createMutation.mutateAsync(buildPayload());
      setShowCreate(false);
      setToast({ type: 'success', message: t('messagingFlow.toasts.created') });
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : t('common.unknownError') });
    }
  };

  const handleUpdate = async () => {
    if (!editId || !formValid()) return;
    try {
      await updateMutation.mutateAsync({ id: editId, data: buildPayload() });
      setEditId(null);
      setToast({ type: 'success', message: t('messagingFlow.toasts.updated') });
    } catch (err) {
      setToast({ type: 'error', message: err instanceof Error ? err.message : t('common.unknownError') });
    }
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

  const editingFlow = editId !== null;

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
            <button className="btn-primary" onClick={openCreate}>
              <Plus size={18} />
              {t('messagingFlow.addFlow')}
            </button>
          )
        }
      />

      {(showCreate || editingFlow) && (
        <FlowFormModal
          title={editingFlow ? t('messagingFlow.editTitle') : t('messagingFlow.createTitle')}
          form={form}
          setForm={setForm}
          sessions={sessions}
          valid={formValid()}
          onCancel={() => {
            setShowCreate(false);
            setEditId(null);
          }}
          onSubmit={editingFlow ? handleUpdate : handleCreate}
          submitLabel={editingFlow ? t('messagingFlow.saveChanges') : t('common.create')}
        />
      )}

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
                  <button
                    className="icon-btn"
                    title={t('messagingFlow.actions.builder')}
                    onClick={() => navigate(`/messaging-flow/${flow.id}/builder`)}
                  >
                    <PenTool size={16} />
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
                      <button className="icon-btn" title={t('common.edit')} onClick={() => openEdit(flow)}>
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

// =============================================================================
// Create / Edit modal
// =============================================================================

interface FlowFormModalProps {
  title: string;
  form: FlowForm;
  setForm: (f: FlowForm) => void;
  sessions: { id: string; name: string }[];
  valid: boolean;
  onCancel: () => void;
  onSubmit: () => void;
  submitLabel: string;
}

function FlowFormModal({ title, form, setForm, sessions, valid, onCancel, onSubmit, submitLabel }: FlowFormModalProps) {
  const { t } = useTranslation();
  const upd = (patch: Partial<FlowForm>) => setForm({ ...form, ...patch });
  const showKeywords = form.triggerType === 'exact' || form.triggerType === 'contains';

  const toggleSession = (id: string) => {
    upd({ sessionIds: form.sessionIds.includes(id) ? form.sessionIds.filter(s => s !== id) : [...form.sessionIds, id] });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onCancel}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">
          <label>{t('messagingFlow.form.name')}</label>
          <input
            type="text"
            placeholder={t('messagingFlow.form.namePlaceholder')}
            value={form.name}
            onChange={e => upd({ name: e.target.value })}
          />

          <label>{t('messagingFlow.form.scope')}</label>
          <select value={form.scopeType} onChange={e => upd({ scopeType: e.target.value as FlowScopeType })}>
            <option value="all">{t('messagingFlow.scope.all')}</option>
            <option value="session">{t('messagingFlow.scope.specific')}</option>
            <option value="sessions">{t('messagingFlow.scope.selected')}</option>
          </select>
          {form.scopeType === 'session' && (
            <select
              value={form.sessionIds[0] ?? ''}
              onChange={e => upd({ sessionIds: e.target.value ? [e.target.value] : [] })}
            >
              <option value="">{t('messagingFlow.form.selectSession')}</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
          {form.scopeType === 'sessions' && (
            <div className="session-checkboxes">
              {sessions.length === 0 && <span className="muted">{t('messagingFlow.form.noSessions')}</span>}
              {sessions.map(s => (
                <label key={s.id} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.sessionIds.includes(s.id)}
                    onChange={() => toggleSession(s.id)}
                  />
                  <span>{s.name}</span>
                </label>
              ))}
            </div>
          )}

          <label>{t('messagingFlow.form.trigger')}</label>
          <select value={form.triggerType} onChange={e => upd({ triggerType: e.target.value as TriggerMatchType })}>
            <option value="any">{t('messagingFlow.triggerType.any')}</option>
            <option value="exact">{t('messagingFlow.triggerType.exact')}</option>
            <option value="contains">{t('messagingFlow.triggerType.contains')}</option>
            <option value="welcome">{t('messagingFlow.triggerType.welcome')}</option>
          </select>
          {showKeywords && (
            <>
              <label>{t('messagingFlow.form.keywords')}</label>
              <input
                type="text"
                placeholder={t('messagingFlow.form.keywordsPlaceholder')}
                value={form.keywords}
                onChange={e => upd({ keywords: e.target.value })}
              />
            </>
          )}

          <label>{t('messagingFlow.form.reply')}</label>
          <select value={form.replyKind} onChange={e => upd({ replyKind: e.target.value as ReplyKind })}>
            <option value="text">{t('messagingFlow.replyKind.text')}</option>
            <option value="image">{t('messagingFlow.replyKind.image')}</option>
            <option value="audio">{t('messagingFlow.replyKind.audio')}</option>
          </select>
          {form.replyKind === 'text' && (
            <textarea
              rows={3}
              placeholder={t('messagingFlow.form.replyTextPlaceholder')}
              value={form.replyText}
              onChange={e => upd({ replyText: e.target.value })}
            />
          )}
          {(form.replyKind === 'image' || form.replyKind === 'audio') && (
            <input
              type="url"
              placeholder={t('messagingFlow.form.mediaUrlPlaceholder')}
              value={form.replyMediaUrl}
              onChange={e => upd({ replyMediaUrl: e.target.value })}
            />
          )}
          {form.replyKind === 'image' && (
            <input
              type="text"
              placeholder={t('messagingFlow.form.captionPlaceholder')}
              value={form.replyCaption}
              onChange={e => upd({ replyCaption: e.target.value })}
            />
          )}

          <label>{t('messagingFlow.form.escapeKeyword')}</label>
          <input
            type="text"
            placeholder={t('messagingFlow.form.escapePlaceholder')}
            value={form.escapeKeyword}
            onChange={e => upd({ escapeKeyword: e.target.value })}
          />
          <p className="form-hint">{t('messagingFlow.form.builderHint')}</p>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button className="btn-primary" onClick={onSubmit} disabled={!valid}>
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
