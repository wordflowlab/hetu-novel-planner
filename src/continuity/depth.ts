import { requireValue as need, canonical } from "../../vendor/project-store.ts";
export const depthWrites: Record<string, [string, string]> = {
  put_event_basis: ["event_basis", "event_basis"],
  put_temporal_constraint: ["constraints", "constraint"],
  put_knowledge_transition: ["knowledge", "transition"],
};
export const newDepth = () => ({
  version: 1,
  event_basis: [],
  constraints: [],
  knowledge: [],
  coverage: [],
});
export function validateDepth(p: any) {
  if (!p.depth) return;
  const d = p.depth,
    ids = new Set(p.events.map((e: any) => e.id));
  for (const key of ["event_basis", "constraints", "knowledge"])
    need(
      new Set(d[key].map((e: any) => e.id)).size === d[key].length,
      "深化记录ID重复。",
    );
  need(
    new Set(d.event_basis.map((b: any) => b.event_id)).size ===
      d.event_basis.length,
    "事件依据重复。",
  );
  need(
    new Set(d.coverage.map((c: any) => c.source_index)).size ===
      d.coverage.length,
    "阅读覆盖重复。",
  );
  for (const b of d.event_basis) {
    need(
      ids.has(b.event_id) &&
        b.depends_on_event_ids.every(
          (id: string) => ids.has(id) && id !== b.event_id,
        ),
      "事件依据或依赖引用无效。",
    );
    if (b.basis === "observed") {
      const e = p.events.find((e: any) => e.id === b.event_id);
      need(e.evidence.length > 0, "已发生事件需要固定证据。");
      need(
        e.evidence.every((e: any) => b.source_indices.includes(e.source_index)),
        "事件依据必须包括全部固定证据。",
      );
      need(
        b.source_indices.every((i: number) =>
          d.coverage.some(
            (c: any) => c.source_index === i && c.status === "read",
          ),
        ),
        "已发生事件引用尚未读完的来源。",
      );
    }
  }
  for (const c of d.constraints) {
    need(
      ids.has(c.from) && ids.has(c.to) && c.from !== c.to,
      "时间约束端点无效。",
    );
    const a = d.event_basis.find((b: any) => b.event_id === c.from),
      b = d.event_basis.find((b: any) => b.event_id === c.to);
    need(
      a && b && a.layer === b.layer && a.branch === b.branch,
      "约束端点必须属于明确且相同的叙事层和分支。",
    );
    need(
      c.gap === null || c.gap.max === null || c.gap.max >= c.gap.min,
      "时间区间上下界无效。",
    );
    need(
      c.relation !== "simultaneous" ||
        c.gap === null ||
        (c.gap.min === 0 && c.gap.max === 0),
      "同时事件不能具有非零间隔。",
    );
  }
  for (const k of d.knowledge)
    need(
      ids.has(k.event_id) &&
        d.event_basis.some((b: any) => b.event_id === k.event_id),
      "信息变化需要明确事件依据。",
    );
}
export function temporal(p: any) {
  const d = p.depth ?? newDepth(),
    parent = new Map<string, string>(
      d.event_basis.map((b: any) => [b.event_id, b.event_id]),
    );
  const root = (v: string): string => {
    const par = parent.get(v)!;
    if (par === v) return v;
    const r = root(par);
    parent.set(v, r);
    return r;
  };
  for (const c of d.constraints)
    if (c.relation === "simultaneous") parent.set(root(c.to), root(c.from));
  const components = new Map<string, string[]>();
  for (const id of parent.keys()) {
    const r = root(id);
    components.set(r, [...(components.get(r) ?? []), id]);
  }
  const edges = new Map<string, { to: string; id: string }[]>();
  for (const id of components.keys()) edges.set(id, []);
  for (const c of d.constraints)
    if (c.relation !== "simultaneous") {
      const from = root(c.relation === "before" ? c.from : c.to),
        to = root(c.relation === "before" ? c.to : c.from);
      edges.get(from)!.push({ to, id: c.id });
    }
  const conflicts: any[] = [],
    marks = new Map<string, number>(),
    stack: string[] = [],
    path: string[] = [];
  const visit = (id: string) => {
    marks.set(id, 1);
    stack.push(id);
    for (const e of edges.get(id) ?? []) {
      if (marks.get(e.to) === 1) {
        const at = stack.indexOf(e.to);
        conflicts.push({
          kind: "cycle",
          event_ids: stack.slice(at).flatMap((x) => components.get(x)!),
          constraint_ids: [...path.slice(at), e.id],
        });
      } else if (!marks.has(e.to)) {
        path.push(e.id);
        visit(e.to);
        path.pop();
      }
    }
    stack.pop();
    marks.set(id, 2);
  };
  for (const id of components.keys()) if (!marks.has(id)) visit(id);
  // 相同显式单位内求差分约束，不猜测历法或跨单位换算。
  const units = [
    ...new Set<string>(
      d.constraints
        .filter((c: any) => c.gap !== null)
        .map((c: any) => c.gap.unit),
    ),
  ];
  const intervals: any[] = [];
  for (const unit of units) {
    const cs = d.constraints.filter((c: any) => c.gap?.unit === unit),
      weighted: { from: string; to: string; w: number; id: string }[] = [];
    for (const c of cs) {
      const a = root(c.relation === "after" ? c.to : c.from),
        b = root(c.relation === "after" ? c.from : c.to);
      weighted.push({ from: b, to: a, w: -c.gap.min, id: c.id });
      if (c.gap.max !== null)
        weighted.push({ from: a, to: b, w: c.gap.max, id: c.id });
    }
    const distance = new Map<string, number>(
        [...components.keys()].map((id) => [id, 0]),
      ),
      prev = new Map<string, { from: string; id: string }>();
    let changed: string | undefined;
    for (let pass = 0; pass < components.size; pass++) {
      changed = undefined;
      for (const e of weighted)
        if (distance.get(e.to)! > distance.get(e.from)! + e.w) {
          distance.set(e.to, distance.get(e.from)! + e.w);
          prev.set(e.to, { from: e.from, id: e.id });
          changed = e.to;
        }
      if (!changed) break;
    }
    if (changed) {
      let id = changed;
      for (let n = 0; n < components.size; n++) id = prev.get(id)!.from;
      const cycle: string[] = [],
        start = id;
      do {
        cycle.push(prev.get(id)!.id);
        id = prev.get(id)!.from;
      } while (id !== start && cycle.length <= components.size + 1);
      conflicts.push({
        kind: "interval",
        unit,
        constraint_ids: [...new Set(cycle)],
      });
    }
    intervals.push({
      unit,
      valid: !changed,
      constraint_ids: cs.map((c: any) => c.id),
    });
  }
  const indegree = new Map<string, number>(
    [...components.keys()].map((id) => [id, 0]),
  );
  for (const es of edges.values())
    for (const e of es) indegree.set(e.to, indegree.get(e.to)! + 1);
  const levels: string[][][] = [];
  let frontier = [...indegree]
    .filter(([, n]) => n === 0)
    .map(([id]) => id)
    .sort();
  while (frontier.length) {
    levels.push(frontier.map((id) => components.get(id)!.sort()));
    const next: string[] = [];
    for (const id of frontier)
      for (const e of edges.get(id) ?? []) {
        indegree.set(e.to, indegree.get(e.to)! - 1);
        if (indegree.get(e.to) === 0) next.push(e.to);
      }
    frontier = next.sort();
  }
  return {
    levels,
    conflicts,
    intervals,
    partial_order: true,
    unbound_event_ids: p.events
      .filter((e: any) => !parent.has(e.id))
      .map((e: any) => e.id),
    unknown_time_event_ids: p.events
      .filter((e: any) => e.story_time === null)
      .map((e: any) => e.id),
    basis: "仅明确偏序；同层级不同组可互不可比，同组明确同时；不解析时间标签",
    complete: conflicts.length === 0 && parent.size === p.events.length,
  };
}
function precedes(d: any, from: string, to: string): boolean {
  if (from === to) return true;
  const visited = new Set<string>(),
    pending = [from];
  while (pending.length) {
    const id = pending.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    for (const c of d.constraints) {
      const next =
        c.relation === "simultaneous"
          ? c.from === id
            ? c.to
            : c.to === id
              ? c.from
              : null
          : c.relation === "before"
            ? c.from === id
              ? c.to
              : null
            : c.to === id
              ? c.from
              : null;
      if (next === to) return true;
      if (next && !visited.has(next)) pending.push(next);
    }
  }
  return false;
}
export function knowledge(p: any, entity_ref: string, event_id: string) {
  const d = p.depth ?? newDepth(),
    target = d.event_basis.find((b: any) => b.event_id === event_id);
  need(target, "目标事件依据未知。");
  const result = temporal(p);
  need(
    !result.conflicts.length,
    "时间约束冲突，无法可靠投影人物知情。",
    "hetu.temporal_conflict",
  );
  const eligible = d.knowledge.filter(
    (k: any) =>
      k.entity_ref === entity_ref &&
      d.event_basis.some(
        (b: any) =>
          b.event_id === k.event_id &&
          b.layer === target.layer &&
          b.branch === target.branch &&
          b.basis === "observed",
      ),
  );
  const states: any[] = [],
    uncertain: any[] = [];
  for (const proposition of new Set<string>(
    eligible.map((k: any) => k.proposition),
  )) {
    const ks = eligible.filter((k: any) => k.proposition === proposition),
      prior = ks.filter((k: any) => precedes(d, k.event_id, event_id)),
      unknown = ks.filter(
        (k: any) =>
          !precedes(d, k.event_id, event_id) &&
          !precedes(d, event_id, k.event_id),
      );
    const latest = prior.filter(
      (k: any) =>
        !prior.some(
          (other: any) =>
            other.id !== k.id &&
            precedes(d, k.event_id, other.event_id) &&
            !precedes(d, other.event_id, k.event_id),
        ),
    );
    if (unknown.length || latest.length > 1) {
      uncertain.push({
        proposition,
        transition_ids: [...unknown, ...latest].map((k: any) => k.id),
        reason: "先后不可比或同点变化，不能猜测最后状态",
      });
      continue;
    }
    if (latest.length) {
      const k = latest[0];
      states.push({
        proposition,
        state:
          k.change === "learn"
            ? "known"
            : k.change === "believe"
              ? "belief"
              : "forgotten",
        transition_id: k.id,
        evidence: k.evidence,
      });
    }
  }
  return {
    entity_ref,
    event_id,
    states,
    uncertain,
    complete: !uncertain.length,
    target_basis: target.basis,
    reader_knowledge_inferred: false,
  };
}
export function impact(p: any, changed: number[]) {
  const d = p.depth ?? newDepth(),
    reasons = new Map<string, string[]>();
  for (const e of p.events)
    if (
      e.evidence.some((q: any) => changed.includes(q.source_index)) ||
      d.event_basis.some(
        (b: any) =>
          b.event_id === e.id &&
          b.source_indices.some((i: number) => changed.includes(i)),
      )
    )
      reasons.set(e.id, ["固定依据来源发生变化"]);
  let progress = true;
  while (progress) {
    progress = false;
    for (const b of d.event_basis)
      if (!reasons.has(b.event_id)) {
        const hits = b.depends_on_event_ids.filter((id: string) =>
          reasons.has(id),
        );
        if (hits.length) {
          reasons.set(
            b.event_id,
            hits.map((id: string) => "依赖受影响事件：" + id),
          );
          progress = true;
        }
      }
  }
  const affected = [...reasons.keys()];
  return {
    changed_source_indices: changed,
    events: [...reasons].map(([event_id, reasons]) => ({
      event_id,
      reasons,
      status: "needs_review",
    })),
    knowledge: d.knowledge
      .filter((k: any) => affected.includes(k.event_id))
      .map((k: any) => k.id),
    entities: [
      ...new Set(
        p.events
          .filter((e: any) => affected.includes(e.id))
          .flatMap((e: any) => e.participants),
      ),
    ],
    decisions: p.decisions.map((d: any) => ({
      id: d.id,
      status: "needs_semantic_review",
      reason: "走向、承诺和伏笔需Agent核对，未建立依赖的不假称无影响",
    })),
    coverage: d.coverage,
    unchanged_continuity: true,
    complete_semantic_recall: false,
  };
}
export function readDepth(p: any, action: string, i: any): any {
  if (action === "preview_temporal_constraints") return temporal(p);
  if (action === "preview_knowledge")
    return knowledge(p, i.entity_ref, i.event_id);
  if (action === "preview_continuity_impact")
    return impact(p, i.changed_source_indices);
  return undefined;
}
