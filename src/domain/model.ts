import { Ajv } from "ajv";
import manifest from "../../contracts/plugin-manifest.json" with { type: "json" };

export type FixedRef = { object_id: string; revision: number; sha256: string };
export type Level = "book" | "volume" | "chapter";
export type Status = "unplanned" | "planning" | "planned" | "needs_revision";
export interface PlanNode {
  id: string;
  level: Level;
  title: string;
  subtitle: string;
  planning_status: Status;
  children: string[];
  archived: boolean;
  target_chapters: number;
  target_words: number;
  detail_ref: FixedRef | null;
}
export interface Plan {
  format_version: 1;
  root_id: string;
  author_constraints: string;
  nodes: PlanNode[];
  story_ref: FixedRef | null;
  run_ids: string[];
}
export interface Detail {
  format_version: 1;
  plan_id: string;
  node_id: string;
  summary: string;
  goal: string;
  theme: string;
  opening: string;
  conflict: string;
  start_state: string;
  end_state: string;
  hook: string;
  notes: string;
  turns: string[];
  questions: string[];
  detailed_plot: string;
  beats: {
    id: string;
    title: string;
    summary: string;
    entity_ids: string[];
    clue_ids: string[];
  }[];
  entity_links: { entity_id: string; role: string; notes: string }[];
  formal_documents: {
    document_id: string;
    revision_id: string;
    sha256: string;
  }[];
}
export type EntityType = "character" | "faction" | "location" | "item" | "rule";
export interface StoryEntity {
  id: string;
  type: EntityType;
  name: string;
  summary: string;
  notes: string;
  archived: boolean;
  canonical_ref: { source_index: number; entity_ref: string } | null;
}
export interface StoryRelation {
  id: string;
  from_id: string;
  to_id: string;
  label: string;
  notes: string;
  node_ids: string[];
  archived: boolean;
}
export interface Clue {
  id: string;
  title: string;
  description: string;
  status: "open" | "developing" | "resolved" | "abandoned";
  placements: {
    node_id: string;
    stage: "plant" | "hint" | "payoff";
    notes: string;
  }[];
  notes: string;
  archived: boolean;
}
export interface Network {
  format_version: 1;
  plan_id: string;
  entities: StoryEntity[];
  relations: StoryRelation[];
  clues: Clue[];
}
export type RunState =
  | "prepared"
  | "handed_off"
  | "running"
  | "stop_requested"
  | "stopped"
  | "succeeded"
  | "failed"
  | "unknown";
export interface Step {
  id: string;
  title: string;
  status:
    "pending" | "running" | "succeeded" | "failed" | "unknown" | "skipped";
  message: string;
  operation_key: string | null;
  result_ref: FixedRef | null;
  evidence: {
    kind: "agent_report" | "core_receipt" | "external_receipt";
    locator: string;
  };
}
export interface Run {
  format_version: 1;
  plan_ref: FixedRef;
  target_node_ids: string[];
  goal: string;
  state: RunState;
  steps: Step[];
  continuation: string;
}
export interface Issue {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
}
export class PlannerError extends Error {
  code: string;
  issues: Issue[];
  constructor(code: string, message: string, issues: Issue[] = []) {
    super(message);
    this.code = code;
    this.issues = issues;
  }
}
export function requireThat(
  value: unknown,
  message: string,
  code = "planner.invalid_structure",
): asserts value {
  if (!value) throw new PlannerError(code, message);
}
export const clone = <T>(value: T): T => structuredClone(value);
export const canonical = (value: any): string =>
  JSON.stringify(normalize(value));
