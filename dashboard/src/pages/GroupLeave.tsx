import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  Edit,
  Trash2,
  Loader2,
  X,
  Check,
  AlertTriangle,
  UserMinus,
  Upload,
  Link as LinkIcon,
  MessageSquare,
} from 'lucide-react';
import {
  type GroupLeaveRule,
  type WaGroup,
  type GroupEvent,
  type MediaKind,
  groupLeaveApi,
} from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import {
  useGroupLeaveRulesQuery,
  useSessionsQuery,
  useSessionGroupsQuery,
  useCreateGroupLeaveRuleMutation,
  useUpdateGroupLeaveRuleMutation,
  useDeleteGroupLeaveRuleMutation,
} from '../hooks/queries';
import { PageHeader } from '../components/PageHeader';
import './GroupLeave.css';

interface MediaItemForm {
  kind: MediaKind;
  text?: string;
  url?: string;
  storageKey?: string;
  mimetype?: string;
  filename?: string;
  caption?: string;
  asVoice?: boolean;
}

interface RuleForm {
  sessionId: string;
  event: GroupEvent;
  groupId: string;
  groupName: string;
  media: MediaItemForm[];
  delaySeconds: number;
  enabled: boolean;
}

const emptyForm: RuleForm = {
  sessionId: '',
  event: 'leave',
  groupId: '',
  groupName: '',
  media: [],
  delaySeconds: 0,
  enabled: true,
};

// Map a rule's stored media (or legacy single-audio fields) into editable form items.
function ruleToMediaForm(rule: GroupLeaveRule): MediaItemForm[] {
  if (rule.media?.length) {
    return rule.media.map(m => ({
      kind: m.kind,
      text: m.text || undefined,
      url: m.url || undefined,
      storageKey: m.storageKey || undefined,
      mimetype: m.mimetype || undefined,
      filename: m.filename || undefined,
      caption: m.caption || undefined,
      asVoice: m.asVoice,
    }));
  }
  if (rule.audioStorageKey || rule.audioUrl) {
    return [
      {
        kind: 'audio',
        url: rule.audioUrl || undefined,
        storageKey: rule.audioStorageKey || undefined,
        mimetype: rule.audioMimetype || undefined,
        filename: rule.audioFilename || undefined,
        asVoice: rule.sendAsVoice,
      },
    ];
  }
  return [];
}

