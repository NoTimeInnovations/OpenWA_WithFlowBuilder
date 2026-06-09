import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  ArrowLeft,
  Save,
  Zap,
  MessageSquare,
  Image as ImageIcon,
  Mic,
  List,
  HelpCircle,
  GitBranch,
  Clock,
  Code,
  CornerUpRight,
  Flag,
  Plus,
  Trash2,
  Loader2,
} from 'lucide-react';
import {
  flowApi,
  type FlowGraph,
  type FlowScope,
  type FlowScopeType,
  type TriggerMatchType,
  type SaveFlowPayload,
} from '../services/api';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRole } from '../hooks/useRole';
import { useSessionsQuery } from '../hooks/queries';
import './FlowBuilder.css';

// ── Node metadata ─────────────────────────────────────────────────────
const NODE_META: Record<string, { label: string; icon: typeof Zap; accent: string }> = {
  trigger: { label: 'Trigger', icon: Zap, accent: '#25d366' },
  send_text: { label: 'Send text', icon: MessageSquare, accent: '#3b82f6' },
  send_image: { label: 'Send image', icon: ImageIcon, accent: '#8b5cf6' },
  send_audio: { label: 'Send audio', icon: Mic, accent: '#8b5cf6' },
  buttons: { label: 'Choices', icon: List, accent: '#f59e0b' },
  wait_for_reply: { label: 'Wait for reply', icon: HelpCircle, accent: '#06b6d4' },
  condition: { label: 'Condition', icon: GitBranch, accent: '#ec4899' },
  delay: { label: 'Delay', icon: Clock, accent: '#64748b' },
  set_variable: { label: 'Set variable', icon: Code, accent: '#64748b' },
  jump: { label: 'Jump', icon: CornerUpRight, accent: '#64748b' },
  end: { label: 'End', icon: Flag, accent: '#ef4444' },
};

const PALETTE: string[] = [
  'send_text',
  'send_image',
  'send_audio',
  'buttons',
  'wait_for_reply',
  'condition',
  'delay',
  'set_variable',
  'jump',
  'end',
];

interface ButtonItem {
  id: string;
  label: string;
}
interface ConditionRule {
  var?: string;
  op: string;
  value?: string;
  handle: string;
}

function defaultData(type: string): Record<string, unknown> {
  switch (type) {
    case 'send_text':
      return { text: '' };
    case 'send_image':
      return { mediaUrl: '', caption: '' };
    case 'send_audio':
      return { mediaUrl: '' };
    case 'buttons':
      return { text: 'Choose an option:', items: [{ id: 'opt1', label: 'Option 1' }] };
    case 'wait_for_reply':
      return { variableName: 'reply', validation: 'text', retryText: '' };
    case 'condition':
      return { rules: [{ var: '', op: 'equals', value: '', handle: 'r1' }], defaultHandle: 'else' };
    case 'delay':
      return { seconds: 1 };
    case 'set_variable':
      return { name: '', value: '' };
    case 'jump':
      return { targetNodeId: '' };
    default:
      return {};
  }
}

