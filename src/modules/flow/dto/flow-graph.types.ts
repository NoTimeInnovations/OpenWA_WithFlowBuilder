/**
 * Shared TypeScript shapes for the Messaging Flow feature.
 *
 * A flow is stored as a single node-graph JSON document that round-trips 1:1
 * with the @xyflow/react builder in the dashboard (`rf.toObject()`), so adding
 * a new node type never requires a DB migration — only new `data`.
 */

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
  /** Node-type-specific config. See the per-type shapes below. */
  data: Record<string, unknown>;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** Branching key: a `buttons` item id, or a `condition` rule handle / 'else'. */
  sourceHandle?: string | null;
  targetHandle?: string | null;
  label?: string;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

/** How a trigger node decides whether an inbound message starts this flow. */
export type TriggerMatchType = 'exact' | 'contains' | 'welcome' | 'any' | 'default';

export interface TriggerDef {
  matchType: TriggerMatchType;
  /** Normalized (trim + lowercase) keywords for exact/contains matching. */
  keywords?: string[];
  priority: number;
}

/** Deterministic trigger priority — lower wins. */
export const TRIGGER_PRIORITY: Record<TriggerMatchType, number> = {
  exact: 0,
  contains: 10,
  welcome: 20,
  any: 30,
  default: 40,
};

export type FlowScopeType = 'session' | 'sessions' | 'all';

export interface FlowScope {
  type: FlowScopeType;
  /** Required for 'session' (single) and 'sessions' (multi); ignored for 'all'. */
  sessionIds?: string[];
}

export type FlowRunStatus = 'active' | 'completed' | 'aborted' | 'expired';

/** Validation modes for a wait_for_reply capture node. */
export type CaptureValidation = 'text' | 'number' | 'email';

/** Comparison operators for a condition node rule. */
export type ConditionOp = 'equals' | 'contains' | 'isEmpty' | 'gt' | 'lt';

export interface ConditionRule {
  /** Variable name to read, or empty to use the last reply. */
  var?: string;
  op: ConditionOp;
  value?: string;
  /** sourceHandle of the outgoing edge taken when this rule matches. */
  handle: string;
}
