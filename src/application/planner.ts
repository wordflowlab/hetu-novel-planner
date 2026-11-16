import { createHash } from "node:crypto";
import type { BackendContext } from "../../vendor/hetu-sdk.ts";
import {
  actionValidator,
  canonical,
  clone,
  byteLength,
  validate,
  validateReferences,
  validateRunChange,
  requireThat,
  PlannerError,
  nodeOf,
  pathTo,
  descendants,
  effectiveArchived,
  transformNode,
  changes,
  type Plan,
  type Detail,
  type Network,
  type Run,
  type FixedRef,
} from "../domain/model.ts";

type RecordResult = { object: any; sha256: string };
const prefix = "hetu.extensions.";
const hash = (v: any) =>
  createHash("sha256").update(canonical(v)).digest("hex");
const fixed = (r: RecordResult): FixedRef => ({
  object_id: r.object.object_id,
  revision: r.object.revision,
  sha256: r.sha256,
});
export class Planner {
  private context: BackendContext;
  private cache = new Map<string, RecordResult>();
  constructor(context: BackendContext) {
    this.context = context;
  }
  private async request(action: string, input: any) {
    const result = await this.context.request(prefix + action, {
      ...input,
      work_ref: this.context.work_ref,
    });
    return result as any;
  }
  private unwrap(result: any): any {
    if (result.status !== "succeeded")
      throw new PlannerError(
        result.error?.code ?? "planner.core_failure",
        result.error?.message ?? "操作尚未完成。",
      );
    return result.data;
  }
  private async get(
    id: string,
    revision?: number,
    kind?: string,
  ): Promise<RecordResult> {
    const key = id + ":" + (revision ?? "head");
    const cached = this.cache.get(key);
    if (cached) {
      if (kind)
        requireThat(cached.object.kind === kind, "对象类型与当前操作不符。");
      return cached;
    }
    const r = this.unwrap(
      await this.request("objects.get", {
        object_id: id,
        ...(revision === undefined ? {} : { revision }),
      }),
    );
    requireThat(
      r.object.owner_plugin_id === "org.wordflowlab.novel-planner",
      "对象不属于小说规划插件。",
      "forbidden",
    );
    if (kind) requireThat(r.object.kind === kind, "对象类型与当前操作不符。");
    validate(r.object.kind, r.object.content);
    this.cache.set(key, r);
    return r;
  }
  private async referenced(ref: FixedRef, kind: string) {
    const r = await this.get(ref.object_id, ref.revision, kind);
    requireThat(
      r.sha256 === ref.sha256,
      "附件固定摘要不一致。",
      "hetu.stale_evidence",
    );
    return r;
  }
  private async baseline(input: any, kind: string) {
    const r = await this.get(input.object_id, input.expected_revision, kind);
    requireThat(
      r.sha256 === input.expected_sha256,
      "编辑基线摘要不一致。",
      "revision_conflict",
    );
    return r;
  }
  private async network(
    plan: Plan,
    planId: string,
  ): Promise<Network | undefined> {
    if (!plan.story_ref) return undefined;
    const r = await this.referenced(plan.story_ref, "novel_plan_story_network");
    requireThat(r.object.content.plan_id === planId, "故事网络属于其他方案。");
    validateReferences(plan, undefined, r.object.content);
    return r.object.content;
  }
  private async detail(
    plan: Plan,
    planId: string,
    nodeId: string,
    network?: Network,
  ): Promise<RecordResult | undefined> {
    const ref = nodeOf(plan, nodeId).detail_ref;
    if (!ref) return undefined;
    const r = await this.referenced(ref, "novel_plan_detail"),
      d = r.object.content as Detail;
    requireThat(
      d.plan_id === planId && d.node_id === nodeId,
      "详情不属于当前方案节点。",
    );
    validateReferences(plan, d, network);
    return r;
  }
  private async validateAggregate(r: RecordResult, previous?: Plan) {
    const plan = r.object.content as Plan,
      network = await this.network(plan, r.object.object_id);
    const changed = plan.nodes.filter(
      (n) =>
        n.detail_ref &&
        canonical(
          previous?.nodes.find((old) => old.id === n.id)?.detail_ref,
        ) !== canonical(n.detail_ref),
    );
    requireThat(
      changed.length <= 100,
      "本次接入详情超过100个，请分批沿固定基线接入。",
      "planner.budget_exceeded",
    );
    for (const n of changed)
      await this.detail(plan, r.object.object_id, n.id, network);
    for (const id of plan.run_ids)
      if (!previous?.run_ids.includes(id)) {
        const run = await this.get(id, undefined, "novel_plan_run");
        requireThat(
          run.object.content.plan_ref.object_id === r.object.object_id,
          "工作记录属于其他方案。",
        );
      }
    return network;
  }
  private keepNetwork(old: Network, next: Network) {
    for (const k of ["entities", "relations", "clues"] as const)
      for (const item of old[k]) {
        const n = next[k].find((v: any) => v.id === item.id);
        requireThat(n, "已有故事元素须归档保留，不能删除。");
        if (k === "entities")
          requireThat(
            (n as any).type === (item as any).type,
            "实体身份不能更换类型。",
          );
      }
  }
  private async validateRun(run: Run) {
    const plan = (await this.referenced(run.plan_ref, "novel_plan")).object
      .content as Plan;
    for (const id of run.target_node_ids) nodeOf(plan, id);
    for (const step of run.steps) {
      if (step.result_ref) await this.referenced(step.result_ref, "");
      if (step.evidence.kind === "core_receipt") {
        requireThat(
          step.operation_key && step.evidence.locator === step.operation_key,
          "Core回执须引用确切原操作键。",
        );
        const result = this.unwrap(
          await this.request("operations.get", {
            operation_key: step.operation_key,
          }),
        );
        requireThat(
          result.object &&
            step.result_ref &&
            canonical(fixed(result)) === canonical(step.result_ref),
          "Core回执与固定成果不一致。",
        );
      }
    }
  }
  private cursor(value: any) {
    return Buffer.from(canonical(value)).toString("base64url");
  }
  private decode(value: string) {
    try {
      const c = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
      if (
        !c ||
        typeof c !== "object" ||
        Array.isArray(c) ||
        !Number.isSafeInteger(c.offset) ||
        c.offset < 0 ||
        (c.unit !== undefined && (!Number.isSafeInteger(c.unit) || c.unit < 0))
      )
        throw new Error();
      return c;
    } catch {
      throw new PlannerError(
        "planner.invalid_cursor",
        "分页引用无效，请重新读取。",
      );
    }
  }
  private async snapshot(input: any, tag: string) {
    const cursor = input.cursor ? this.decode(input.cursor) : undefined;
    if (cursor)
      requireThat(
        cursor.tag === tag && cursor.id === input.object_id,
        "分页引用不属于当前操作。",
      );
    const r = await this.get(
      input.object_id,
      cursor?.revision ?? input.revision,
      "novel_plan",
    );
    if (cursor)
      requireThat(
        cursor.sha === r.sha256 &&
          (input.revision === undefined ||
            input.revision === r.object.revision),
        "分页固定成果已失效。",
      );
    return { r, cursor, plan: r.object.content as Plan };
  }
  private async save(
    input: any,
    kind: string,
    content: any,
    previous?: RecordResult,
  ) {
    validate(kind, content);
    requireThat(
      byteLength(input) <= 640 * 1024,
      "固定操作输入超过预算。",
      "planner.budget_exceeded",
    );
    return this.request("objects.save", {
      ...(input.object_id ? { object_id: input.object_id } : {}),
      kind,
      title: input.title ?? previous?.object.title,
      schema_version: "1.0.0",
      content,
      source_refs: input.source_refs ?? previous?.object.source_refs ?? [],
      expected_revision: input.expected_revision,
      expected_sha256: input.expected_sha256,
      operation_key: input.operation_key,
    });
  }
  private async preserveSources(kind: string, content: any, sources: any[]) {
    if (kind === "novel_plan_detail")
      for (const doc of content.formal_documents) {
        requireThat(
          sources.some(
            (s) =>
              s.kind === "document" &&
              s.document_id === doc.document_id &&
              s.revision_id === doc.revision_id &&
              s.sha256 === doc.sha256,
          ),
          "正式章节必须有对应的固定来源。",
        );
      }
    if (kind === "novel_plan_story_network")
      for (const e of content.entities)
        if (e.canonical_ref) {
          const source = sources[e.canonical_ref.source_index];
          requireThat(source, "正式实体来源索引不存在。");
          // Core负责读取获权固定来源并核验实体；插件不能自报通过。
          const checked = this.unwrap(
            await this.request("sources.inspect", {
              source_ref: source,
              entity_ref: e.canonical_ref.entity_ref,
            }),
          );
          requireThat(
            checked.entity_kind === e.type ||
              (e.type === "item" && checked.entity_kind === "asset"),
            "正式来源与规划实体类型不一致。",
          );
        }
  }
  async invoke(action: string, input: any): Promise<any> {
    try {
      this.cache.clear();
      requireThat(
        this.context.work_ref.kind === "novel",
        "小说规划仅服务当前小说。",
        "forbidden",
      );
      const validator = actionValidator(action);
      requireThat(validator, "未知规划动作。", "planner.unknown_action");
      const valid = (validator as (value: unknown) => boolean)(input);
      requireThat(
        valid,
        "动作输入格式不正确。",
        "planner.schema_invalid",
      );
      if (input.operation_key) {
        const recovered = await this.request("operations.get", {
          operation_key: input.operation_key,
        });
        if (recovered.status === "succeeded") return recovered;
        if (recovered.error?.code !== "not_found") return recovered;
      }
      return await this.execute(action, input);
    } catch (error) {
      const e = error as PlannerError;
      return {
        spec_version: "0.2.1",
        status: "failed",
        error: {
          code: e.code ?? "planner.failure",
          message: e.message ?? "操作失败。",
        },
        data: e.issues?.length ? { issues: e.issues } : undefined,
      };
    }
  }
  private async execute(action: string, input: any): Promise<any> {
    if (action === "list_plans") {
      const r = await this.request("objects.search", {
        query: input.query ?? "",
        kind: "novel_plan",
        limit: input.limit ?? 20,
        ...(input.cursor ? { cursor: input.cursor } : {}),
      });
      return r;
    }
    if (action === "get_plan" || action === "get_node") {
      const r = await this.get(input.object_id, input.revision, "novel_plan"),
        plan = r.object.content as Plan;
      if (action === "get_node") {
        const node = nodeOf(plan, input.node_id);
        return this.ok({
          plan_ref: fixed(r),
          node,
          path: pathTo(plan, node.id).map((n) => ({
            id: n.id,
            title: n.title,
          })),
          effective_archived: effectiveArchived(plan, node.id),
        });
      }
      if (input.projection === "summary")
        return this.ok({
          plan_ref: fixed(r),
          title: r.object.title,
          author_constraints: plan.author_constraints,
          nodes: plan.nodes,
          story_ref: plan.story_ref,
          run_ids: plan.run_ids,
        });
      return this.ok(r);
    }
    if (action === "get_detail")
      return this.ok(
        await this.get(input.object_id, input.revision, "novel_plan_detail"),
      );
    if (action === "put_plan") {
      const old = input.object_id
        ? await this.baseline(input, "novel_plan")
        : undefined;
      const next = input.content as Plan;
      if (old) {
        for (const node of old.object.content.nodes) {
          const n = nodeOf(next, node.id);
          requireThat(n.level === node.level, "节点ID与层级不可改写。");
        }
        requireThat(
          next.root_id === old.object.content.root_id,
          "整书根身份不可改变。",
        );
      } else
        requireThat(
          !next.story_ref &&
            !next.run_ids.length &&
            next.nodes.every((n) => !n.detail_ref),
          "新方案先创建结构，再接入已有成果。",
        );
      if (old) {
        if (
          old.object.content.story_ref &&
          canonical(old.object.content.story_ref) !== canonical(next.story_ref)
        ) {
          requireThat(next.story_ref, "已接入故事网络不能移除。");
          this.keepNetwork(
            (await this.network(old.object.content, old.object.object_id))!,
            (await this.network(next, old.object.object_id))!,
          );
        }
        for (const id of old.object.content.run_ids)
          requireThat(next.run_ids.includes(id), "已接入工作记录不能移除。");
        await this.validateAggregate(
          { object: { ...old.object, content: next }, sha256: "" },
          old.object.content,
        );
      }
      return this.save(input, "novel_plan", next, old);
    }
    if (
      ["patch_node", "insert_node", "move_node", "archive_node"].includes(
        action,
      )
    ) {
      const old = await this.baseline(input, "novel_plan");
      const content = transformNode(old.object.content, action, input);
      return this.save(input, "novel_plan", content, old);
    }
    if (["put_detail", "put_story_network", "put_run"].includes(action)) {
      const kind = (
        {
          put_detail: "novel_plan_detail",
          put_story_network: "novel_plan_story_network",
          put_run: "novel_plan_run",
        } as Record<string, string>
      )[action];
      const old = input.object_id
          ? await this.baseline(input, kind)
          : undefined,
        c = input.content;
      validate(kind, c);
      if (kind === "novel_plan_run") {
        validateRunChange(old?.object.content, c);
        await this.validateRun(c);
      } else {
        const r = await this.get(c.plan_id, undefined, "novel_plan"),
          plan = r.object.content as Plan;
        if (old)
          requireThat(
            old.object.content.plan_id === c.plan_id &&
              (kind !== "novel_plan_detail" ||
                old.object.content.node_id === c.node_id),
            "附件归属不可改变。",
          );
        if (kind === "novel_plan_detail")
          validateReferences(plan, c, await this.network(plan, c.plan_id));
        else {
          validateReferences(plan, undefined, c);
          if (old) this.keepNetwork(old.object.content, c);
          const attached = await this.network(plan, c.plan_id);
          if (attached) this.keepNetwork(attached, c);
        }
      }
      await this.preserveSources(kind, c, input.source_refs);
      return this.save(input, kind, c, old);
    }
    if (action === "attach_object") {
      const r = await this.baseline(input, "novel_plan"),
        plan = clone(r.object.content) as Plan;
      const kind = (
        {
          detail: "novel_plan_detail",
          story: "novel_plan_story_network",
          run: "novel_plan_run",
        } as Record<string, string>
      )[input.role];
      const target = await this.referenced(input.target, kind),
        c = target.object.content;
      requireThat(
        (input.role === "run" ? c.plan_ref.object_id : c.plan_id) ===
          input.object_id,
        "成果属于其他方案。",
      );
      if (input.role === "detail") {
        requireThat(c.node_id === input.node_id, "详情不属于所选节点。");
        validateReferences(plan, c, await this.network(plan, input.object_id));
        nodeOf(plan, input.node_id).detail_ref = input.target;
      } else if (input.role === "story") {
        validateReferences(plan, undefined, c);
        const old = await this.network(plan, input.object_id);
        if (old) this.keepNetwork(old, c);
        plan.story_ref = input.target;
      } else if (!plan.run_ids.includes(target.object.object_id))
        plan.run_ids.push(target.object.object_id);
      return this.save(input, "novel_plan", plan, r);
    }
    if (action === "get_story_network") {
      const r = await this.get(
          input.object_id,
          input.revision,
          "novel_plan_story_network",
        ),
        network = r.object.content as Network;
      let nodeIds: Set<string> | undefined;
      if (input.node_id) {
        const p = await this.referenced(input.plan_ref, "novel_plan"),
          plan = p.object.content as Plan;
        requireThat(
          p.object.object_id === network.plan_id &&
            canonical(plan.story_ref) === canonical(fixed(r)),
          "网络不是所选固定方案的来源。",
        );
        const ids =
          input.scope === "direct"
            ? [nodeOf(plan, input.node_id).id]
            : descendants(plan, input.node_id);
        const identity = hash({
            plan_ref: input.plan_ref,
            node: input.node_id,
            scope: input.scope ?? "descendants",
            entity_type: input.entity_type,
            network: fixed(r),
          }),
          cursor = input.cursor ? this.decode(input.cursor) : undefined;
        if (cursor)
          requireThat(
            cursor.tag === "scope" && cursor.query === identity,
            "关联分页条件改变。",
          );
        const start = cursor?.offset ?? 0;
        requireThat(start < ids.length, "关联分页位置无效。");
        const end = Math.min(start + 100, ids.length);
        nodeIds = new Set(ids.slice(start, end));
        const associations: any[] = [];
        for (const id of nodeIds) {
          const d = await this.detail(plan, p.object.object_id, id, network);
          for (const link of d?.object.content.entity_links ?? [])
            associations.push({ ...link, node_id: id });
        }
        const entityIds = new Set(associations.map((l) => l.entity_id));
        return this.ok({
          ref: fixed(r),
          plan_ref: fixed(p),
          projection: {
            entities: network.entities.filter(
              (e) =>
                entityIds.has(e.id) &&
                (!input.entity_type || e.type === input.entity_type),
            ),
            associations,
            relations: network.relations.filter((e) =>
              e.node_ids.some((id) => nodeIds!.has(id)),
            ),
            clues: network.clues.filter((c) =>
              c.placements.some((p) => nodeIds!.has(p.node_id)),
            ),
          },
          next_cursor:
            end < ids.length
              ? this.cursor({ tag: "scope", query: identity, offset: end })
              : null,
        });
      }
      const projection = input.projection ?? "full";
      return this.ok(
        projection === "full"
          ? r
          : {
              ref: fixed(r),
              [projection]: (network as any)[projection].filter(
                (e: any) =>
                  projection !== "entities" ||
                  !input.entity_type ||
                  e.type === input.entity_type,
              ),
            },
      );
    }
    if (action === "query_nodes") return this.query(input);
    if (action === "check_plan") return this.check(input);
    if (action === "compare_revisions") return this.compare(input);
    if (action === "export_plan") return this.export(input);
    if (action === "get_progress") {
      const { r, cursor, plan } = await this.snapshot(input, "progress");
      const identity = hash({ run_id: input.run_id, limit: input.limit ?? 5 });
      if (cursor) requireThat(cursor.query === identity, "工作分页条件改变。");
      if (input.run_id)
        requireThat(
          plan.run_ids.includes(input.run_id),
          "工作记录尚未接入当前方案。",
        );
      const ids = input.run_id ? [input.run_id] : plan.run_ids,
        runs = [];
      let at = cursor?.offset ?? 0;
      if (cursor) requireThat(at < ids.length, "工作分页位置无效。");
      for (; at < ids.length && runs.length < (input.limit ?? 5); at++) {
        const run = await this.get(ids[at], undefined, "novel_plan_run");
        requireThat(
          run.object.content.plan_ref.object_id === input.object_id,
          "工作记录不属于当前方案。",
        );
        if (runs.length && byteLength([...runs, run]) > 640 * 1024) break;
        runs.push(run);
      }
      return this.ok({
        plan_ref: fixed(r),
        runs,
        next_cursor:
          at < ids.length
            ? this.cursor({
                tag: "progress",
                id: input.object_id,
                revision: r.object.revision,
                sha: r.sha256,
                query: identity,
                offset: at,
              })
            : null,
        consistency: "live_runs_fixed_individually",
      });
    }
    if (action === "patch_run" || action === "request_stop") {
      const r = await this.baseline(input, "novel_plan_run"),
        next = clone(r.object.content) as Run;
      if (action === "request_stop") {
        next.state = "stop_requested";
        next.continuation = input.reason;
      } else
        for (const key of ["state", "steps", "continuation"])
          if (key in input) (next as any)[key] = input[key];
      validateRunChange(r.object.content, next);
      await this.validateRun(next);
      return this.save(input, "novel_plan_run", next, r);
    }
    throw new PlannerError("planner.unknown_action", "未知规划动作。");
  }
  private ok(data: any) {
    return { spec_version: "0.2.1", status: "succeeded", data };
  }
  private async query(input: any) {
    const { r, cursor, plan } = await this.snapshot(input, "query"),
      query = (input.query ?? "").toLocaleLowerCase(),
      limit = input.limit ?? 20;
    const identity = hash({
      query,
      level: input.level,
      planning_status: input.planning_status,
      include_archived: !!input.include_archived,
      limit,
    });
    if (cursor)
      requireThat(cursor.query === identity, "查询条件改变，请重新检索。");
    if(cursor)requireThat(cursor.offset<plan.nodes.length,"查询分页位置无效。");
    const network = await this.network(plan, input.object_id),
      matches = [];
    let at = cursor?.offset ?? 0,
      scanned = 0;
    for (
      ;
      at < plan.nodes.length && matches.length < limit && scanned < 100;
      at++, scanned++
    ) {
      const n = plan.nodes[at];
      if (
        (!input.include_archived && effectiveArchived(plan, n.id)) ||
        (input.level && n.level !== input.level) ||
        (input.planning_status && n.planning_status !== input.planning_status)
      )
        continue;
      const d = await this.detail(plan, input.object_id, n.id, network),
        c = d?.object.content;
      if (
        [n.title, n.subtitle, c?.goal, c?.theme]
          .filter(Boolean)
          .join("\n")
          .toLocaleLowerCase()
          .includes(query)
      )
        matches.push({
          node: n,
          detail_ref: n.detail_ref,
          path: pathTo(plan, n.id).map((n) => ({ id: n.id, title: n.title })),
        });
    }
    return this.ok({
      plan_ref: fixed(r),
      nodes: matches,
      next_cursor:
        at < plan.nodes.length
          ? this.cursor({
              tag: "query",
              id: input.object_id,
              revision: r.object.revision,
              sha: r.sha256,
              query: identity,
              offset: at,
            })
          : null,
    });
  }
  private async check(input: any) {
    const { r, cursor, plan } = await this.snapshot(input, "check"),
      issues: any[] = [],
      network = await this.network(plan, input.object_id),
      start = cursor?.offset ?? 0,
      end = Math.min(start + 100, plan.nodes.length);
    if(cursor)requireThat(start<plan.nodes.length,"检查分页位置无效。");
    for (const n of plan.nodes.slice(start, end)) {
      if (effectiveArchived(plan, n.id)) continue;
      if (!n.detail_ref)
        issues.push({
          severity: "warning",
          code: "missing_detail",
          node_id: n.id,
          message: "尚无详细规划。",
        });
      else {
        const d = (await this.detail(plan, input.object_id, n.id, network))!
          .object.content as Detail;
        for (const key of [
          "goal",
          "conflict",
          "start_state",
          "end_state",
        ] as const)
          if (!d[key].trim())
            issues.push({
              severity: "warning",
              code: "missing_" + key,
              node_id: n.id,
              message: "规划字段待补充：" + key,
            });
      }
      const actual = descendants(plan, n.id).filter(
        (id) =>
          nodeOf(plan, id).level === "chapter" && !effectiveArchived(plan, id),
      ).length;
      if (
        n.level !== "chapter" &&
        n.target_chapters &&
        n.target_chapters !== actual
      )
        issues.push({
          severity: "warning",
          code: "chapter_budget",
          node_id: n.id,
          message: `目标${n.target_chapters}章，已规划${actual}章。`,
        });
    }
    if (start === 0)
      for (const clue of network?.clues ?? [])
        if (
          !clue.archived &&
          clue.status !== "abandoned" &&
          !clue.placements.some((p) => p.stage === "payoff")
        )
          issues.push({
            severity: "warning",
            code: "unresolved_clue",
            clue_id: clue.id,
            message: "伏笔尚无回收位置。",
          });
    return this.ok({
      plan_ref: fixed(r),
      issues,
      next_cursor:
        end < plan.nodes.length
          ? this.cursor({
              tag: "check",
              id: input.object_id,
              revision: r.object.revision,
              sha: r.sha256,
              offset: end,
            })
          : null,
      statistics: {
        planned_chapters: plan.nodes.filter(
          (n) => n.level === "chapter" && !effectiveArchived(plan, n.id),
        ).length,
        target_words: nodeOf(plan, plan.root_id).target_words,
        actual_words: null,
        actual_state: "requires_host_statistics",
      },
    });
  }
  private async compare(input: any) {
    const before = await this.get(
        input.object_id,
        input.from_revision,
        "novel_plan",
      ),
      after = await this.get(input.object_id, input.to_revision, "novel_plan");
    const a = before.object.content as Plan,
      b = after.object.content as Plan;
    const ids = input.node_id
      ? [input.node_id]
      : [...new Set([...a.nodes, ...b.nodes].map((n) => n.id))];
    if (input.node_id)
      requireThat(
        a.nodes.some((n) => n.id === input.node_id) ||
          b.nodes.some((n) => n.id === input.node_id),
        "比较节点不存在。",
      );
    const identity = hash({
        from: fixed(before),
        to: fixed(after),
        node: input.node_id,
      }),
      cursor = input.cursor ? this.decode(input.cursor) : undefined;
    if (cursor)
      requireThat(
        cursor.tag === "compare" && cursor.query === identity,
        "比较端点改变。",
      );
    const changed = ids.filter(
      (id) =>
        canonical(a.nodes.find((n) => n.id === id)?.detail_ref) !==
        canonical(b.nodes.find((n) => n.id === id)?.detail_ref),
    );
    const units = [
      ...(input.node_id ? [] : ["structure"]),
      ...(canonical(a.story_ref) !== canonical(b.story_ref) && !input.node_id
        ? ["story"]
        : []),
      ...changed,
    ];
    if (input.node_id && !units.length) units.push(input.node_id);
    if (!units.length)
      return this.ok({
        from: fixed(before),
        to: fixed(after),
        changes: [],
        next_cursor: null,
      });
    const unit = cursor?.unit ?? 0,
      offset = cursor?.offset ?? 0;
    requireThat(unit < units.length, "比较分段不存在。");
    const section = units[unit];
    let diff: any[] = [];
    if (section === "structure") diff = changes(a, b);
    else if (section === "story") {
      const left = a.story_ref
          ? await this.referenced(a.story_ref, "novel_plan_story_network")
          : undefined,
        right = b.story_ref
          ? await this.referenced(b.story_ref, "novel_plan_story_network")
          : undefined;
      diff = changes(left?.object.content, right?.object.content, "/story");
    } else {
      const left = a.nodes.find((n) => n.id === section)?.detail_ref,
        right = b.nodes.find((n) => n.id === section)?.detail_ref;
      const l = left
          ? await this.referenced(left, "novel_plan_detail")
          : undefined,
        r = right
          ? await this.referenced(right, "novel_plan_detail")
          : undefined;
      diff = changes(
        l?.object.content,
        r?.object.content,
        "/details/" + section,
      ).map((c) => ({ ...c, from_ref: left ?? null, to_ref: right ?? null }));
      if (input.node_id)
        diff.unshift(
          ...changes(
            a.nodes.find((n) => n.id === section),
            b.nodes.find((n) => n.id === section),
            "/nodes/" + section,
          ),
        );
    }
    const compact = (v: any): any =>
      byteLength(v ?? null) > 4096
        ? {
            preview:
              typeof v === "string"
                ? v.slice(0, 700)
                : JSON.stringify(v).slice(0, 700),
            bytes: byteLength(v),
            sha256: hash(v),
            truncated: true,
          }
        : v;
    const page: any[] = [];
    requireThat(offset===0||offset<diff.length,"比较分页位置无效。");
    let at = offset;
    for (; at < diff.length && page.length < 100; at++) {
      const d = diff[at],
        c = { ...d, before: compact(d.before), after: compact(d.after) };
      if (page.length && byteLength([...page, c]) > 384 * 1024) break;
      page.push(c);
    }
    const next =
      at < diff.length
        ? { unit, offset: at }
        : unit + 1 < units.length
          ? { unit: unit + 1, offset: 0 }
          : null;
    return this.ok({
      from: fixed(before),
      to: fixed(after),
      section,
      changes: page,
      next_cursor: next
        ? this.cursor({ tag: "compare", query: identity, ...next })
        : null,
    });
  }
  private async export(input: any) {
    const { r, cursor, plan } = await this.snapshot(input, "export");
    if (input.revision !== r.object.revision)
      throw new PlannerError("planner.invalid_cursor", "导出版本不一致。");
    const identity = hash({
      format: input.format,
      scope: input.scope,
      node_id: input.node_id,
    });
    if (cursor) requireThat(cursor.query === identity, "导出条件改变。");
    const refs: { role: string; ref: FixedRef; node_id?: string }[] = [
      { role: "structure", ref: fixed(r) },
    ];
    const ids =
      input.scope === "node"
        ? descendants(plan, input.node_id)
        : plan.nodes.map((n) => n.id);
    if (input.scope !== "structure") {
      for (const id of ids) {
        const n = nodeOf(plan, id);
        if (n.detail_ref)
          refs.push({ role: "detail", ref: n.detail_ref, node_id: id });
      }
      if (plan.story_ref) refs.push({ role: "story", ref: plan.story_ref });
    }
    const index = cursor?.offset ?? 0;
    requireThat(index < refs.length, "导出段不存在。");
    const part = refs[index];
    const record =
      index === 0
        ? r
        : await this.referenced(
            part.ref,
            part.role === "detail"
              ? "novel_plan_detail"
              : "novel_plan_story_network",
          );
    const content =
      input.format === "json"
        ? JSON.stringify(record, null, 2)
        : this.markdown(record);
    return this.ok({
      plan_ref: fixed(r),
      manifest: refs,
      index,
      total: refs.length,
      media_type:
        input.format === "json" ? "application/json" : "text/markdown",
      content,
      content_sha256: createHash("sha256").update(content).digest("hex"),
      next_cursor:
        index + 1 < refs.length
          ? this.cursor({
              tag: "export",
              id: input.object_id,
              revision: r.object.revision,
              sha: r.sha256,
              query: identity,
              offset: index + 1,
            })
          : null,
    });
  }
  private markdown(r: RecordResult) {
    const c = r.object.content;
    if (r.object.kind === "novel_plan")
      return (
        `# ${r.object.title}\n\n${c.author_constraints}\n\n` +
        (c.nodes as PlanNodeLike[])
          .map(
            (n) =>
              `${"#".repeat(({ book: 2, volume: 3, chapter: 4 } as any)[n.level])} ${n.title}\n\n${n.subtitle}\n\n目标：${n.target_chapters}章 / ${n.target_words}字\n`,
          )
          .join("\n")
      );
    if (r.object.kind === "novel_plan_detail")
      return (
        `# ${r.object.title}\n\n` +
        [
          "summary",
          "goal",
          "theme",
          "opening",
          "conflict",
          "start_state",
          "end_state",
          "hook",
        ]
          .map(
            (k) =>
              `## ${({ summary: "概要", goal: "目标", theme: "主题", opening: "开局", conflict: "主要冲突", start_state: "起始状态", end_state: "结束状态", hook: "悬念" } as any)[k]}\n\n${c[k]}\n`,
          )
          .join("\n") +
        `\n## 关键转折\n\n${c.turns.map((x: string) => "- " + x).join("\n")}\n\n## 详细剧情\n\n${c.detailed_plot}\n\n## 节拍\n\n${c.beats.map((b: any) => "### " + b.title + "\n\n" + b.summary).join("\n\n")}\n\n## 备注\n\n${c.notes}\n\n## 待确认问题\n\n${c.questions.map((x: string) => "- " + x).join("\n")}\n`
      );
    return (
      `# ${r.object.title}\n\n` +
      c.entities
        .map((e: any) => `## ${e.name}\n\n${e.summary}\n\n${e.notes}`)
        .join("\n\n") +
      "\n\n## 关系\n\n" +
      c.relations
        .map((e: any) => `${e.from_id} → ${e.to_id}：${e.label}\n\n${e.notes}`)
        .join("\n\n") +
      "\n\n## 伏笔\n\n" +
      c.clues
        .map(
          (x: any) =>
            `### ${x.title}\n\n${x.description}\n\n${x.placements.map((p: any) => p.node_id + " " + p.stage + " " + p.notes).join("\n")}\n\n${x.notes}`,
        )
        .join("\n\n")
    );
  }
}
type PlanNodeLike = Plan["nodes"][number];
