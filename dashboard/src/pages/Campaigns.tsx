import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Upload,
  Users,
  Send,
  Play,
  Pause,
  Ban,
  Trash2,
  Pencil,
  Download,
  ArrowLeft,
  X,
  Loader2,
  Search,
  FileJson,
  Clock,
} from 'lucide-react';
import type {
  CustomerListSummary,
  CampaignStatus,
  RecipientStatus,
} from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useToast } from '../components/Toast';
import { PageHeader } from '../components/PageHeader';
import {
  useCustomerListsQuery,
  useCustomerListQuery,
  useListCampaignsQuery,
  useCampaignQuery,
  useImportListMutation,
  useUpdateListMutation,
  useDeleteListMutation,
  useCreateCampaignMutation,
  usePauseCampaignMutation,
  useResumeCampaignMutation,
  useCancelCampaignMutation,
  useDeleteCampaignMutation,
} from '../hooks/queries';
import { campaignApi } from '../services/api';
import { useSessionsQuery } from '../hooks/queries';
import './Campaigns.css';

// ── Helpers ─────────────────────────────────────────────────────────────

interface ParsedRow {
  name?: string;
  phone: string;
}

const NAME_KEYS = ['name', 'fullname', 'full_name', 'customername', 'customer', 'contactname', 'title'];
const PHONE_KEYS = [
  'phone',
  'phonenumber',
  'phone_number',
  'mobile',
  'mobilenumber',
  'mobile_number',
  'number',
  'contact',
  'whatsapp',
  'msisdn',
  'tel',
];

/** Tolerantly parse an uploaded/pasted customer JSON into {name, phone} rows. */
function parseCustomers(text: string): ParsedRow[] {
  const data: unknown = JSON.parse(text);
  let arr: unknown[];
  if (Array.isArray(data)) {
    arr = data;
  } else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    const nested = obj.customers ?? obj.recipients ?? obj.data ?? obj.contacts ?? obj.list;
    if (!Array.isArray(nested)) {
      throw new Error('Expected a JSON array of customers, or an object with a "customers" array.');
    }
    arr = nested;
  } else {
    throw new Error('Expected a JSON array of customers.');
  }

  const rows: ParsedRow[] = [];
  for (const item of arr) {
    if (typeof item === 'string' || typeof item === 'number') {
      rows.push({ phone: String(item) });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const lower: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) lower[k.toLowerCase().replace(/\s+/g, '')] = v;

    let phone: string | undefined;
    for (const key of PHONE_KEYS) {
      if (lower[key] !== undefined && lower[key] !== null && String(lower[key]).trim()) {
        phone = String(lower[key]).trim();
        break;
      }
    }
    let name: string | undefined;
    for (const key of NAME_KEYS) {
      if (lower[key] !== undefined && lower[key] !== null && String(lower[key]).trim()) {
        name = String(lower[key]).trim();
        break;
      }
    }
    if (phone) rows.push({ name, phone });
  }
  if (rows.length === 0) {
    throw new Error('No phone numbers found. Each item needs a phone/number field.');
  }
  return rows;
}

/** Default campaign message. `{name}` is replaced per-recipient at send time. */
const DEFAULT_CAMPAIGN_MESSAGE = `Hi {name} 👋

We help restaurants accept direct orders on WhatsApp with seamless Petpooja POS integration.

✅ WhatsApp ordering
✅ Petpooja POS sync (or a separate order dashboard if you don't use Petpooja)
✅ Automatic Porter booking (optional)
✅ Rider app
✅ Loyalty points & discounts

If you'd like to see how it works, just reply here or message/call 7012944024.`;

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** A sortable "YYYY-MM-DD HH:mm" stamp used as the default list name. */
function defaultListName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_META: Record<CampaignStatus, { cls: string }> = {
  draft: { cls: 'muted' },
  running: { cls: 'running' },
  paused: { cls: 'warning' },
  completed: { cls: 'success' },
  cancelled: { cls: 'muted' },
  failed: { cls: 'error' },
};

const RECIPIENT_META: Record<RecipientStatus, { cls: string }> = {
  pending: { cls: 'muted' },
  sent: { cls: 'sent' },
  delivered: { cls: 'delivered' },
  read: { cls: 'success' },
  failed: { cls: 'error' },
  skipped: { cls: 'muted' },
};

