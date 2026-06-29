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
  Volume2,
} from 'lucide-react';
import { type GroupLeaveRule, type WaGroup, type GroupEvent, groupLeaveApi } from '../services/api';
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

type AudioMode = 'url' | 'upload';

interface RuleForm {
  sessionId: string;
  event: GroupEvent;
  groupId: string;
  groupName: string;
  audioMode: AudioMode;
  audioUrl: string;
  audioStorageKey: string;
  audioMimetype: string;
  audioFilename: string;
  sendAsVoice: boolean;
  delaySeconds: number;
  enabled: boolean;
}

const emptyForm: RuleForm = {
  sessionId: '',
  event: 'leave',
  groupId: '',
  groupName: '',
  audioMode: 'url',
  audioUrl: '',
  audioStorageKey: '',
  audioMimetype: '',
  audioFilename: '',
  sendAsVoice: true,
  delaySeconds: 0,
  enabled: true,
};

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

  // Groups for the session selected in the open modal (only fetched while a modal is open).
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

  // Disambiguate same-named groups: show type (Community vs Group) + member count.
  const groupLabel = (g: WaGroup): string => {
    const type = g.isCommunity
      ? t('groupLeave.form.typeCommunity')
      : g.isCommunitySubGroup
        ? t('groupLeave.form.typeCommunityGroup')
        : t('groupLeave.form.typeGroup');
    const parts = [type];
    if (typeof g.participantsCount === 'number') {
      parts.push(t('groupLeave.form.members', { count: g.participantsCount }));
    }
    return `${g.name || g.id} — ${parts.join(' · ')}`;
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
      audioMode: rule.audioStorageKey ? 'upload' : 'url',
      audioUrl: rule.audioUrl || '',
      audioStorageKey: rule.audioStorageKey || '',
      audioMimetype: rule.audioMimetype || '',
      audioFilename: rule.audioFilename || '',
      sendAsVoice: rule.sendAsVoice,
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

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const res = await groupLeaveApi.uploadAudio(file);
      setForm(f => ({
        ...f,
        audioStorageKey: res.storageKey,
        audioMimetype: res.mimetype,
        audioFilename: res.filename,
        audioUrl: '',
      }));
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

  // Shared rule fields WITHOUT sessionId (the update DTO rejects sessionId; create adds it).
  const buildPayload = () => {
    const base = {
      event: form.event,
      groupId: form.groupId,
      groupName: form.groupName || undefined,
      sendAsVoice: form.sendAsVoice,
      delaySeconds: form.delaySeconds,
      enabled: form.enabled,
    };
    if (form.audioMode === 'upload') {
      return {
        ...base,
        audioStorageKey: form.audioStorageKey,
        audioMimetype: form.audioMimetype || undefined,
        audioFilename: form.audioFilename || undefined,
        audioUrl: '',
      };
    }
    return {
      ...base,
      audioUrl: form.audioUrl.trim(),
      audioStorageKey: '',
    };
  };

  const hasAudio = form.audioMode === 'upload' ? !!form.audioStorageKey : !!form.audioUrl.trim();
  const canSubmit = !!form.sessionId && !!form.groupId && hasAudio && !uploading;

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

  const audioLabel = (rule: GroupLeaveRule) =>
    rule.audioFilename || rule.audioUrl || rule.audioStorageKey || '—';

  const renderAudioFields = () => (
    <>
      <label>{t('groupLeave.form.audio')}</label>
      <div className="audio-mode-toggle">
        <button
          type="button"
          className={form.audioMode === 'url' ? 'active' : ''}
          onClick={() => setForm(f => ({ ...f, audioMode: 'url' }))}
        >
          <LinkIcon size={14} /> {t('groupLeave.form.audioUrlMode')}
        </button>
        <button
          type="button"
          className={form.audioMode === 'upload' ? 'active' : ''}
          onClick={() => setForm(f => ({ ...f, audioMode: 'upload' }))}
        >
          <Upload size={14} /> {t('groupLeave.form.audioUploadMode')}
        </button>
      </div>

      {form.audioMode === 'url' ? (
        <input
          type="url"
          placeholder="https://…/goodbye.mp3"
          value={form.audioUrl}
          onChange={e => setForm(f => ({ ...f, audioUrl: e.target.value }))}
        />
      ) : (
        <div className="audio-upload">
          <label className="file-drop">
            <input
              type="file"
              accept="audio/*"
              hidden
              onChange={e => {
                void handleFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            {uploading ? (
              <>
                <Loader2 size={16} className="animate-spin" /> {t('groupLeave.form.uploading')}
              </>
            ) : (
              <>
                <Upload size={16} /> {form.audioFilename || t('groupLeave.form.chooseFile')}
              </>
            )}
          </label>
        </div>
      )}

      <div className="toggle-group">
        <span className="toggle-label">{t('groupLeave.form.sendAsVoice')}</span>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={form.sendAsVoice}
            onChange={e => setForm(f => ({ ...f, sendAsVoice: e.target.checked }))}
          />
          <span className="toggle-slider"></span>
        </label>
        <span className="toggle-status active">
          {form.sendAsVoice ? t('groupLeave.form.voiceNote') : t('groupLeave.form.audioFile')}
        </span>
      </div>
    </>
  );

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
                    onChange={e =>
                      setForm(f => ({ ...f, sessionId: e.target.value, groupId: '', groupName: '' }))
                    }
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

              {renderAudioFields()}

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
              <button
                className="btn-primary"
                onClick={showEdit ? handleEdit : handleCreate}
                disabled={!canSubmit}
              >
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
            <span>{t('groupLeave.columns.audio')}</span>
            <span>{t('groupLeave.columns.delivery')}</span>
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
                <span className="audio-cell">
                  <code title={audioLabel(rule)}>{audioLabel(rule)}</code>
                </span>
                <span>
                  <span className="delivery-badge">
                    <Volume2 size={13} />
                    {rule.sendAsVoice ? t('groupLeave.form.voiceNote') : t('groupLeave.form.audioFile')}
                  </span>
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