function normalize(value: any): any {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((k) => [k, normalize(value[k])]),
    );
  return value;
}
export const byteLength = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).length;
let ajv: Ajv | undefined;
const validatorCache = new Map<string, ReturnType<Ajv["compile"]>>();
function compile(id: string, schema: any) {
  let validator = validatorCache.get(id);
  if (!validator) {
    ajv ??= new Ajv({ strict: false, allErrors: true });
    validator = ajv.compile(schema);
    validatorCache.set(id, validator);
  }
  return validator;
}
export function actionValidator(id: string) {
  const action = manifest.contributions.actions.find((a) => a.id === id);
  return action ? compile("action:" + id, action.input_schema) : undefined;
}
const limits: Record<string, number> = {
  novel_plan: 256 * 1024,
  novel_plan_detail: 512 * 1024,
  novel_plan_story_network: 256 * 1024,
  novel_plan_run: 128 * 1024,
};
export function validate(kind: string, content: any): void {
  const definition = manifest.contributions.data.find((d) => d.kind === kind);
  requireThat(definition, "未知规划类型。");
  const validator = compile(kind, definition.schema);
  if (!validator(content))
    throw new PlannerError(
      "planner.schema_invalid",
      "资料格式不完整，请核对标记字段。",
      validator.errors?.map((e) => ({
        code: "schema",
        severity: "error",
        path: e.instancePath,
        message: e.message ?? "格式错误",
      })),
    );
  const value: any = content;
  requireThat(
    byteLength(value) <= limits[kind],
    "内容超过该类型的字节预算。",
    "planner.budget_exceeded",
  );
  if (kind === "novel_plan") validatePlan(value);
  if (kind === "novel_plan_detail") {
    unique(
      value.beats.map((x: any) => x.id),
      "节拍ID重复。",
    );
    unique(
      value.entity_links.map((x: any) => x.entity_id),
      "实体关联重复。",
    );
  }
  if (kind === "novel_plan_story_network") validateNetwork(value);
  if (kind === "novel_plan_run")
    unique(
      value.steps.map((x: any) => x.id),
      "步骤ID重复。",
    );
}
export function unique(ids: string[], message: string) {
  requireThat(new Set(ids).size === ids.length, message);
}
export function validatePlan(plan: Plan) {
  const nodes = new Map(plan.nodes.map((n) => [n.id, n]));
  unique(
    plan.nodes.map((n) => n.id),
    "节点ID重复。",
  );
  requireThat(
    nodes.get(plan.root_id)?.level === "book" &&
      plan.nodes.filter((n) => n.level === "book").length === 1,
    "方案必须有唯一整书根节点。",
  );
  const seen = new Set<string>();
  const visit = (id: string) => {
    requireThat(!seen.has(id), "节点有多个父级或出现循环。");
    seen.add(id);
    const n = nodes.get(id);
    requireThat(n, "子节点引用不存在。");
    const childLevel: Record<Level, Level | null> = {
      book: "volume",
      volume: "chapter",
      chapter: null,
    };
    if (n.level === "chapter")
      requireThat(!n.children.length, "章节不能有子节点。");
    for (const child of n.children) {
      requireThat(
        nodes.get(child)?.level === childLevel[n.level],
        "节点层级不合法。",
      );
      visit(child);
    }
  };
  visit(plan.root_id);
  requireThat(seen.size === nodes.size, "存在不属于整书的孤立节点。");
  requireThat(!nodes.get(plan.root_id)?.archived, "整书根节点不能归档。");
  const details = plan.nodes
    .filter((n) => n.detail_ref)
    .map((n) => n.detail_ref!.object_id);
  unique(details, "同一详情不能关联多个节点。");
}
export function validateNetwork(network: Network) {
  const ids = new Set(network.entities.map((e) => e.id));
  unique(
    network.entities.map((e) => e.id),
    "实体ID重复。",
  );
  unique(
    network.relations.map((e) => e.id),
    "关系ID重复。",
  );
  unique(
    network.clues.map((c) => c.id),
    "伏笔ID重复。",
  );
  for (const edge of network.relations)
    requireThat(
      ids.has(edge.from_id) && ids.has(edge.to_id),
      "关系端点不存在。",
    );
  for (const clue of network.clues)
    unique(
      clue.placements.map((p) => p.node_id + ":" + p.stage),
      "伏笔在相同节点的阶段重复。",
    );
}
export function validateReferences(
  plan: Plan,
  detail?: Detail,
  network?: Network,
) {
  const nodes = new Set(plan.nodes.map((n) => n.id));
  if (detail) {
    requireThat(nodes.has(detail.node_id), "详情所属节点不存在。");
    if (network) {
      const entities = new Set(network.entities.map((e) => e.id)),
        clues = new Set(network.clues.map((c) => c.id));
      for (const link of detail.entity_links)
        requireThat(entities.has(link.entity_id), "详情引用的实体不存在。");
      for (const beat of detail.beats) {
        requireThat(
          beat.entity_ids.every((id) => entities.has(id)),
          "节拍引用的实体不存在。",
        );
        requireThat(
          beat.clue_ids.every((id) => clues.has(id)),
          "节拍引用的伏笔不存在。",
        );
      }
    } else
      requireThat(
        !detail.entity_links.length &&
          detail.beats.every((b) => !b.entity_ids.length && !b.clue_ids.length),
        "请先接入故事网络，再关联实体或伏笔。",
      );
  }
  if (network) {
    for (const r of network.relations)
      requireThat(
        r.node_ids.every((id) => nodes.has(id)),
        "关系引用的卷章不存在。",
      );
    for (const c of network.clues)
      requireThat(
        c.placements.every((p) => nodes.has(p.node_id)),
        "伏笔引用的卷章不存在。",
      );
  }
}
export function nodeOf(plan: Plan, id: string) {
  const n = plan.nodes.find((n) => n.id === id);
  requireThat(n, "规划节点不存在。", "not_found");
  return n;
}
export function parentOf(plan: Plan, id: string) {
  return plan.nodes.find((n) => n.children.includes(id));
}
export function pathTo(plan: Plan, id: string): PlanNode[] {
  const n = nodeOf(plan, id),
    p = parentOf(plan, id);
  return [...(p ? pathTo(plan, p.id) : []), n];
}
export function descendants(plan: Plan, id: string): string[] {
  const n = nodeOf(plan, id);
  return [n.id, ...n.children.flatMap((c) => descendants(plan, c))];
}
export const effectiveArchived = (plan: Plan, id: string) =>
  pathTo(plan, id).some((n) => n.archived);