// ── Page ────────────────────────────────────────────────────────────────

type View =
  | { kind: 'lists' }
  | { kind: 'list'; listId: string; listName: string }
  | { kind: 'campaign'; campaignId: string; backList?: { id: string; name: string } };

export function Campaigns() {
  const { t } = useTranslation();
  useDocumentTitle(t('campaigns.title'));
  const { canWrite } = useRole();

  const [view, setView] = useState<View>({ kind: 'lists' });
  const [showImport, setShowImport] = useState(false);
  const [sendFor, setSendFor] = useState<{ id: string; name: string } | null>(null);

  return (
    <div className="campaigns-page">
      <PageHeader
        title={t('campaigns.title')}
        subtitle={t('campaigns.subtitle')}
        actions={
          view.kind === 'lists' && canWrite ? (
            <button className="btn-primary" onClick={() => setShowImport(true)}>
              <Upload size={18} />
              {t('campaigns.import.button')}
            </button>
          ) : undefined
        }
      />

      {view.kind !== 'lists' && (
        <button className="cmp-back" onClick={() => setView({ kind: 'lists' })}>
          <ArrowLeft size={16} />
          {t('campaigns.backToLists')}
        </button>
      )}

      {view.kind === 'lists' && (
        <ListsView
          canWrite={canWrite}
          onOpen={(l) => setView({ kind: 'list', listId: l.id, listName: l.name })}
          onSend={(l) => setSendFor({ id: l.id, name: l.name })}
        />
      )}

      {view.kind === 'list' && (
        <ListDetailView
          listId={view.listId}
          listName={view.listName}
          canWrite={canWrite}
          onSend={() => setSendFor({ id: view.listId, name: view.listName })}
          onOpenCampaign={(id) =>
            setView({ kind: 'campaign', campaignId: id, backList: { id: view.listId, name: view.listName } })
          }
        />
      )}

      {view.kind === 'campaign' && (
        <CampaignDetailView
          campaignId={view.campaignId}
          canWrite={canWrite}
          onBack={() =>
            view.backList
              ? setView({ kind: 'list', listId: view.backList.id, listName: view.backList.name })
              : setView({ kind: 'lists' })
          }
        />
      )}

      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={(id, name) => {
            setShowImport(false);
            setView({ kind: 'list', listId: id, listName: name });
          }}
        />
      )}

      {sendFor && (
        <NewCampaignModal
          listId={sendFor.id}
          listName={sendFor.name}
          onClose={() => setSendFor(null)}
          onCreated={(campaignId) => {
            const list = sendFor;
            setSendFor(null);
            setView({ kind: 'campaign', campaignId, backList: { id: list.id, name: list.name } });
          }}
        />
      )}
    </div>
  );
}

// ── Lists table ─────────────────────────────────────────────────────────