export function GroupLeave() {
  const { t } = useTranslation();
  useDocumentTitle(t('groupLeave.title'));
  const { canWrite } = useRole();

  const { data: rules = [], isLoading } = useGroupLeaveRulesQuery();
  const { data: sessions = [] } = useSessionsQuery();
  const createMutation = useCreateGroupLeaveRuleMutation();
  const updateMutation = useUpdateGroupLeaveRuleMutation();
  const deleteMutation = useDeleteGroupLeaveRuleMutation();

  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [form, setForm] = useState<RuleForm>(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GroupLeaveRule | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const {
    data: groups = [],
    isError: groupsError,
    isLoading: groupsLoading,
  } = useSessionGroupsQuery(form.sessionId, (showCreate || showEdit) && !!form.sessionId);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const sessionName = (id: string) => sessions.find(s => s.id === id)?.name || id.substring(0, 8);

  const groupLabel = (g: WaGroup): string => {
    const type = g.isCommunity
      ? t('groupLeave.form.typeCommunity')
      : g.isCommunitySubGroup
        ? t('groupLeave.form.typeCommunityGroup')
        : t('groupLeave.form.typeGroup');
    const parts = [type];
    if (typeof g.participantsCount === 'number') parts.push(t('groupLeave.form.members', { count: g.participantsCount }));
    return `${g.name || g.id} — ${parts.join(' · ')}`;
  };

  const mediaSummary = (rule: GroupLeaveRule): string => {
    const items = ruleToMediaForm(rule);
    if (items.length === 0) return '—';
    const counts: Partial<Record<MediaKind, number>> = {};
    items.forEach(m => {
      counts[m.kind] = (counts[m.kind] || 0) + 1;
    });
    return (Object.entries(counts) as [MediaKind, number][]).map(([k, n]) => `${n} ${k}`).join(', ');
  };

  const openCreate = () => {
    setForm(emptyForm);
    setShowCreate(true);
  };

  const openEdit = (rule: GroupLeaveRule) => {
    setEditId(rule.id);
    setForm({
      sessionId: rule.sessionId,
      event: rule.event,
      groupId: rule.groupId,
      groupName: rule.groupName || '',
      media: ruleToMediaForm(rule),
      delaySeconds: rule.delaySeconds,
      enabled: rule.enabled,
    });
    setShowEdit(true);
  };

  const closeModals = () => {
    setShowCreate(false);
    setShowEdit(false);
    setEditId(null);
    setForm(emptyForm);
  };

  // ── media item helpers ───────────────────────────────────────────────
  const addUrlItem = () =>
    setForm(f => ({ ...f, media: [...f.media, { kind: 'audio', url: '', asVoice: true }] }));

  const addTextItem = () => setForm(f => ({ ...f, media: [...f.media, { kind: 'text', text: '' }] }));

  const updateItem = (index: number, patch: Partial<MediaItemForm>) =>
    setForm(f => ({ ...f, media: f.media.map((m, i) => (i === index ? { ...m, ...patch } : m)) }));

  const removeItem = (index: number) => setForm(f => ({ ...f, media: f.media.filter((_, i) => i !== index) }));

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const res = await groupLeaveApi.uploadMedia(file);
        setForm(f => ({
          ...f,
          media: [
            ...f.media,
            {
              kind: res.kind,
              storageKey: res.storageKey,
              mimetype: res.mimetype,
              filename: res.filename,
              asVoice: res.kind === 'audio',
            },
          ],
        }));
      }
      setToast({ type: 'success', message: t('groupLeave.toasts.uploaded') });
    } catch (err) {
      setToast({
        type: 'error',
        message: t('groupLeave.toasts.uploadFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      });
    } finally {
      setUploading(false);
    }
  };

  const buildPayload = () => ({
    event: form.event,
    groupId: form.groupId,
    groupName: form.groupName || undefined,
    delaySeconds: form.delaySeconds,
    enabled: form.enabled,
    media: form.media.map(m =>
      m.kind === 'text'
        ? { kind: 'text' as const, text: m.text?.trim() || undefined }
        : {
            kind: m.kind,
            url: m.storageKey ? undefined : m.url?.trim() || undefined,
            storageKey: m.storageKey || undefined,
            mimetype: m.mimetype || undefined,
            filename: m.filename || undefined,
            caption: m.kind === 'audio' ? undefined : m.caption || undefined,
            asVoice: m.kind === 'audio' ? (m.asVoice ?? true) : undefined,
          },
    ),
  });

  const isItemReady = (m: MediaItemForm) =>
    m.kind === 'text' ? !!m.text && m.text.trim().length > 0 : !!m.storageKey || !!(m.url && m.url.trim());
  const hasMedia = form.media.length > 0 && form.media.every(isItemReady);
  const canSubmit = !!form.sessionId && !!form.groupId && hasMedia && !uploading;

  const handleCreate = async () => {
    if (!canSubmit) return;
    try {
      await createMutation.mutateAsync({ sessionId: form.sessionId, ...buildPayload() });
      closeModals();
      setToast({ type: 'success', message: t('groupLeave.toasts.created') });
    } catch (err) {
      setToast({
        type: 'error',
        message: t('groupLeave.toasts.createFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      });
    }
  };

  const handleEdit = async () => {
    if (!editId || !canSubmit) return;
    try {
      await updateMutation.mutateAsync({ id: editId, data: buildPayload() });
      closeModals();
      setToast({ type: 'success', message: t('groupLeave.toasts.updated') });
    } catch (err) {
      setToast({
        type: 'error',
        message: t('groupLeave.toasts.updateFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      setShowDelete(false);
      setDeleteTarget(null);
      setToast({ type: 'success', message: t('groupLeave.toasts.deleted') });
    } catch (err) {
      setToast({
        type: 'error',
        message: t('groupLeave.toasts.deleteFailed', {
          message: err instanceof Error ? err.message : t('common.unknownError'),
        }),
      });
    }
  };

  const renderEventSelect = () => (
    <>
      <label>{t('groupLeave.form.event')}</label>
      <select value={form.event} onChange={e => setForm(f => ({ ...f, event: e.target.value as GroupEvent }))}>
        <option value="leave">{t('groupLeave.form.eventLeave')}</option>
        <option value="join">{t('groupLeave.form.eventJoin')}</option>
      </select>
    </>
  );

  const renderDelayInput = () => (
    <>
      <label>{t('groupLeave.form.delay')}</label>
      <input
        type="number"
        min={0}
        max={600}
        value={form.delaySeconds}
        onChange={e =>
          setForm(f => ({ ...f, delaySeconds: Math.max(0, Math.min(600, Math.floor(Number(e.target.value) || 0))) }))
        }
      />
      <p className="field-hint">{t('groupLeave.form.delayHelp')}</p>
    </>
  );

  const renderGroupSelect = () => (
    <>
      <label>{t('groupLeave.form.group')}</label>
      <select
        value={form.groupId}
        onChange={e => {
          const g = groups.find(x => x.id === e.target.value);
          setForm(f => ({ ...f, groupId: e.target.value, groupName: g?.name || '' }));
        }}
        disabled={!form.sessionId || groupsLoading}
      >
        <option value="">{t('groupLeave.form.selectGroup')}</option>
        {form.groupId && !groups.some(g => g.id === form.groupId) && (
          <option value={form.groupId}>{form.groupName || form.groupId}</option>
        )}
        {groups.map(g => (
          <option key={g.id} value={g.id}>
            {groupLabel(g)}
          </option>
        ))}
      </select>
      {groupsLoading && <p className="field-hint">{t('groupLeave.form.loadingGroups')}</p>}
      {groupsError && <p className="field-hint error">{t('groupLeave.form.groupsError')}</p>}
    </>
  );

  const renderMediaEditor = () => (
    <>
      <label>{t('groupLeave.form.media')}</label>
      {form.media.length === 0 && <p className="field-hint">{t('groupLeave.form.noMedia')}</p>}
      <div className="media-list">
        {form.media.map((m, i) => (
          <div key={i} className="media-item">
            <div className="media-item-head">
              <select
                className="media-kind"
                value={m.kind}
                onChange={e => updateItem(i, { kind: e.target.value as MediaKind })}
              >
                <option value="text">{t('groupLeave.form.kindText')}</option>
                <option value="audio">{t('groupLeave.form.kindAudio')}</option>
                <option value="video">{t('groupLeave.form.kindVideo')}</option>
                <option value="image">{t('groupLeave.form.kindImage')}</option>
                <option value="document">{t('groupLeave.form.kindDocument')}</option>
              </select>
              {m.kind === 'text' ? (
                <span className="media-file">{t('groupLeave.form.textMessage')}</span>
              ) : m.storageKey ? (
                <span className="media-file" title={m.filename || ''}>
                  {m.filename || t('groupLeave.form.uploadedFile')}
                </span>
              ) : (
                <input
                  className="media-url"
                  type="url"
                  placeholder="https://…"
                  value={m.url || ''}
                  onChange={e => updateItem(i, { url: e.target.value })}
                />
              )}
              <button type="button" className="icon-btn danger" title={t('common.delete')} onClick={() => removeItem(i)}>
                <X size={14} />
              </button>
            </div>
            {m.kind === 'text' ? (
              <textarea
                className="media-text"
                rows={2}
                placeholder={t('groupLeave.form.textPlaceholder')}
                value={m.text || ''}
                onChange={e => updateItem(i, { text: e.target.value })}
              />
            ) : m.kind === 'audio' ? (
              <label className="media-voice">
                <input
                  type="checkbox"
                  checked={m.asVoice ?? true}
                  onChange={e => updateItem(i, { asVoice: e.target.checked })}
                />
                {t('groupLeave.form.sendAsVoice')}
              </label>
            ) : (
              <input
                className="media-caption"
                type="text"
                placeholder={t('groupLeave.form.captionPlaceholder')}
                value={m.caption || ''}
                onChange={e => updateItem(i, { caption: e.target.value })}
              />
            )}
          </div>
        ))}
      </div>
      <div className="media-actions">
        <label className="btn-secondary file-btn">
          {uploading ? (
            <>
              <Loader2 size={14} className="animate-spin" /> {t('groupLeave.form.uploading')}
            </>
          ) : (
            <>
              <Upload size={14} /> {t('groupLeave.form.addFile')}
            </>
          )}
          <input
            type="file"
            accept="audio/*,video/*,image/*"
            multiple
            hidden
            onChange={e => {
              void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <button type="button" className="btn-secondary" onClick={addUrlItem}>
          <LinkIcon size={14} /> {t('groupLeave.form.addUrl')}
        </button>
        <button type="button" className="btn-secondary" onClick={addTextItem}>
          <MessageSquare size={14} /> {t('groupLeave.form.addText')}
        </button>
      </div>
    </>
  );

  if (isLoading) {
    return (
      <div
        className="group-leave-page"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '400px' }}
      >
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="group-leave-page">
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
        title={t('groupLeave.title')}
        subtitle={t('groupLeave.subtitle')}
        actions={
          canWrite && (
            <button className="btn-primary" onClick={openCreate}>
              <Plus size={18} />
              {t('groupLeave.addRule')}
            </button>
          )
        }
      />

      {/* Create / Edit modal */}
      {(showCreate || showEdit) && (
        <div className="modal-overlay" onClick={closeModals}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{showEdit ? t('groupLeave.editTitle') : t('groupLeave.createTitle')}</h2>
              <button className="btn-icon" onClick={closeModals}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              {renderEventSelect()}
              {showEdit ? (
                <>
                  <label>{t('groupLeave.form.session')}</label>
                  <div className="readonly-field">{sessionName(form.sessionId)}</div>
                  <label>{t('groupLeave.form.group')}</label>
                  <div className="readonly-field">{form.groupName || form.groupId}</div>
                </>
              ) : (
                <>
                  <label>{t('groupLeave.form.session')}</label>
                  <select
                    value={form.sessionId}
                    onChange={e => setForm(f => ({ ...f, sessionId: e.target.value, groupId: '', groupName: '' }))}
                  >
                    <option value="">{t('groupLeave.form.selectSession')}</option>
                    {sessions.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  {renderGroupSelect()}
                </>
              )}

              {renderMediaEditor()}

              {renderDelayInput()}

              {showEdit && (
                <div className="toggle-group">
                  <span className="toggle-label">{t('common.status')}</span>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={form.enabled}
                      onChange={e => setForm(f => ({ ...f, enabled: e.target.checked }))}
                    />
                    <span className="toggle-slider"></span>
                  </label>
                  <span className={`toggle-status ${form.enabled ? 'active' : 'inactive'}`}>
                    {form.enabled ? t('common.active') : t('common.inactive')}
                  </span>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeModals}>
                {t('common.cancel')}
              </button>
              <button className="btn-primary" onClick={showEdit ? handleEdit : handleCreate} disabled={!canSubmit}>
                {showEdit ? t('webhooks.saveChanges') : t('common.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {showDelete && deleteTarget && (
        <div className="modal-overlay" onClick={() => setShowDelete(false)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t('groupLeave.deleteTitle')}</h2>
              <button className="btn-icon" onClick={() => setShowDelete(false)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <p>{t('groupLeave.deleteConfirm')}</p>
              <code className="delete-target">{deleteTarget.groupName || deleteTarget.groupId}</code>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowDelete(false)}>
                {t('common.cancel')}
              </button>
              <button className="btn-danger" onClick={handleDelete}>
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="group-leave-table-container">
        <div className="group-leave-table">
          <div className="table-row header">
            <span>{t('groupLeave.columns.event')}</span>
            <span>{t('groupLeave.columns.group')}</span>
            <span>{t('groupLeave.columns.session')}</span>
            <span>{t('groupLeave.columns.media')}</span>
            <span>{t('groupLeave.columns.status')}</span>
            <span>{t('groupLeave.columns.actions')}</span>
          </div>
          {rules.length === 0 ? (
            <div className="empty-table-state">
              <UserMinus size={48} strokeWidth={1} />
              <h3>{t('groupLeave.empty.title')}</h3>
              <p>{t('groupLeave.empty.description')}</p>
            </div>
          ) : (
            rules.map(rule => (
              <div key={rule.id} className="table-row">
                <span>
                  <span className={`event-badge ${rule.event}`}>
                    {rule.event === 'join' ? t('groupLeave.form.eventJoin') : t('groupLeave.form.eventLeave')}
                  </span>
                </span>
                <span className="group-cell">{rule.groupName || rule.groupId}</span>
                <span>{sessionName(rule.sessionId)}</span>
                <span className="media-cell">
                  {mediaSummary(rule)}
                  {rule.delaySeconds > 0 && (
                    <span className="delay-tag">{t('groupLeave.form.delayTag', { count: rule.delaySeconds })}</span>
                  )}
                </span>
                <span>
                  <span className={`status-badge ${rule.enabled ? 'active' : 'inactive'}`}>
                    {rule.enabled ? t('common.active') : t('common.inactive')}
                  </span>
                </span>
                <span className="actions-cell">
                  {canWrite && (
                    <>
                      <button className="icon-btn" title={t('common.edit')} onClick={() => openEdit(rule)}>
                        <Edit size={16} />
                      </button>
                      <button
                        className="icon-btn danger"
                        title={t('common.delete')}
                        onClick={() => {
                          setDeleteTarget(rule);
                          setShowDelete(true);
                        }}
                      >
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
