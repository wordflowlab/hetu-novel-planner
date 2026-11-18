import { inspectBasis } from "./basis.ts";
import { depthWrites, newDepth, readDepth } from "./depth.ts";
import type { BackendContext, ObjectResult } from "../../vendor/hetu-sdk.ts";
import {
  ProjectStore,
  requireValue as need,
  data,
  fixed,
  success,
  failure,
} from "../../vendor/project-store.ts";
import {
  validate,
  validateAction,
  clone,
  canonical,
  effects,
} from "./model.ts";
export class Continuity {
  readonly store: ProjectStore;
  readonly context: BackendContext;
  constructor(context: BackendContext) {
    this.context = context;
    this.store = new ProjectStore(
      context,
      "org.wordflowlab.novel-planner",
      "novel_plan_continuity",
      validate,
    );
  }
  async check(p: any, refs: any[]) {
    validate(p);
    for (const ref of p.depth?.basis_refs ?? [])
      await inspectBasis(this.store, ref);
    const plan = data(
      await this.store.call("hetu.extensions.objects.get", {
        object_id: p.plan_ref.object_id,
        revision: p.plan_ref.revision,
      }),
    );
    need(
      plan.object.owner_plugin_id === "org.wordflowlab.novel-planner" &&
        plan.object.kind === "novel_plan" &&
        plan.sha256 === p.plan_ref.sha256,
      "关联规划的身份、类型或固定摘要不符。",
      "hetu.stale_evidence",
    );
    const sources = await this.store.sources(refs);
    if (p.depth) {
      const indices = [
        ...p.depth.coverage.map((c: any) => c.source_index),
        ...p.depth.event_basis.flatMap((b: any) => b.source_indices),
      ];
      need(
        indices.every((index: number) => index < sources.length),
        "深化来源索引越界。",
      );
    }
    for (const v of [
      ...p.events,
      ...p.states,
      ...(p.depth?.constraints ?? []),
      ...(p.depth?.knowledge ?? []),
    ])
      for (const e of v.evidence) {
        need(e.source_index < sources.length, "证据来源越界。");
        const text = sources[e.source_index].content;
        need(typeof text === "string", "需要可核对的固定文稿。");
        const b = Buffer.from(text);
        const boundary = (i: number) =>
          i === b.length || (i >= 0 && i < b.length && (b[i] & 0xc0) !== 0x80);
        need(
          e.byte_start <= e.byte_end &&
            boundary(e.byte_start) &&
            boundary(e.byte_end) &&
            b.subarray(e.byte_start, e.byte_end).toString() === e.quote,
          "证据UTF-8范围或引文无效。",
        );
      }
  }
  async save(i: any, p: any, old?: ObjectResult) {
    need(
      !(old?.object.content as any)?.depth || p.depth,
      "不能丢弃已有深化结构；请读取当前完整对象。",
      "hetu.stale_schema",
    );
    await this.check(p, i.source_refs ?? old?.object.source_refs ?? []);
    return this.store.save(i, p, old);
  }
  async invoke(action: string, raw: unknown) {
    try {
      validateAction(action, raw);
      const i: any = clone(raw);
      if (effects.has(action)) {
        const r = await this.store.recover(i.operation_key);
        if (r) return r;
      }
      if (action === "get_operation")
        return this.store.call("hetu.extensions.operations.get", i);
      if (action === "list_continuities")
        return this.store.call(
          i.query
            ? "hetu.extensions.objects.search"
            : "hetu.extensions.objects.list",
          { ...i, kind: this.store.kind },
        );
      if (action === "save_continuity") {
        need(
          i.object_id
            ? i.expected_revision > 0 && i.expected_sha256.length === 64
            : i.expected_revision === 0 && i.expected_sha256 === "",
          "连续性基线无效。",
        );
        const old = i.object_id ? await this.store.baseline(i) : undefined;
        return await this.save(i, i.content, old);
      }
      const r = effects.has(action)
          ? await this.store.baseline(i)
          : await this.store.get(i.object_id, i.revision),
        p: any = clone(r.object.content);
      if (effects.has(action)) {
        if (action === "save_depth" || depthWrites[action]) {
          if (action === "save_depth") p.depth = i.depth;
          else {
            p.depth ??= newDepth();
            const [field, key] = depthWrites[action];
            const at = p.depth[field].findIndex((v: any) => v.id === i[key].id);
            if (at < 0) p.depth[field].push(i[key]);
            else p.depth[field][at] = i[key];
          }
          return await this.save(i, p, r);
        }
        const key = action.slice(4),
          field =
            key === "decision"
              ? "decisions"
              : key === "event"
                ? "events"
                : "states";
        const at = p[field].findIndex((x: any) => x.id === i[key].id);
        if (at < 0) p[field].push(i[key]);
        else p[field][at] = i[key];
        return await this.save(i, p, r);
      }
      if (action === "get_continuity") return success(r);
      if (action === "inspect_basis") {
        const ref = p.depth?.basis_refs?.[i.basis_index];
        need(ref, "专业依据索引不存在。");
        return success({
          project_ref: fixed(r),
          basis_ref: ref,
          record: await inspectBasis(this.store, ref),
        });
      }
      if (action === "preview_continuity_impact")
        need(
          i.changed_source_indices.every(
            (j: number) => j < (r.object.source_refs ?? []).length,
          ),
          "变化来源越界。",
        );
      const depthResult = readDepth(p, action, i);
      if (depthResult !== undefined)
        return success({ project_ref: fixed(r), ...depthResult });
      if (action === "get_timeline") {
        const events = [...p.events].sort((a, b) =>
          i.order === "story"
            ? a.story_time === null
              ? b.story_time === null
                ? 0
                : 1
              : b.story_time === null
                ? -1
                : a.story_time.localeCompare(b.story_time)
            : a.narrative_order - b.narrative_order,
        );
        return success({
          project_ref: fixed(r),
          order: i.order,
          time_basis:
            i.order === "story"
              ? "作者记录的时间文本排序，不推算未知日期"
              : "显式叙事顺序",
          events,
          states: p.states,
        });
      }
      const context = {
          goal: i.goal,
          project_ref: fixed(r),
          plan_ref: p.plan_ref,
          decisions: p.decisions,
          events: p.events,
          states: p.states,
          depth: p.depth ?? null,
          source_refs: r.object.source_refs ?? [],
          instructions:
            "选中方向仍是规划；核对已写事实和未写计划，续写通过宿主固定任务提交候选，采纳另行决定。",
        },
        content = canonical(context);
      need(
        [...content].length <= i.max_chars,
        "必要接续上下文超出预算，请缩小范围。",
        "hetu.budget_exceeded",
      );
      return success({
        ...context,
        content,
        chars: [...content].length,
        bytes: Buffer.byteLength(content),
        token_count: null,
      });
    } catch (e) {
      return failure(e);
    }
  }
}