function ListsView({
  canWrite,
  onOpen,
  onSend,
}: {
  canWrite: boolean;
  onOpen: (l: CustomerListSummary) => void;
  onSend: (l: CustomerListSummary) => void;
}) {
  const { t } = useTranslation();
  const { data: lists = [], isLoading } = useCustomerListsQuery();
  const renameMutation = useUpdateListMutation();
  const deleteMutation = useDeleteListMutation();
  const toast = useToast();
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);

  if (isLoading) return <Center><Loader2 className="animate-spin" size={32} /></Center>;

  if (lists.length === 0) {
    return (
      <div className="cmp-empty">
        <FileJson size={48} strokeWidth={1} />
        <h3>{t('campaigns.empty.title')}</h3>
        <p>{t('campaigns.empty.description')}</p>
      </div>
    );
  }

  const doRename = async () => {
    if (!renaming) return;
    try {
      await renameMutation.mutateAsync({ id: renaming.id, data: { name: renaming.name } });
      toast.success(t('campaigns.rename.success'));
      setRenaming(null);
    } catch (err) {
      toast.error(t('campaigns.rename.error'), err instanceof Error ? err.message : undefined);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await deleteMutation.mutateAsync(confirmDelete.id);
      toast.success(t('campaigns.deleteList.success'));
      setConfirmDelete(null);
    } catch (err) {
      toast.error(t('campaigns.deleteList.error'), err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="cmp-table-wrap">
      <table className="cmp-table">
        <thead>
          <tr>
            <th>{t('campaigns.cols.name')}</th>
            <th className="num">{t('campaigns.cols.recipients')}</th>
            <th>{t('campaigns.cols.created')}</th>
            <th>{t('campaigns.cols.lastSent')}</th>
            <th className="actions-col">{t('campaigns.cols.actions')}</th>
          </tr>
        </thead>
        <tbody>
          {lists.map((l) => (
            <tr key={l.id}>
              <td>
                <button className="cmp-link" onClick={() => onOpen(l)}>
                  {l.name}
                </button>
                {l.description && <div className="cmp-sub">{l.description}</div>}
              </td>
              <td className="num">{l.recipientCount}</td>
              <td>{fmtDate(l.createdAt)}</td>
              <td>{l.lastCampaignAt ? fmtDate(l.lastCampaignAt) : t('campaigns.never')}</td>
              <td className="actions-col">
                <div className="cmp-actions">
                  <button className="cmp-icon primary" title={t('campaigns.send')} onClick={() => onSend(l)} disabled={!canWrite}>
                    <Send size={16} />
                  </button>
                  <button
                    className="cmp-icon"
                    title={t('campaigns.rename.button')}
                    onClick={() => setRenaming({ id: l.id, name: l.name })}
                    disabled={!canWrite}
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    className="cmp-icon danger"
                    title={t('common.delete')}
                    onClick={() => setConfirmDelete({ id: l.id, name: l.name })}
                    disabled={!canWrite}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {renaming && (
        <Modal title={t('campaigns.rename.title')} onClose={() => setRenaming(null)}>
          <div className="modal-body">
            <label>{t('campaigns.cols.name')}</label>
            <input
              autoFocus
              value={renaming.name}
              onChange={(e) => setRenaming({ ...renaming, name: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && void doRename()}
            />
          </div>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={() => setRenaming(null)}>{t('common.cancel')}</button>
            <button className="btn-primary" onClick={() => void doRename()} disabled={!renaming.name.trim()}>
              {t('common.save')}
            </button>
          </div>
        </Modal>
      )}

      {confirmDelete && (
        <Modal title={t('campaigns.deleteList.title')} onClose={() => setConfirmDelete(null)}>
          <div className="modal-body">
            <p>{t('campaigns.deleteList.confirm', { name: confirmDelete.name })}</p>
          </div>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={() => setConfirmDelete(null)}>{t('common.cancel')}</button>
            <button className="btn-danger" onClick={() => void doDelete()}>{t('common.delete')}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── List detail: recipients + runs ──────────────────────────────────────

function ListDetailView({
  listId,
  listName,
  canWrite,
  onSend,
  onOpenCampaign,
}: {
  listId: string;
  listName: string;
  canWrite: boolean;
  onSend: () => void;
  onOpenCampaign: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { data: list, isLoading } = useCustomerListQuery(listId);
  const { data: runs = [] } = useListCampaignsQuery(listId);
  const [search, setSearch] = useState('');

  const recipients = useMemo(() => {
    const all = list?.recipients ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((r) => r.name.toLowerCase().includes(q) || r.phone.includes(q));
  }, [list, search]);

  return (
    <div className="cmp-detail">
      <div className="cmp-detail-head">
        <div>
          <h2 className="cmp-h2">{listName}</h2>
          <p className="cmp-sub">
            {t('campaigns.recipientsCount', { count: list?.recipientCount ?? 0 })}
          </p>
        </div>
        <button className="btn-primary" onClick={onSend} disabled={!canWrite}>
          <Send size={18} />
          {t('campaigns.newSend')}
        </button>
      </div>

      <section className="cmp-section">
        <div className="cmp-section-head">
          <h3><Clock size={16} /> {t('campaigns.runs')}</h3>
        </div>
        {runs.length === 0 ? (
          <p className="cmp-sub">{t('campaigns.noRuns')}</p>
        ) : (
          <div className="cmp-table-wrap">
            <table className="cmp-table">
              <thead>
                <tr>
                  <th>{t('campaigns.cols.run')}</th>
                  <th>{t('campaigns.cols.session')}</th>
                  <th>{t('campaigns.cols.status')}</th>
                  <th>{t('campaigns.cols.progress')}</th>
                  <th>{t('campaigns.cols.started')}</th>
                  <th className="actions-col">{t('campaigns.cols.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <button className="cmp-link" onClick={() => onOpenCampaign(r.id)}>{r.name}</button>
                    </td>
                    <td>{r.sessionName ?? r.sessionId}</td>
                    <td><StatusBadge status={r.status} /></td>
                    <td>{r.progress.sent}/{r.progress.total - r.progress.skipped}</td>
                    <td>{fmtDate(r.startedAt ?? r.createdAt)}</td>
                    <td className="actions-col">
                      <button className="cmp-icon" title={t('campaigns.view')} onClick={() => onOpenCampaign(r.id)}>
                        <Search size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="cmp-section">
        <div className="cmp-section-head">
          <h3><Users size={16} /> {t('campaigns.customers')}</h3>
          <div className="cmp-search">
            <Search size={15} />
            <input
              placeholder={t('campaigns.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        {isLoading ? (
          <Center><Loader2 className="animate-spin" size={28} /></Center>
        ) : (
          <div className="cmp-table-wrap cmp-scroll">
            <table className="cmp-table">
              <thead>
                <tr>
                  <th>{t('campaigns.cols.name')}</th>
                  <th>{t('campaigns.cols.phone')}</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.jid}>
                    <td>{r.name}</td>
                    <td className="mono">+{r.phone}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ── Campaign detail: progress + per-recipient status ────────────────────

function CampaignDetailView({
  campaignId,
  canWrite,
  onBack,
}: {
  campaignId: string;
  canWrite: boolean;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const { data: campaign, isLoading } = useCampaignQuery(campaignId);
  const pauseMutation = usePauseCampaignMutation();
  const resumeMutation = useResumeCampaignMutation();
  const cancelMutation = useCancelCampaignMutation();
  const deleteMutation = useDeleteCampaignMutation();
  const toast = useToast();
  const [statusFilter, setStatusFilter] = useState<'all' | RecipientStatus>('all');
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const filtered = useMemo(() => {
    const all = campaign?.recipients ?? [];
    const q = search.trim().toLowerCase();
    return all.filter(
      (r) =>
        (statusFilter === 'all' || r.status === statusFilter) &&
        (!q || r.name.toLowerCase().includes(q) || r.phone.includes(q)),
    );
  }, [campaign, statusFilter, search]);

  if (isLoading || !campaign) return <Center><Loader2 className="animate-spin" size={32} /></Center>;

  const p = campaign.progress;
  const target = p.total - p.skipped;
  const done = p.sent + p.failed + (p.cancelled ?? 0);
  const pct = target > 0 ? Math.round((done / target) * 100) : 100;

  const guard = async (fn: () => Promise<unknown>, errKey: string) => {
    try {
      await fn();
    } catch (err) {
      toast.error(t(errKey), err instanceof Error ? err.message : undefined);
    }
  };

  return (
    <div className="cmp-detail">
      <div className="cmp-detail-head">
        <div>
          <h2 className="cmp-h2">{campaign.name}</h2>
          <p className="cmp-sub">
            {t('campaigns.fromList', { list: campaign.listName })} · {campaign.sessionName ?? campaign.sessionId}
          </p>
        </div>
        <div className="cmp-controls">
          {campaign.status === 'running' && canWrite && (
            <button className="btn-secondary" onClick={() => void guard(() => pauseMutation.mutateAsync(campaign.id), 'campaigns.controls.pauseError')}>
              <Pause size={16} /> {t('campaigns.controls.pause')}
            </button>
          )}
          {campaign.status === 'paused' && canWrite && (
            <button className="btn-primary" onClick={() => void guard(() => resumeMutation.mutateAsync(campaign.id), 'campaigns.controls.resumeError')}>
              <Play size={16} /> {t('campaigns.controls.resume')}
            </button>
          )}
          {(campaign.status === 'running' || campaign.status === 'paused') && canWrite && (
            <button className="btn-danger" onClick={() => void guard(() => cancelMutation.mutateAsync(campaign.id), 'campaigns.controls.cancelError')}>
              <Ban size={16} /> {t('campaigns.controls.cancel')}
            </button>
          )}
          <button className="btn-secondary" onClick={() => void campaignApi.exportCsv(campaign.id, campaign.name)}>
            <Download size={16} /> {t('campaigns.controls.export')}
          </button>
          {canWrite && !['running', 'paused'].includes(campaign.status) && (
            <button className="btn-danger" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={16} /> {t('common.delete')}
            </button>
          )}
        </div>
      </div>

      <div className="cmp-status-row">
        <StatusBadge status={campaign.status} />
        <div className="cmp-progress">
          <div className="cmp-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <span className="cmp-progress-label">{done}/{target} · {pct}%</span>
      </div>

      <div className="cmp-stats">
        <Stat label={t('campaigns.stats.sent')} value={p.sent} cls="sent" />
        <Stat label={t('campaigns.stats.delivered')} value={p.delivered} cls="delivered" />
        <Stat label={t('campaigns.stats.read')} value={p.read} cls="success" />
        <Stat label={t('campaigns.stats.failed')} value={p.failed} cls="error" />
        <Stat label={t('campaigns.stats.pending')} value={p.pending} cls="muted" />
        <Stat label={t('campaigns.stats.skipped')} value={p.skipped} cls="muted" />
        {(p.cancelled ?? 0) > 0 && <Stat label={t('campaigns.stats.cancelled')} value={p.cancelled} cls="muted" />}
      </div>

      <div className="cmp-message-preview">
        <span className="cmp-sub">{t('campaigns.messageLabel')}</span>
        <p>{campaign.message.text || <em>{t('campaigns.mediaOnly')}</em>}</p>
        {campaign.message.media?.url && (
          <a className="cmp-link" href={campaign.message.media.url} target="_blank" rel="noreferrer">
            {t('campaigns.attachedMedia', { kind: campaign.message.media.kind })}
          </a>
        )}
      </div>

      <section className="cmp-section">
        <div className="cmp-section-head">
          <h3>{t('campaigns.recipientStatus')}</h3>
          <div className="cmp-filters">
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | RecipientStatus)}>
              <option value="all">{t('campaigns.filter.all')}</option>
              <option value="pending">{t('campaigns.rstatus.pending')}</option>
              <option value="sent">{t('campaigns.rstatus.sent')}</option>
              <option value="delivered">{t('campaigns.rstatus.delivered')}</option>
              <option value="read">{t('campaigns.rstatus.read')}</option>
              <option value="failed">{t('campaigns.rstatus.failed')}</option>
              <option value="skipped">{t('campaigns.rstatus.skipped')}</option>
            </select>
            <div className="cmp-search">
              <Search size={15} />
              <input placeholder={t('campaigns.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
        </div>
        <div className="cmp-table-wrap cmp-scroll">
          <table className="cmp-table">
            <thead>
              <tr>
                <th>{t('campaigns.cols.name')}</th>
                <th>{t('campaigns.cols.phone')}</th>
                <th>{t('campaigns.cols.status')}</th>
                <th>{t('campaigns.cols.sentAt')}</th>
                <th>{t('campaigns.cols.received')}</th>
                <th>{t('campaigns.cols.error')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.jid}>
                  <td>{r.name}</td>
                  <td className="mono">+{r.phone}</td>
                  <td><RecipientBadge status={r.status} /></td>
                  <td>{fmtDate(r.sentAt)}</td>
                  <td>{r.readAt ? fmtDate(r.readAt) : r.deliveredAt ? fmtDate(r.deliveredAt) : '—'}</td>
                  <td className="cmp-err">{r.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {confirmDelete && (
        <Modal title={t('campaigns.deleteRun.title')} onClose={() => setConfirmDelete(false)}>
          <div className="modal-body">
            <p>{t('campaigns.deleteRun.confirm')}</p>
          </div>
          <div className="modal-footer">
            <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>{t('common.cancel')}</button>
            <button
              className="btn-danger"
              onClick={() =>
                void guard(async () => {
                  await deleteMutation.mutateAsync(campaign.id);
                  onBack();
                }, 'campaigns.deleteRun.error')
              }
            >
              {t('common.delete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Import modal ────────────────────────────────────────────────────────

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (id: string, name: string) => void }) {
  const { t } = useTranslation();
  const importMutation = useImportListMutation();
  const toast = useToast();
  const [name, setName] = useState(defaultListName);
  const [countryCode, setCountryCode] = useState('91');
  const [raw, setRaw] = useState('');
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');

  const parsed = useMemo<{ rows: ParsedRow[]; error: string }>(() => {
    if (!raw.trim()) return { rows: [], error: '' };
    try {
      return { rows: parseCustomers(raw), error: '' };
    } catch (e) {
      return { rows: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [raw]);

  const onFile = async (file: File) => {
    const text = await file.text();
    setRaw(text);
    setFileName(file.name);
    if (!name) setName(file.name.replace(/\.[^.]+$/, ''));
  };

  const submit = async () => {
    setError('');
    let rows: ParsedRow[];
    try {
      rows = parseCustomers(raw);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    try {
      const result = await importMutation.mutateAsync({
        name: name.trim() || undefined,
        defaultCountryCode: countryCode.trim() || undefined,
        recipients: rows,
      });
      const s = result.summary;
      toast.success(
        t('campaigns.import.successTitle'),
        t('campaigns.import.successDesc', {
          imported: s.imported,
          duplicates: s.duplicates,
          invalid: s.invalid,
        }),
      );
      onImported(result.list.id, result.list.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal title={t('campaigns.import.title')} onClose={onClose} wide>
      <div className="modal-body cmp-modal-grid">
        <div className="cmp-col">
          <p className="cmp-sub">{t('campaigns.import.help')}</p>

          <label className="cmp-drop">
            <input
              type="file"
              accept=".json,application/json,text/plain"
              onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])}
              hidden
            />
            <Upload size={20} />
            <span>{fileName || t('campaigns.import.choose')}</span>
          </label>

          <label>{t('campaigns.import.orPaste')}</label>
          <textarea
            className="cmp-json cmp-grow-area"
            placeholder={'[{ "name": "Ravi", "phone": "+91 98470 12345" }]'}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
          />
        </div>

        <div className="cmp-col">
          <div className="cmp-form-row">
            <div className="cmp-field">
              <label>{t('campaigns.import.listName')}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('campaigns.import.namePlaceholder')} />
            </div>
            <div className="cmp-field cmp-field-sm">
              <label>{t('campaigns.import.countryCode')}</label>
              <input value={countryCode} onChange={(e) => setCountryCode(e.target.value.replace(/[^\d+]/g, ''))} placeholder="91" />
            </div>
          </div>

          {parsed.rows.length > 0 && (
            <div className="cmp-preview-note">{t('campaigns.import.parsed', { count: parsed.rows.length })}</div>
          )}
          {(error || parsed.error) && <div className="cmp-error">{error || parsed.error}</div>}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
        <button
          className="btn-primary"
          onClick={() => void submit()}
          disabled={importMutation.isPending || parsed.rows.length === 0}
        >
          {importMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
          {t('campaigns.import.save')}
        </button>
      </div>
    </Modal>
  );
}

// ── New campaign modal ──────────────────────────────────────────────────

function NewCampaignModal({
  listId,
  listName,
  onClose,
  onCreated,
}: {
  listId: string;
  listName: string;
  onClose: () => void;
  onCreated: (campaignId: string) => void;
}) {
  const { t } = useTranslation();
  const { data: allSessions = [] } = useSessionsQuery();
  const { data: list } = useCustomerListQuery(listId);
  const createMutation = useCreateCampaignMutation();
  const toast = useToast();
  const sessions = allSessions.filter((s) => s.status === 'ready');

  const [sessionId, setSessionId] = useState('');
  const [name, setName] = useState(listName);
  const [text, setText] = useState(DEFAULT_CAMPAIGN_MESSAGE);
  const [imageUrl, setImageUrl] = useState('');
  const [delaySec, setDelaySec] = useState(20);
  const [randomSec, setRandomSec] = useState(15);
  const [skipAlreadySent, setSkipAlreadySent] = useState(true);
  const [error, setError] = useState('');

  const effectiveSession = sessionId || sessions[0]?.id || '';
  const sampleName = list?.recipients?.[0]?.name || 'there';
  const preview = text.replace(/\{name\}/gi, sampleName).replace(/\{phone\}/gi, list?.recipients?.[0]?.phone || '');
  const count = list?.recipientCount ?? 0;
  const estMin = Math.max(1, Math.round((count * (delaySec + randomSec / 2)) / 60));

  const insertName = () => setText((prev) => `${prev}{name}`);

  const submit = async () => {
    setError('');
    if (!effectiveSession) {
      setError(t('campaigns.new.noSession'));
      return;
    }
    if (!text.trim() && !imageUrl.trim()) {
      setError(t('campaigns.new.noMessage'));
      return;
    }
    try {
      const created = await createMutation.mutateAsync({
        listId,
        sessionId: effectiveSession,
        name: name.trim() || undefined,
        message: {
          text,
          media: imageUrl.trim() ? { kind: 'image', url: imageUrl.trim() } : undefined,
        },
        options: {
          delayBetweenMessages: Math.round(delaySec * 1000),
          randomizeDelay: randomSec > 0,
          randomizeExtraMs: Math.round(randomSec * 1000),
          skipAlreadySent,
          stopOnError: false,
        },
      });
      toast.success(t('campaigns.new.started'), t('campaigns.new.startedDesc', { name: created.name }));
      onCreated(created.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal title={t('campaigns.new.title', { list: listName })} onClose={onClose} wide>
      <div className="modal-body cmp-modal-grid">
        <div className="cmp-col">
          <div className="cmp-msg-head">
            <label>{t('campaigns.new.message')}</label>
            <button type="button" className="cmp-chip" onClick={insertName}>+ {'{name}'}</button>
          </div>
          <textarea
            className="cmp-grow-area"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('campaigns.new.messagePlaceholder')}
          />

          {(text.trim() || imageUrl.trim()) && (
            <div className="cmp-preview-box">
              <span className="cmp-sub">{t('campaigns.new.preview')}</span>
              <p>{preview || <em>{t('campaigns.mediaOnly')}</em>}</p>
            </div>
          )}
        </div>

        <div className="cmp-col">
          <label>{t('campaigns.new.session')}</label>
          <select value={effectiveSession} onChange={(e) => setSessionId(e.target.value)}>
            {sessions.length === 0 && <option value="">{t('campaigns.new.noReadySessions')}</option>}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.phone ? `(+${s.phone})` : ''}
              </option>
            ))}
          </select>

          <label>{t('campaigns.new.runName')}</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('campaigns.new.runNamePlaceholder')} />

          <label>{t('campaigns.new.imageUrl')}</label>
          <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https://…/offer.jpg" />
          {imageUrl.trim() && <div className="cmp-hint">{t('campaigns.new.imageHint')}</div>}

          <div className="cmp-form-row">
            <div className="cmp-field">
              <label>{t('campaigns.new.delay')}</label>
              <input type="number" min={3} value={delaySec} onChange={(e) => setDelaySec(Math.max(3, Number(e.target.value) || 0))} />
            </div>
            <div className="cmp-field">
              <label>{t('campaigns.new.random')}</label>
              <input type="number" min={0} value={randomSec} onChange={(e) => setRandomSec(Math.max(0, Number(e.target.value) || 0))} />
            </div>
          </div>

          <label className="cmp-check">
            <input type="checkbox" checked={skipAlreadySent} onChange={(e) => setSkipAlreadySent(e.target.checked)} />
            {t('campaigns.new.skipAlreadySent')}
          </label>

          <div className="cmp-estimate">
            <Clock size={15} /> {t('campaigns.new.estimate', { count, minutes: estMin })}
          </div>

          {error && <div className="cmp-error">{error}</div>}
        </div>
      </div>
      <div className="modal-footer">
        <button className="btn-secondary" onClick={onClose}>{t('common.cancel')}</button>
        <button
          className="btn-primary"
          onClick={() => void submit()}
          disabled={createMutation.isPending || !effectiveSession || (!text.trim() && !imageUrl.trim())}
        >
          {createMutation.isPending ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}
          {t('campaigns.new.send')}
        </button>
      </div>
    </Modal>
  );
}

// ── Small shared bits ───────────────────────────────────────────────────

function Modal({
  title,
  children,
  onClose,
  wide,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal cmp-modal-full ${wide ? 'cmp-modal-wide' : ''}`} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: CampaignStatus }) {
  const { t } = useTranslation();
  return <span className={`cmp-badge ${STATUS_META[status].cls}`}>{t(`campaigns.cstatus.${status}`)}</span>;
}

function RecipientBadge({ status }: { status: RecipientStatus }) {
  const { t } = useTranslation();
  return <span className={`cmp-badge ${RECIPIENT_META[status].cls}`}>{t(`campaigns.rstatus.${status}`)}</span>;
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className={`cmp-stat ${cls}`}>
      <span className="cmp-stat-value">{value}</span>
      <span className="cmp-stat-label">{label}</span>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="cmp-center">{children}</div>;
}

export default Campaigns;