let idSeq = 0;
const genId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${idSeq++}`;

// Branch handles for buttons/condition; null = single default source handle.
function getBranches(type: string, data: Record<string, unknown>): { id: string; label: string }[] | null {
  if (type === 'buttons') {
    const items = (data.items as ButtonItem[]) ?? [];
    return items.map(it => ({ id: it.id, label: it.label || it.id }));
  }
  if (type === 'condition') {
    const rules = (data.rules as ConditionRule[]) ?? [];
    return [
      ...rules.map(r => ({ id: r.handle, label: `${r.var || 'reply'} ${r.op} ${r.value ?? ''}`.trim() })),
      { id: 'else', label: 'else' },
    ];
  }
  return null;
}

function nodeSummary(type: string, data: Record<string, unknown>): string {
  switch (type) {
    case 'trigger': {
      const mt = data.matchType as string;
      const kw = (data.keywords as string[]) ?? [];
      if (mt === 'exact' || mt === 'contains') return `${mt}: ${kw.join(', ')}`;
      return mt === 'any' ? 'any message' : mt === 'welcome' ? 'first contact' : (mt ?? '');
    }
    case 'send_text':
      return String(data.text ?? '');
    case 'send_image':
    case 'send_audio':
      return String(data.mediaUrl ?? '');
    case 'buttons':
      return String(data.text ?? '');
    case 'wait_for_reply':
      return `→ {{${String(data.variableName ?? '')}}}`;
    case 'delay':
      return `${String(data.seconds ?? 0)}s`;
    case 'set_variable':
      return `${String(data.name ?? '')} = ${String(data.value ?? '')}`;
    case 'jump':
      return String(data.targetNodeId ?? '');
    default:
      return '';
  }
}

// ── Custom node ───────────────────────────────────────────────────────
function FlowNodeCard({ data, type, selected }: NodeProps) {
  const meta = NODE_META[type ?? 'send_text'] ?? NODE_META.send_text;
  const Icon = meta.icon;
  const hasTarget = type !== 'trigger';
  const branches = getBranches(type ?? '', data);
  const summary = nodeSummary(type ?? '', data);

  return (
    <div className={`fb-node ${selected ? 'selected' : ''}`} style={selected ? { borderColor: meta.accent } : undefined}>
      {hasTarget && <Handle type="target" position={Position.Left} className="fb-handle" />}
      <div className="fb-node-head" style={{ color: meta.accent }}>
        <Icon size={14} />
        <span>{meta.label}</span>
      </div>
      {summary && <div className="fb-node-body">{summary}</div>}
      {branches ? (
        <div className="fb-branches">
          {branches.map(br => (
            <div key={br.id} className="fb-branch">
              <span>{br.label}</span>
              <Handle type="source" position={Position.Right} id={br.id} className="fb-handle" />
            </div>
          ))}
        </div>
      ) : type !== 'end' ? (
        <Handle type="source" position={Position.Right} className="fb-handle" />
      ) : null}
    </div>
  );
}

const nodeTypes = Object.fromEntries(Object.keys(NODE_META).map(k => [k, FlowNodeCard]));

// ── Builder ───────────────────────────────────────────────────────────
function BuilderInner() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isNew = id === 'new';
  useDocumentTitle(t('messagingFlow.builder.title'));
  const { canWrite } = useRole();
  const { data: sessions = [] } = useSessionsQuery();

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<FlowScope>({ type: 'all' });
  const [escapeKeyword, setEscapeKeyword] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loadedRef = useRef(false);

  // Load existing flow, or seed a new canvas with a trigger node.
  useEffect(() => {
    if (loadedRef.current) return;
    loadedRef.current = true;
    if (isNew) {
      setNodes([
        { id: 'trigger', type: 'trigger', position: { x: 140, y: 220 }, data: { matchType: 'any', keywords: [] } },
      ]);
      setName('New flow');
      return;
    }
    if (!id) return;
    flowApi
      .get(id)
      .then(flow => {
        const g = flow.graph ?? { nodes: [], edges: [] };
        setNodes((g.nodes ?? []).map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })) as Node[]);
        setEdges(
          (g.edges ?? []).map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            sourceHandle: e.sourceHandle ?? undefined,
            targetHandle: e.targetHandle ?? undefined,
            label: e.label,
            markerEnd: { type: MarkerType.ArrowClosed },
          })) as Edge[],
        );
        setName(flow.name);
        setScope(flow.scope ?? { type: 'all' });
        setEscapeKeyword(flow.escapeKeyword ?? '');
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [id, isNew, setNodes, setEdges]);

  const onConnect = useCallback(
    (params: Connection) =>
      setEdges(eds => addEdge({ ...params, markerEnd: { type: MarkerType.ArrowClosed } }, eds)),
    [setEdges],
  );

  const addNode = (type: string) => {
    const newId = genId(type);
    const offset = nodes.length * 12;
    setNodes(ns => [
      ...ns,
      { id: newId, type, position: { x: 420 + offset, y: 120 + offset }, data: defaultData(type) } as Node,
    ]);
    setSelectedId(newId);
  };

  const updateNodeData = useCallback(
    (nodeId: string, patch: Record<string, unknown>) => {
      setNodes(ns => ns.map(n => (n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n)));
    },
    [setNodes],
  );

  const removeEdgesForHandles = useCallback(
    (nodeId: string, keepHandles: string[]) => {
      setEdges(eds =>
        eds.filter(e => !(e.source === nodeId && e.sourceHandle && !keepHandles.includes(e.sourceHandle))),
      );
    },
    [setEdges],
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes(ns => ns.filter(n => n.id !== nodeId));
      setEdges(eds => eds.filter(e => e.source !== nodeId && e.target !== nodeId));
      setSelectedId(null);
    },
    [setNodes, setEdges],
  );

  const selectedNode = useMemo(() => nodes.find(n => n.id === selectedId) ?? null, [nodes, selectedId]);

  const handleSave = async () => {
    setError(null);
    const graph: FlowGraph = {
      nodes: nodes.map(n => ({
        id: n.id,
        type: (n.type ?? 'send_text') as FlowGraph['nodes'][number]['type'],
        position: n.position,
        data: n.data as Record<string, unknown>,
      })),
      edges: edges.map(e => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? null,
        targetHandle: e.targetHandle ?? null,
        label: typeof e.label === 'string' ? e.label : undefined,
      })),
    };
    if (!name.trim()) {
      setError(t('messagingFlow.builder.errNoName'));
      return;
    }
    if (!graph.nodes.some(n => n.type === 'trigger')) {
      setError(t('messagingFlow.builder.errNoTrigger'));
      return;
    }
    if (scope.type !== 'all' && (!scope.sessionIds || scope.sessionIds.length === 0)) {
      setError(t('messagingFlow.builder.errNoSession'));
      return;
    }
    const payload: SaveFlowPayload = {
      name: name.trim(),
      scope,
      graph,
      escapeKeyword: escapeKeyword.trim() || undefined,
    };
    setSaving(true);
    try {
      if (isNew) {
        await flowApi.create(payload);
      } else if (id) {
        await flowApi.update(id, payload);
      }
      navigate('/messaging-flow');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flow-builder" style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Loader2 className="animate-spin" size={32} />
      </div>
    );
  }

  return (
    <div className="flow-builder">
      <div className="fb-topbar">
        <button className="btn-secondary" onClick={() => navigate('/messaging-flow')}>
          <ArrowLeft size={16} /> {t('common.back')}
        </button>
        <input
          className="fb-name-input"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('messagingFlow.form.namePlaceholder')}
        />
        <div className="fb-topbar-right">
          {error && <span className="fb-error">{error}</span>}
          {canWrite && (
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              {t('common.save')}
            </button>
          )}
        </div>
      </div>

      <div className="fb-body">
        <div className="fb-palette">
          <div className="fb-palette-title">{t('messagingFlow.builder.addNode')}</div>
          {PALETTE.map(type => {
            const meta = NODE_META[type];
            const Icon = meta.icon;
            return (
              <button key={type} className="fb-palette-btn" onClick={() => addNode(type)} disabled={!canWrite}>
                <Icon size={15} style={{ color: meta.accent }} />
                <span>{meta.label}</span>
                <Plus size={13} className="fb-palette-plus" />
              </button>
            );
          })}
        </div>

        <div className="fb-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_e, node) => setSelectedId(node.id)}
            onPaneClick={() => setSelectedId(null)}
            nodeTypes={nodeTypes}
            fitView
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
          >
            <Background gap={18} />
            <Controls />
          </ReactFlow>
        </div>

        <div className="fb-inspector">
          {selectedNode ? (
            <NodeInspector
              node={selectedNode}
              nodes={nodes}
              onChange={updateNodeData}
              onSyncBranches={removeEdgesForHandles}
              onDelete={deleteNode}
              readOnly={!canWrite}
            />
          ) : (
            <FlowSettings
              name={name}
              setName={setName}
              scope={scope}
              setScope={setScope}
              escapeKeyword={escapeKeyword}
              setEscapeKeyword={setEscapeKeyword}
              sessions={sessions}
              readOnly={!canWrite}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Node inspector (right panel) ──────────────────────────────────────
interface NodeInspectorProps {
  node: Node;
  nodes: Node[];
  onChange: (id: string, patch: Record<string, unknown>) => void;
  onSyncBranches: (nodeId: string, keepHandles: string[]) => void;
  onDelete: (id: string) => void;
  readOnly: boolean;
}

function NodeInspector({ node, nodes, onChange, onSyncBranches, onDelete, readOnly }: NodeInspectorProps) {
  const { t } = useTranslation();
  const meta = NODE_META[node.type ?? ''] ?? NODE_META.send_text;
  const d = node.data as Record<string, unknown>;
  const set = (patch: Record<string, unknown>) => onChange(node.id, patch);

  return (
    <div className="fb-inspector-inner">
      <div className="fb-inspector-head">
        <span style={{ color: meta.accent }}>{meta.label}</span>
        {node.type !== 'trigger' && !readOnly && (
          <button className="icon-btn danger" title={t('common.delete')} onClick={() => onDelete(node.id)}>
            <Trash2 size={15} />
          </button>
        )}
      </div>
      <fieldset disabled={readOnly} className="fb-fields">
        {node.type === 'trigger' && (
          <>
            <label>{t('messagingFlow.form.trigger')}</label>
            <select value={String(d.matchType ?? 'any')} onChange={e => set({ matchType: e.target.value as TriggerMatchType })}>
              <option value="any">{t('messagingFlow.triggerType.any')}</option>
              <option value="exact">{t('messagingFlow.triggerType.exact')}</option>
              <option value="contains">{t('messagingFlow.triggerType.contains')}</option>
              <option value="welcome">{t('messagingFlow.triggerType.welcome')}</option>
            </select>
            {(d.matchType === 'exact' || d.matchType === 'contains') && (
              <>
                <label>{t('messagingFlow.form.keywords')}</label>
                <input
                  value={((d.keywords as string[]) ?? []).join(', ')}
                  onChange={e => set({ keywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean) })}
                  placeholder={t('messagingFlow.form.keywordsPlaceholder')}
                />
              </>
            )}
          </>
        )}

        {node.type === 'send_text' && (
          <>
            <label>{t('messagingFlow.replyKind.text')}</label>
            <textarea rows={4} value={String(d.text ?? '')} onChange={e => set({ text: e.target.value })} />
          </>
        )}

        {(node.type === 'send_image' || node.type === 'send_audio') && (
          <>
            <label>{t('messagingFlow.form.mediaUrlPlaceholder')}</label>
            <input value={String(d.mediaUrl ?? '')} onChange={e => set({ mediaUrl: e.target.value })} placeholder="https://…" />
            {node.type === 'send_image' && (
              <>
                <label>{t('messagingFlow.form.captionPlaceholder')}</label>
                <input value={String(d.caption ?? '')} onChange={e => set({ caption: e.target.value })} />
              </>
            )}
          </>
        )}

        {node.type === 'buttons' && (
          <ButtonsEditor node={node} onChange={onChange} onSyncBranches={onSyncBranches} />
        )}

        {node.type === 'wait_for_reply' && (
          <>
            <label>{t('messagingFlow.builder.variableName')}</label>
            <input value={String(d.variableName ?? '')} onChange={e => set({ variableName: e.target.value })} />
            <label>{t('messagingFlow.builder.validation')}</label>
            <select value={String(d.validation ?? 'text')} onChange={e => set({ validation: e.target.value })}>
              <option value="text">text</option>
              <option value="number">number</option>
              <option value="email">email</option>
            </select>
            <label>{t('messagingFlow.builder.retryText')}</label>
            <input value={String(d.retryText ?? '')} onChange={e => set({ retryText: e.target.value })} />
          </>
        )}

        {node.type === 'condition' && (
          <ConditionEditor node={node} onChange={onChange} onSyncBranches={onSyncBranches} />
        )}

        {node.type === 'delay' && (
          <>
            <label>{t('messagingFlow.builder.seconds')}</label>
            <input
              type="number"
              min={0}
              value={Number(d.seconds ?? 0)}
              onChange={e => set({ seconds: Number(e.target.value) })}
            />
          </>
        )}

        {node.type === 'set_variable' && (
          <>
            <label>{t('messagingFlow.builder.varName')}</label>
            <input value={String(d.name ?? '')} onChange={e => set({ name: e.target.value })} />
            <label>{t('messagingFlow.builder.varValue')}</label>
            <input value={String(d.value ?? '')} onChange={e => set({ value: e.target.value })} />
          </>
        )}

        {node.type === 'jump' && (
          <>
            <label>{t('messagingFlow.builder.jumpTarget')}</label>
            <select value={String(d.targetNodeId ?? '')} onChange={e => set({ targetNodeId: e.target.value })}>
              <option value="">—</option>
              {nodes
                .filter(n => n.id !== node.id)
                .map(n => (
                  <option key={n.id} value={n.id}>
                    {(NODE_META[n.type ?? '']?.label ?? n.type) + ' · ' + n.id.slice(0, 8)}
                  </option>
                ))}
            </select>
          </>
        )}

        {node.type === 'end' && <p className="fb-hint">{t('messagingFlow.builder.endHint')}</p>}
      </fieldset>
    </div>
  );
}

function ButtonsEditor({
  node,
  onChange,
  onSyncBranches,
}: {
  node: Node;
  onChange: (id: string, patch: Record<string, unknown>) => void;
  onSyncBranches: (nodeId: string, keepHandles: string[]) => void;
}) {
  const { t } = useTranslation();
  const d = node.data as Record<string, unknown>;
  const items = (d.items as ButtonItem[]) ?? [];

  const commit = (next: ButtonItem[]) => {
    onChange(node.id, { items: next });
    onSyncBranches(node.id, next.map(i => i.id));
  };

  return (
    <>
      <label>{t('messagingFlow.builder.menuText')}</label>
      <textarea rows={2} value={String(d.text ?? '')} onChange={e => onChange(node.id, { text: e.target.value })} />
      <label>{t('messagingFlow.builder.choices')}</label>
      {items.map((it, i) => (
        <div key={it.id} className="fb-row">
          <input
            value={it.label}
            onChange={e => commit(items.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))}
          />
          <button className="icon-btn danger" onClick={() => commit(items.filter((_, xi) => xi !== i))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        className="btn-secondary fb-add-row"
        onClick={() => commit([...items, { id: genId('opt'), label: `Option ${items.length + 1}` }])}
      >
        <Plus size={14} /> {t('messagingFlow.builder.addChoice')}
      </button>
    </>
  );
}

function ConditionEditor({
  node,
  onChange,
  onSyncBranches,
}: {
  node: Node;
  onChange: (id: string, patch: Record<string, unknown>) => void;
  onSyncBranches: (nodeId: string, keepHandles: string[]) => void;
}) {
  const { t } = useTranslation();
  const d = node.data as Record<string, unknown>;
  const rules = (d.rules as ConditionRule[]) ?? [];

  const commit = (next: ConditionRule[]) => {
    onChange(node.id, { rules: next });
    onSyncBranches(node.id, [...next.map(r => r.handle), 'else']);
  };
  const upd = (i: number, patch: Partial<ConditionRule>) => commit(rules.map((r, ri) => (ri === i ? { ...r, ...patch } : r)));

  return (
    <>
      <label>{t('messagingFlow.builder.rules')}</label>
      {rules.map((r, i) => (
        <div key={r.handle} className="fb-rule">
          <input placeholder="variable" value={r.var ?? ''} onChange={e => upd(i, { var: e.target.value })} />
          <select value={r.op} onChange={e => upd(i, { op: e.target.value })}>
            <option value="equals">=</option>
            <option value="contains">contains</option>
            <option value="isEmpty">empty</option>
            <option value="gt">&gt;</option>
            <option value="lt">&lt;</option>
          </select>
          {r.op !== 'isEmpty' && (
            <input placeholder="value" value={r.value ?? ''} onChange={e => upd(i, { value: e.target.value })} />
          )}
          <button className="icon-btn danger" onClick={() => commit(rules.filter((_, ri) => ri !== i))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        className="btn-secondary fb-add-row"
        onClick={() => commit([...rules, { var: '', op: 'equals', value: '', handle: genId('r') }])}
      >
        <Plus size={14} /> {t('messagingFlow.builder.addRule')}
      </button>
      <p className="fb-hint">{t('messagingFlow.builder.elseHint')}</p>
    </>
  );
}

// ── Flow settings (right panel when nothing selected) ─────────────────
interface FlowSettingsProps {
  name: string;
  setName: (s: string) => void;
  scope: FlowScope;
  setScope: (s: FlowScope) => void;
  escapeKeyword: string;
  setEscapeKeyword: (s: string) => void;
  sessions: { id: string; name: string }[];
  readOnly: boolean;
}

function FlowSettings({ name, setName, scope, setScope, escapeKeyword, setEscapeKeyword, sessions, readOnly }: FlowSettingsProps) {
  const { t } = useTranslation();
  const toggleSession = (sid: string) => {
    const ids = scope.sessionIds ?? [];
    setScope({ ...scope, sessionIds: ids.includes(sid) ? ids.filter(s => s !== sid) : [...ids, sid] });
  };
  return (
    <div className="fb-inspector-inner">
      <div className="fb-inspector-head">
        <span>{t('messagingFlow.builder.flowSettings')}</span>
      </div>
      <fieldset disabled={readOnly} className="fb-fields">
        <label>{t('messagingFlow.form.name')}</label>
        <input value={name} onChange={e => setName(e.target.value)} />
        <label>{t('messagingFlow.form.scope')}</label>
        <select value={scope.type} onChange={e => setScope({ type: e.target.value as FlowScopeType, sessionIds: scope.sessionIds })}>
          <option value="all">{t('messagingFlow.scope.all')}</option>
          <option value="session">{t('messagingFlow.scope.specific')}</option>
          <option value="sessions">{t('messagingFlow.scope.selected')}</option>
        </select>
        {scope.type === 'session' && (
          <select
            value={scope.sessionIds?.[0] ?? ''}
            onChange={e => setScope({ ...scope, sessionIds: e.target.value ? [e.target.value] : [] })}
          >
            <option value="">{t('messagingFlow.form.selectSession')}</option>
            {sessions.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        {scope.type === 'sessions' && (
          <div className="session-checkboxes">
            {sessions.length === 0 && <span className="muted">{t('messagingFlow.form.noSessions')}</span>}
            {sessions.map(s => (
              <label key={s.id} className="checkbox-row">
                <input type="checkbox" checked={(scope.sessionIds ?? []).includes(s.id)} onChange={() => toggleSession(s.id)} />
                <span>{s.name}</span>
              </label>
            ))}
          </div>
        )}
        <label>{t('messagingFlow.form.escapeKeyword')}</label>
        <input value={escapeKeyword} onChange={e => setEscapeKeyword(e.target.value)} placeholder={t('messagingFlow.form.escapePlaceholder')} />
        <p className="fb-hint">{t('messagingFlow.builder.settingsHint')}</p>
      </fieldset>
    </div>
  );
}

export function FlowBuilder() {
  return (
    <ReactFlowProvider>
      <BuilderInner />
    </ReactFlowProvider>
  );
}