export function transformNode(plan: Plan, action: string, input: any): Plan {
  const next = clone(plan);
  if (action === "patch_node")
    Object.assign(nodeOf(next, input.node_id), input.changes);
  else if (action === "insert_node") {
    requireThat(
      !next.nodes.some((n) => n.id === input.node.id),
      "新增节点ID已存在。",
    );
    requireThat(
      !input.node.children.length && input.node.detail_ref === null,
      "新节点先建立空结构，再接入固定详情。",
    );
    next.nodes.push(clone(input.node));
    insert(nodeOf(next, input.parent_id), input.node.id, input.before_id);
  } else if (action === "move_node") {
    const n = nodeOf(next, input.node_id),
      parent = parentOf(next, n.id);
    requireThat(parent, "不能移动整书根节点。");
    requireThat(input.before_id !== n.id, "不能以自身作为插入位置。");
    parent.children = parent.children.filter((id) => id !== n.id);
    insert(nodeOf(next, input.parent_id), n.id, input.before_id);
  } else if (action === "archive_node") {
    requireThat(input.node_id !== plan.root_id, "整书根节点不能归档。");
    nodeOf(next, input.node_id).archived = input.archived;
  } else throw new PlannerError("planner.unknown_action", "未知结构变换。");
  validate("novel_plan", next);
  return next;
}
function insert(parent: PlanNode, id: string, before?: string) {
  if (before) {
    const at = parent.children.indexOf(before);
    requireThat(at >= 0, "插入位置不属于目标父级。");
    parent.children.splice(at, 0, id);
  } else parent.children.push(id);
}
const transitions: Record<RunState, RunState[]> = {
  prepared: ["handed_off", "failed"],
  handed_off: ["running", "stop_requested", "failed", "unknown"],
  running: ["succeeded", "failed", "unknown", "stop_requested"],
  stop_requested: ["stopped", "running", "succeeded", "failed", "unknown"],
  unknown: ["running", "stop_requested", "stopped", "succeeded", "failed"],
  stopped: [],
  succeeded: [],
  failed: [],
};
export function validateRunChange(old: Run | undefined, next: Run) {
  if (!old)
    requireThat(
      next.state === "prepared" &&
        next.steps.every((s) => s.status === "pending"),
      "新工作记录只能从待交接开始。",
    );
  else {
    requireThat(
      canonical(old.plan_ref) === canonical(next.plan_ref),
      "工作记录不能更换固定方案。",
    );
    requireThat(
      old.state === next.state || transitions[old.state].includes(next.state),
      "工作记录状态不能这样变更。",
    );
    for (const step of old.steps) {
      const n = next.steps.find((s) => s.id === step.id);
      requireThat(n, "已有步骤不能移除。");
      if (step.status === "succeeded")
        requireThat(canonical(n) === canonical(step), "已完成步骤不能改写。");
    }
  }
  if (next.state === "stopped")
    requireThat(
      next.steps.some(
        (s) =>
          s.evidence.kind === "external_receipt" && s.evidence.locator.trim(),
      ),
      "停止成功需要外部确认。",
    );
  if (next.state === "succeeded")
    requireThat(
      next.steps.length &&
        next.steps.every((s) => ["succeeded", "skipped"].includes(s.status)),
      "必要步骤尚未全部完成。",
    );
  for (const step of next.steps)
    if (step.status === "succeeded")
      requireThat(
        step.result_ref || step.evidence.locator.trim(),
        "完成步骤必须保留成果或证据引用。",
      );
}
export function newNode(level: Level, title: string, id: string): PlanNode {
  return {
    id,
    level,
    title,
    subtitle: "",
    planning_status: "unplanned",
    children: [],
    archived: false,
    target_chapters: 0,
    target_words: 0,
    detail_ref: null,
  };
}
export function newPlan(title: string, id: string): Plan {
  return {
    format_version: 1,
    root_id: id,
    author_constraints: "",
    nodes: [newNode("book", title, id)],
    story_ref: null,
    run_ids: [],
  };
}
export function newDetail(plan_id: string, node_id: string): Detail {
  return {
    format_version: 1,
    plan_id,
    node_id,
    summary: "",
    goal: "",
    theme: "",
    opening: "",
    conflict: "",
    start_state: "",
    end_state: "",
    hook: "",
    notes: "",
    turns: [],
    questions: [],
    detailed_plot: "",
    beats: [],
    entity_links: [],
    formal_documents: [],
  };
}
export function changes(
  before: any,
  after: any,
  path = "",
): { path: string; before: any; after: any }[] {
  if (canonical(before) === canonical(after)) return [];
  if (
    Array.isArray(before) &&
    Array.isArray(after) &&
    [...before, ...after].every((v) => v && typeof v.id === "string")
  ) {
    const ids = [...new Set([...before, ...after].map((v) => v.id))];
    return ids.flatMap((id) =>
      changes(
        before.find((v) => v.id === id),
        after.find((v) => v.id === id),
        path + "/" + id,
      ),
    );
  }
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  )
    return [
      ...new Set([...Object.keys(before), ...Object.keys(after)]),
    ].flatMap((k) => changes(before[k], after[k], path + "/" + k));
  return [{ path, before: before ?? null, after: after ?? null }];
}
