import { t, setLanguage } from "./i18n.ts";
import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  newPlan,
  newNode,
  newDetail,
  clone,
  nodeOf,
  descendants,
  effectiveArchived,
  byteLength,
  type Plan,
  type PlanNode,
  type Detail,
  type Network,
  type EntityType,
  type Run,
  type FixedRef,
} from "../domain/model.ts";
import "./style.css";
import { settleFlow, mergeFields, type Pending } from "../application/write-flow.ts";

declare global {
  interface Window {
    hetu: {
      context(): Promise<any>;
      buffer(value?: unknown): Promise<any>;
      request(action: string, input: any): Promise<any>;
      invoke(action: string, input: any): Promise<any>;
      host?(action: string, input: any): Promise<any>;
      onPreferences?(callback: (value: any) => void): () => void;
      onBeforeClose?(callback: () => Promise<void>): () => void;
    };
  }
}
type Saved = { object: any; sha256: string };
const runStateNames:Record<string,string>={prepared:'待交接',handed_off:'已交接',running:'执行中',stop_requested:'已请求停止',stopped:'已停止',succeeded:'已完成',failed:'失败',unknown:'结果未知'};
const statusNames = {
  unplanned: "待规划",
  planning: "规划中",
  planned: "已规划",
  needs_revision: "待返工",
};
const typeNames = {
  character: "角色",
  faction: "势力",
  location: "地点",
  item: "物品",
  rule: "规则",
};
const detailLabels = {
  summary: "概要",
  goal: "目标",
  theme: "主题",
  opening: "开局",
  conflict: "主要冲突",
  start_state: "起始状态",
  end_state: "结束状态",
  hook: "悬念",
  detailed_plot: "详细剧情",
  notes: "备注",
};
const key = () => crypto.randomUUID();
const ref = (r: Saved): FixedRef => ({
  object_id: r.object.object_id,
  revision: r.object.revision,
  sha256: r.sha256,
});
function data(r: any): any {
  if (r?.status !== "succeeded")
    throw Object.assign(new Error(r?.error?.message ?? t("操作未完成。")), {
      code: r?.error?.code,
    });
  return r.data;
}
function App() {
  const [loadedVersion,setLoadedVersion]=useState(0);
  const [navigationVisible,setNavigationVisible]=useState(()=>!matchMedia("(max-width:760px)").matches);
  const [directoryVisible,setDirectoryVisible]=useState(true);
  const [levelFilter,setLevelFilter]=useState("volume");
  useEffect(()=>{const media=matchMedia("(max-width:760px)");const collapse=()=>{if(media.matches){setNavigationVisible(false);setDirectoryVisible(false);}};collapse();media.addEventListener("change",collapse);return()=>media.removeEventListener("change",collapse);},[]);
  const ready=useRef(false),positions=useRef<Record<string,number>>({}),lastNodes=useRef<Record<string,string>>({});
  const [context, setContext] = useState<any>(),
    [plans, setPlans] = useState<any[]>([]),
    [current, setCurrent] = useState<Saved>(),
    [selected, setSelected] = useState(""),
    [page, setPage] = useState("plan");
  const [detail, setDetail] = useState<Saved>(),
    [network, setNetwork] = useState<Saved>(),
    [draft, setDraft] = useState<Detail>(),
    [meta, setMeta] = useState<PlanNode>(),
    [editing, setEditing] = useState(false),
    [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState<Pending>(),
    [failureCode, setFailureCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("all"),
    [tab, setTab] = useState("overview");
  const [issues, setIssues] = useState<any[]>([]),
    [runs, setRuns] = useState<Saved[]>([]),
    [comparison, setComparison] = useState<any>(),
    [revision, setRevision] = useState("1"),
    [entityType, setEntityType] = useState<EntityType>("character");
  const [searchMatches, setSearchMatches] = useState<Set<string>>();
  const [archiveFilter, setArchiveFilter] = useState("active"),
    [clueFilter, setClueFilter] = useState("all"),
    [graphType, setGraphType] = useState("all"),
    [documentOptions, setDocumentOptions] = useState<any[]>([]),
    [preferences, setPreferences] = useState<any>({
      theme: "system",
      language: "zh-CN",
    }),
    [workSnapshot, setWorkSnapshot] = useState<any>(),
    [dialog, setDialog] = useState<any>(),
    [direct, setDirect] = useState(false),
    [newHead, setNewHead] = useState(false);
  setLanguage(preferences.language);
  const plan = current?.object.content as Plan | undefined,
    node = plan?.nodes.find((n) => n.id === selected),
    story = network?.object.content as Network | undefined;
  const loading = useRef(0),
    selection = useRef(0),
    recoveryDraft = useRef<any>(),
    drafts = useRef<Record<string, any>>({}),
    failedInputs = useRef<any[]>([]),
    bufferQueue = useRef<Promise<any>>(Promise.resolve()),
    composing = useRef(false);
  const draftKey = (id: string, nodeId: string) => id + ":" + nodeId;
  const calls = useRef<Promise<any>>(Promise.resolve()),
    pendingValue = useRef<Pending>();
  const invoke = (action: string, input: any) => {
    const next = calls.current.then(async () =>
      data(await window.hetu.invoke(action, input)),
    );
    calls.current = next.catch(() => {});
    return next;
  };
  const baseline = (r: Saved) => ({
    object_id: r.object.object_id,
    expected_revision: r.object.revision,
    expected_sha256: r.sha256,
    operation_key: key(),
  });
  const guard = () => {
    if (pending) {
      setError(t("请先保存或取消当前修改，再切换工作面。"));
      return false;
    }
    return true;
  };
  async function journal(p?: Pending, extra: any = {}) {
    if(!ready.current||!context)return;
    if (
      !("drafts" in extra) &&
      current &&
      draft &&
      meta &&
      dirty &&
      !pendingValue.current
    )
      drafts.current[draftKey(current.object.object_id, selected)] = {
        plan_ref: ref(current),
        selected,
        draft: clone(draft),
        meta: clone(meta),
        base_detail_ref: detail ? ref(detail) : null,
        base_meta: clone(node),
      };
    const active = p ?? pendingValue.current;
    if(current){positions.current[current.object.object_id+':'+page+':'+selected]=scrollY;lastNodes.current[current.object.object_id]=selected;}
    const storedDrafts=clone(drafts.current);
    let detailStep:any=active;while(detailStep&&detailStep.action!=='put_detail')detailStep=detailStep.next;
    if(detailStep&&current){const stored=storedDrafts[draftKey(current.object.object_id,selected)];if(stored&&JSON.stringify(stored.draft)===JSON.stringify(detailStep.input.content)){delete stored.draft;stored.draft_from_pending=true;}}
    const value = {
      version: 2,
      context,
      plan_id: current?.object.object_id,
      plan_ref: current ? ref(current) : undefined,
      selected,
      page,
      drafts: storedDrafts,
      failed_inputs: failedInputs.current,
      positions:positions.current,last_nodes:lastNodes.current,filters:{query,filter,tab,levelFilter,entityType},layout:{navigationVisible,directoryVisible},
      pending: active,
      ...extra,
    };
    for(const stored of Object.values(value.drafts) as any[])if(detailStep&&stored.draft&&JSON.stringify(stored.draft)===JSON.stringify(detailStep.input.content)){delete stored.draft;stored.draft_from_pending=true;}
    if (byteLength(value) > 896 * 1024)
      throw new Error(t("恢复稿超过预算，请先复制或缩小本次修改。"));
    const saved = clone(value);
    const next = bufferQueue.current.then(() => window.hetu.buffer(saved));
    bufferQueue.current = next.catch(() => {});
    await next;
  }
  const journalLatest = useRef(journal);
  journalLatest.current = journal;
  async function loadPlans() {
    let cursor: any,
      all: any[] = [];
    do {
      const r = await invoke("list_plans", {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      all.push(...r.objects);
      cursor = r.next_cursor;
    } while (cursor);
    setPlans(all);
    return all;
  }
  async function selectPlan(id: string, revision?: number, preferred?: string) {
    preferred??=lastNodes.current[id];
    const ticket = ++selection.current;
    ++loading.current;
    setDetail(undefined);
    setDraft(undefined);
    setMeta(undefined);
    setEditing(false);
    setDirty(false);
    const recovered = preferred
      ? drafts.current[draftKey(id, preferred)]
      : undefined;
    const fixedRevision = recovered?.plan_ref.revision ?? revision;
    const r = await invoke("get_plan", {
      object_id: id,
      ...(fixedRevision ? { revision: fixedRevision } : {}),
      projection: "structure",
    });
    const p = r.object.content as Plan;
    const net = p.story_ref
      ? await invoke("get_story_network", {
          object_id: p.story_ref.object_id,
          revision: p.story_ref.revision,
          projection: "full",
        })
      : undefined;
    const progress = await allPages(
      "get_progress",
      { object_id: id, revision: r.object.revision },
      "runs",
    );
    if (ticket !== selection.current) return;
    recoveryDraft.current = recovered;
    setCurrent(r);
    setNewHead(false);
    setSelected(
      preferred && p.nodes.some((n) => n.id === preferred)
        ? preferred
        : p.nodes.find((n) => n.level === "volume" && !effectiveArchived(p, n.id))?.id ?? p.root_id,
    );
    setComparison(undefined);
    setNetwork(net);
    setRuns(progress.items);
    setWorkSnapshot(undefined);
    setLoadedVersion(v=>v+1);
  }
  async function allPages(action: string, input: any, field: string) {
    let cursor: any,
      items: any[] = [],
      first: any;
    do {
      const r = await invoke(action, {
        ...input,
        ...(cursor ? { cursor } : {}),
      });
      first ??= r;
      items.push(...r[field]);
      cursor = r.next_cursor;
    } while (cursor);
    return { ...first, items };
  }
  async function refresh() {
    if (!current) {
      await loadPlans();
      return;
    }
    const r = await invoke("get_plan", {
      object_id: current.object.object_id,
      projection: "structure",
    });
    if (dirty || pending) {
      if (r.sha256 !== current.sha256) {
        setNewHead(true);
        setNotice(t("已有新版本，当前编辑和基线已保留。"));
      }
      return;
    }
    await selectPlan(current.object.object_id, undefined, selected);
    await loadPlans();
  }
  async function attempt(action: () => Promise<any>) {
    if (composing.current) return;
    setError("");
    setNotice("");
    setFailureCode("");
    setBusy(true);
    try {
      await action();
    } catch (e: any) {
      setFailureCode(e.code ?? "");
      setError(e.message ?? t("操作失败。"));
    } finally {
      setBusy(false);
    }
  }
  async function finishFlow(p: Pending) {
    const completed = await settleFlow(p, {
      invoke,
      key,
      persist: async (next) => {
        pendingValue.current = next ?? undefined;
        setPending(next ?? undefined);
        if (!next) { setDirty(false); setEditing(false); }
        if (!next && current)
          delete drafts.current[draftKey(current.object.object_id, selected)];
        await journal(next ?? undefined, {
          pending: next,
          drafts: clone(drafts.current),
        });
      },
    });
    recoveryDraft.current = undefined;
    setDirty(false);
    setEditing(false);
    const committed = completed.last;
    if (committed.object?.kind === "novel_plan")
      await selectPlan(
        committed.object.object_id,
        committed.object.revision,
        selected || committed.object.content.root_id,
      );
    else if (current)
      await selectPlan(current.object.object_id, undefined, selected);
    await loadPlans();
    setNotice(t("已保存并回读固定版本。"));
    return completed.result;
  }
  async function write(
    action: string,
    input: any,
    attach?: Pending["attach"],
    next?: Pending["next"],
  ) {
    if (pendingValue.current) throw new Error(t("请先恢复原操作。"));
    await journal();
    return finishFlow({
      action,
      input,
      attach,
      next,
      plan_base: current ? ref(current) : undefined,
    });
  }
  async function resume() {
    if (!pending) return;
    await finishFlow(pending);
    setNotice(t("已沿原操作恢复。"));
  }
  async function inspectFailure() {
    if (!pending || !current) return;
    const checked = await window.hetu.request(
      "hetu.extensions.operations.get",
      { operation_key: pending.input.operation_key },
    );
    if (checked.status === "succeeded") {
      await resume();
      return;
    }
    if (checked.error?.code !== "not_found")
      throw new Error(checked.error?.message ?? t("操作未完成。"));
    const latest = await invoke("get_plan", {
      object_id: current.object.object_id,
    });
    const diff = await allPages(
      "compare_revisions",
      {
        object_id: current.object.object_id,
        from_revision: pending.plan_base?.revision ?? current.object.revision,
        to_revision: latest.object.revision,
      },
      "changes",
    );
    setDialog({
      kind: "failure",
      value: { pending: clone(pending), latest, diff: diff.items },
    });
  }
  async function prepareAgain() {
    if(dialog?.kind!=='failure'||!pending||!current)return;
    const latest=dialog.value.latest as Saved;
    const recovered=drafts.current[draftKey(current.object.object_id,selected)];
    if(recovered&&pending.action!=='attach_object'){
      const latestNode=nodeOf(latest.object.content,selected);
      const latestDetail=latestNode.detail_ref?await invoke('get_detail',{object_id:latestNode.detail_ref.object_id,revision:latestNode.detail_ref.revision}):undefined;
      const remote=latestDetail?.object.content??newDetail(current.object.object_id,selected);
      const original=recovered.base_detail_ref?await invoke('get_detail',{object_id:recovered.base_detail_ref.object_id,revision:recovered.base_detail_ref.revision}):undefined;
      const detailMerge=mergeFields(original?.object.content??newDetail(current.object.object_id,selected),recovered.draft,remote),metaMerge=mergeFields(recovered.base_meta,recovered.meta,latestNode);
      if(detailMerge.conflicts.length||metaMerge.conflicts.length){setDialog({kind:'merge',value:{latest,detail:detailMerge,meta:metaMerge,base_detail_ref:latestDetail?ref(latestDetail):null,base_meta:latestNode,choices:{}}});return;}
      Object.assign(recovered,{draft:detailMerge.value,meta:metaMerge.value,base_detail_ref:latestDetail?ref(latestDetail):null,base_meta:latestNode});
    }
    await acceptBaseline(latest);
  }
  async function acceptBaseline(latest:Saved){
    if(!pending||!current)return;const old=pending;
    failedInputs.current.push(clone(old));setDirty(false);setEditing(false);pendingValue.current=undefined;setPending(undefined);setDialog(undefined);setFailureCode('');
    const recovered=drafts.current[draftKey(current.object.object_id,selected)];
    if(recovered)recovered.plan_ref=ref(latest);
    await journal(undefined,{pending:null,drafts:clone(drafts.current)});
    if(old.action==='attach_object'){await write('attach_object',{...old.input,...baseline(latest)});return;}
    await selectPlan(current.object.object_id,latest.object.revision,selected);
    if(!recovered){setNotice(t('原输入已保留，请交给Agent比较后重新准备。'));setDialog({kind:'input',value:old});}
  }
  async function applyMerge(){
    if(dialog?.kind!=='merge'||!current)return;const m=dialog.value;
    for(const scope of ['detail','meta'])for(const c of m[scope].conflicts){const choice=m.choices[scope+':'+c.field];if(!choice)throw new Error(t('请逐项选择冲突字段。'));m[scope].value[c.field]=clone(c[choice]);}
    const recovered=drafts.current[draftKey(current.object.object_id,selected)];Object.assign(recovered,{draft:m.detail.value,meta:m.meta.value,base_detail_ref:m.base_detail_ref,base_meta:m.base_meta});
    await acceptBaseline(m.latest);
  }
  async function handoff(goal: string, run?: Saved) {
    if (!window.hetu.host)
      throw new Error(t("当前宿主未提供可信交接，请升级宿主。"));
    await window.hetu.host("handoff", {
      goal,
      ...(current ? { object_ref: ref(current) } : {}),
      ...(node ? { node_id: node.id } : {}),
      ...(run ? { run_ref: ref(run) } : {}),
    });
    setNotice(t("已复制当前目标与固定成果，可交给所选Agent。"));
  }
  async function saveDetail() {
    if (!current || !draft || !meta || !node) return;
    const changedMeta = JSON.stringify(meta) !== JSON.stringify(node);
    const step = {
      action: "put_detail",
      input: {
        ...(detail
          ? baseline(detail)
          : {
              expected_revision: 0,
              expected_sha256: "",
              operation_key: key(),
            }),
        title: meta.title,
        content: draft,
        source_refs: [
          ...(detail?.object.source_refs ?? []).filter(
            (x: any) => x.kind !== "document",
          ),
          ...draft.formal_documents.map((d) => ({
            kind: "document",
            work_ref: context.work_ref,
            ...d,
          })),
        ],
      },
      attach: { role: "detail", node_id: node.id },
    };
    if (changedMeta) {
      await write(
        "patch_node",
        {
          ...baseline(current),
          node_id: node.id,
          changes: {
            title: meta.title,
            subtitle: meta.subtitle,
            planning_status: meta.planning_status,
            target_chapters: meta.target_chapters,
            target_words: meta.target_words,
          },
        },
        undefined,
        step,
      );
      return;
    }
    await write(step.action, step.input, step.attach);
  }
  async function saveNetwork(next: Network) {
    if (!current) return;
    await write(
      "put_story_network",
      {
        ...(network
          ? baseline(network)
          : {
              expected_revision: 0,
              expected_sha256: "",
              operation_key: key(),
            }),
        title: t("故事网络"),
        content: next,
        source_refs: network?.object.source_refs ?? [],
      },
      { role: "story" },
    );
  }
  async function exportPlan() {
    if (!current) return;
    if (!window.hetu.host) throw new Error(t("当前宿主未提供文件导出服务。"));
    const result = await window.hetu.host("export_file", {
      action: "export_plan",
      input: {
        object_id: current.object.object_id,
        revision: current.object.revision,
        format: "markdown",
        scope: "complete",
      },
      suggested_name:
        current.object.title.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 100) +
        ".md",
    });
    if (result.saved) setNotice(t("完整固定版本已导出。"));
  }
  async function changeNode(id: string) {
    if (!guard() || !current) return;
    await journal();
    await selectPlan(current.object.object_id, current.object.revision, id);
    setTab("overview");
  }
  useEffect(() => {
    void attempt(async () => {
      const c = await window.hetu.context();
      setContext(c);
      const stored = await window.hetu.buffer();
      const b =
        stored &&
        JSON.stringify(stored.context?.work_ref) ===
          JSON.stringify(c.work_ref) &&
        stored.context?.package_sha256 === c.package_sha256
          ? stored
          : undefined;
      positions.current=b?.positions??{};lastNodes.current=b?.last_nodes??{};if(b?.filters){setQuery(b.filters.query??'');setFilter(b.filters.filter??'all');setTab(b.filters.tab??'overview');setLevelFilter(b.filters.levelFilter??'volume');setEntityType(b.filters.entityType??'character');}if(b?.layout){setNavigationVisible(b.layout.navigationVisible??true);setDirectoryVisible(b.layout.directoryVisible??true);}
      drafts.current = b?.drafts ?? {};
      let detailStep=b?.pending;while(detailStep&&detailStep.action!=='put_detail')detailStep=detailStep.next;
      for(const d of Object.values(drafts.current) as any[])if(d.draft_from_pending&&detailStep){d.draft=clone(detailStep.input.content);delete d.draft_from_pending;}
      failedInputs.current = b?.failed_inputs ?? [];
      pendingValue.current = b?.pending ?? undefined;
      setPending(b?.pending ?? undefined);
      const list = await loadPlans();
      if (window.hetu.host)
        try {
          setPreferences(await window.hetu.host("preferences", {}));
        } catch {}
      if (list.length)
        await selectPlan(
          list.some((p) => p.object_id === b?.plan_id)
            ? b.plan_id
            : list[0].object_id,
          b?.plan_ref?.revision,
          b?.selected,
        );
      if (b?.page) setPage(b.page);
      ready.current=true;
    });
  }, []);
  useEffect(() => {
    if (!node || !current) return;
    const ticket = ++loading.current;
    void attempt(async () => {
      const r = node.detail_ref
        ? await invoke("get_detail", {
            object_id: node.detail_ref.object_id,
            revision: node.detail_ref.revision,
          })
        : undefined;
      if (ticket !== loading.current) return;
      const recovered =
        drafts.current[draftKey(current.object.object_id, node.id)];
      setDetail(r);
      setDraft(
        recovered?.draft ??
          (r
            ? clone(r.object.content)
            : newDetail(current.object.object_id, node.id)),
      );
      setMeta(recovered?.meta ?? clone(node));
      setDirty(!!recovered);
      setEditing(!!recovered);
      if (recovered) setNotice(t("已找回未保存内容。"));
    });
  }, [current?.sha256, selected, loadedVersion]);
  useEffect(() => window.hetu.onPreferences?.(setPreferences), []);
  useEffect(() => {
    if (context)
      void journalLatest
        .current()
        .catch((e) => setError(t("恢复稿保存失败：") + e.message));
  }, [draft, meta, dirty, pending, selected, page, context, navigationVisible, directoryVisible, levelFilter, entityType]);
  useEffect(
    () => window.hetu.onBeforeClose?.(() => journalLatest.current()),
    [],
  );
  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const update = () =>
      (document.documentElement.dataset.theme =
        preferences.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preferences.theme);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preferences]);
  useEffect(() => {
    setSearchMatches(undefined);
    if (!current || !query.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void allPages("query_nodes", {
        object_id: current.object.object_id,
        revision: current.object.revision,
        query,
        include_archived: page === "recycle",
      }, "nodes").then((result) => {
        if (!cancelled) setSearchMatches(new Set(result.items.map((n: any) => n.node.id)));
      }).catch((e) => { if (!cancelled) setError(e.message); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [current?.sha256, query, page]);
  const visible =
    plan?.nodes
      .filter((n) =>
        page === "recycle"
          ? effectiveArchived(plan, n.id)
          : !effectiveArchived(plan, n.id),
      )
      .filter(
        (n) =>
          (levelFilter === "all" || n.level === levelFilter) &&
          (filter === "all" || n.planning_status === filter) &&
          (searchMatches ? searchMatches.has(n.id) : [n.title, n.subtitle]
            .join(" ")
            .toLowerCase()
            .includes(query.toLowerCase())),
      ) ?? [];
  const readOnlyDetail = detail?.object.content as Detail | undefined;
  async function scopeNetwork() {
    if (!plan?.story_ref || !node) return;
    let cursor: any,
      entities = new Map(),
      associations: any[] = [];
    do {
      const r = await invoke("get_story_network", {
        object_id: plan.story_ref.object_id,
        revision: plan.story_ref.revision,
        projection: "entities",
        node_id: node.id,
        plan_ref: ref(current!),
        entity_type: tab,
        scope: direct ? "direct" : "descendants",
        ...(cursor ? { cursor } : {}),
      });
      r.projection.entities.forEach((e: any) => entities.set(e.id, e));
      associations.push(...r.projection.associations);
      cursor = r.next_cursor;
    } while (cursor);
    setDialog({
      kind: "scope",
      value: { entities: [...entities.values()], associations },
    });
  }
  async function actualStatistics() {
    if (!window.hetu.host || !plan || !node)
      throw new Error(t("宿主未提供统计入口。"));
    const snapshot = await window.hetu.host("work_snapshot", {}),
      ids = new Set<string>();
    if (node.level === "book")
      for (const d of snapshot.documents) ids.add(d.document_id);
    else
      for (const id of descendants(plan, node.id)) {
        const n = nodeOf(plan, id);
        if (n.detail_ref) {
          const r = await invoke("get_detail", {
            object_id: n.detail_ref.object_id,
            revision: n.detail_ref.revision,
          });
          for (const d of r.object.content.formal_documents)
            ids.add(d.document_id);
        }
      }
    const documents = snapshot.documents.filter((d: any) =>
      ids.has(d.document_id),
    );
    setWorkSnapshot({
      ...snapshot,
      node_id: node.id,
      documents,
      document_count: documents.length,
      word_count:
        node.level !== "book" && !ids.size
          ? null
          : documents.reduce((n: number, d: any) => n + d.word_count, 0),
    });
  }
  async function createNode() {
    if (!current || !plan || !node) return;
    const level = levelFilter === "chapter" ? "chapter" : "volume";
    const parent = level === "volume" ? nodeOf(plan, plan.root_id) : node.level === "chapter" ? plan.nodes.find(n => n.children.includes(node.id)) : node;
    if (!parent || (level === "chapter" && parent.level !== "volume")) throw new Error(t("请先选择所属卷。"));
    const title = prompt(level === "volume" ? t("卷标题") : t("章标题"));
    if (title?.trim())
      await write("insert_node", {
        ...baseline(current),
        parent_id: parent.id,
        node: newNode(level, title.trim(), key()),
      });
  }
  async function reorder(direction: number) {
    if (!plan || !node || !current) return;
    const parent = plan.nodes.find((n) => n.children.includes(node.id));
    if (!parent) return;
    const at = parent.children.indexOf(node.id),
      target = at + direction;
    if (target < 0 || target >= parent.children.length) return;
    const before =
      direction < 0 ? parent.children[target] : parent.children[target + 1];
    await write("move_node", {
      ...baseline(current),
      node_id: node.id,
      parent_id: parent.id,
      ...(before ? { before_id: before } : {}),
    });
  }
  function startEdit() {
    if (editing) return;
    setDraft(
      detail
        ? clone(detail.object.content)
        : newDetail(current!.object.object_id, node!.id),
    );
    setMeta(clone(node!));
    setEditing(true);
    setDirty(false);
  }
  function field(
    label: string,
    value: any,
    onChange: (v: string) => void,
    multiline = true,
  ) {
    return (
      <label className="field">
        <span>{t(label)}</span>
        {multiline ? (
          <textarea
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
      </label>
    );
  }
  function openEntity(e?: any) {
    setDialog({
      kind: "entity",
      value: e
        ? clone(e)
        : {
            id: key(),
            type: entityType,
            name: "",
            summary: "",
            notes: "",
            archived: false,
            canonical_ref: null,
          },
    });
  }
  async function submitDialog() {
    if (!dialog || !current) return;
    const next: Network = story
      ? clone(story)
      : {
          format_version: 1,
          plan_id: current.object.object_id,
          entities: [],
          relations: [],
          clues: [],
        };
    const collection =
      dialog.kind === "entity"
        ? "entities"
        : dialog.kind === "relation"
          ? "relations"
          : "clues";
    const list = (next as any)[collection] as any[];
    const at = list.findIndex((x) => x.id === dialog.value.id);
    if (at < 0) list.push(dialog.value);
    else list[at] = dialog.value;
    await saveNetwork(next);
    setDialog(undefined);
  }
  const isShown = (archived: boolean) =>
    archiveFilter === "all" ||
    (archiveFilter === "archived" ? archived : !archived);
  const graphEntities =
    story?.entities.filter(
      (e) =>
        isShown(e.archived) && (graphType === "all" || e.type === graphType),
    ) ?? [];
  const graphIds = new Set(graphEntities.map((e) => e.id));
  const graphNetwork = story
    ? {
        ...story,
        entities: graphEntities,
        relations: story.relations.filter(
          (r) =>
            isShown(r.archived) &&
            graphIds.has(r.from_id) &&
            graphIds.has(r.to_id),
        ),
      }
    : undefined;
  const archiveControl = (
    <label className="field">
      <span>{t("归档筛选")}</span>
      <select
        aria-label={t("归档筛选")}
        value={archiveFilter}
        onChange={(e) => setArchiveFilter(e.target.value)}
      >
        {["active", "all", "archived"].map((v, i) => (
          <option key={v} value={v}>
            {[t("未归档"), t("全部"), t("已归档")][i]}
          </option>
        ))}
      </select>
    </label>
  );
  const cn = (label: string, en: string) =>
    preferences.language === "en" ? en : label;
  const openHost=(target:string)=>void attempt(async()=>{if(!window.hetu.host)throw new Error(t("宿主工作面不可用。"));await window.hetu.host("open_work",{target});});
  const goPage=(next:string)=>{if(guard()){void journal();setPage(next);}};
  const goPlanning=(level:string)=>{if(!guard())return;void attempt(async()=>{await journal();setLevelFilter(level);setPage("plan");setTab("overview");const first=plan?.nodes.find(n=>(level==="all"||n.level===level)&&!effectiveArchived(plan,n.id));if(first&&node?.level!==level)await changeNode(first.id);});};
  const scopeTabs = current && ["plan", "recycle"].includes(page) ? (
<div className="workspace-tabs" aria-label={t("当前范围")}>                  <div className="tabs" role="tablist">
                    {[
                      "overview",
                      "character",
                      "faction",
                      "location",
                      "documents",
                    ].map((tabId, i) => (
                      <button
                        role="tab"
                        aria-selected={page !== "recycle" && tab === tabId}
                        key={tabId}
                        onClick={() => {setPage("plan");setTab(tabId);}}
                      >
                        {
                          [
                            t(levelFilter === "volume" ? "卷概览" : levelFilter === "chapter" ? "篇章概览" : "规划概览"),
                            t("卷内角色"),
                            t("卷内势力"),
                            t("卷内地点"),
                            t("正文接续"),
                          ][i]
                        }{tabId === "overview" && <span className="tab-count" aria-hidden="true">{plan?.nodes.filter(n=>n.level===(levelFilter==="chapter"?"chapter":"volume")&&!effectiveArchived(plan,n.id)).length??0}</span>}
                      </button>
                    ))}
                    <button role="tab" aria-selected={page==="recycle"} onClick={()=>{goPage("recycle");setTab("overview");}}>{t("回收站")}<span className="tab-count" aria-hidden="true">{plan?.nodes.filter(n=>effectiveArchived(plan,n.id)).length??0}</span></button>
                  </div>
  <button className="scope-refresh" aria-label={t("刷新")} title={t("刷新")} disabled={busy} onClick={()=>void attempt(refresh)}><Icon name="refresh"/></button>
</div>
  ) : null;
  return (
    <div
      className="planner"
      data-testid="planner"
      aria-busy={busy}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
    >
      <header>
        <div className="planner-identity">
          {context?.navigation === "integrated" && <button className="back-workbench" aria-label={t("返回工作台")} disabled={busy} onClick={() => void attempt(async () => { await window.hetu.host!("close_view", {}); })}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m12 5-7 7 7 7M5 12h14"/></svg>{t("返回")}</button>}
          <h1>{cn(t("小说规划"), "Novel Planner")}</h1>
          <button className="layout-toggle" aria-label={t(navigationVisible?"收起规划导航":"展开规划导航")} aria-expanded={navigationVisible} onClick={()=>setNavigationVisible(!navigationVisible)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/></svg></button>
        </div>
        <div className="plan-selection">          <label className="plan-switcher">
            <span className="sr-only">{t("方案")}</span>
            <select
              aria-label={t("方案")}
              value={current?.object.object_id ?? ""}
              onChange={(e) => {
                if (guard())
                  void attempt(async () => {
                    await journal();
                    await selectPlan(e.target.value);
                  });
              }}
            >
              <option value="" disabled>
                {t("选择方案")}
              </option>
              {plans.map((p) => (
                <option key={p.object_id} value={p.object_id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>
          <button className="new-plan" aria-label={t("新建方案")} title={t("新建方案")}
            onClick={() =>
              void attempt(async () => {
                const title = prompt(t("方案名称"));
                if (!title?.trim()) return;
                const r = await write("put_plan", {
                  expected_revision: 0,
                  expected_sha256: "",
                  operation_key: key(),
                  title: title.trim(),
                  content: newPlan(title.trim(), key()),
                  source_refs: [],
                });
                await loadPlans();
                await selectPlan(r.object.object_id);
              })
            }
          >
            <Icon name="plus"/>
          </button>
</div>
        <div className="actions">
          {!scopeTabs && <button disabled={busy} onClick={() => void attempt(refresh)}><Icon name="refresh"/>{t("刷新")}</button>}
          <button
            disabled={busy || !current}
            onClick={() => void attempt(exportPlan)}
          >
            {cn(t("导出"), "Export")}
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className="alert">
          <span>{t(error)}</span>
          <button onClick={() => setError("")}>{t("关闭")}</button>
        </div>
      )}
      {notice && (
        <div role="status" className="notice">
          {t(notice)}
          <button onClick={() => setNotice("")}>{t("关闭")}</button>
        </div>
      )}
      {pending && (
        <div className="alert">
          <span>{t("有固定操作待核对。保留原输入与原键。")}</span>
          <button disabled={busy} onClick={() => void attempt(resume)}>
            {t("查询并恢复原操作")}
          </button>
          {[
            "revision_conflict",
            "planner.schema_invalid",
            "planner.invalid_structure",
            "planner.budget_exceeded",
            "idempotency_conflict",
          ].includes(failureCode) && (
            <button onClick={() => void attempt(inspectFailure)}>
              {t("比较并重新准备")}
            </button>
          )}
        </div>
      )}
      {newHead && (
        <div className="notice">
          {t("发现新版本，当前编辑基线保持。")}
          <button
            onClick={() =>
              void attempt(async () => {
                setComparison(
                  await allPages(
                    "compare_revisions",
                    {
                      object_id: current!.object.object_id,
                      from_revision: current!.object.revision,
                      to_revision: (
                        await invoke("get_plan", {
                          object_id: current!.object.object_id,
                        })
                      ).object.revision,
                    },
                    "changes",
                  ).then((r) => ({ ...r, changes: r.items })),
                );
                setPage("compare");
              })
            }
          >
            {t("比较新版本")}
          </button>
        </div>
      )}
      <div className="body">
        {navigationVisible && <nav aria-label={t("规划导航")}>
          <div className="navigation-section">
            <button onClick={()=>openHost("profile")}><Icon name="book"/>{t("小说资料")}</button>
            {([["all","整书规划","book"],["volume","卷规划","layers"],["chapter","篇章规划","outline"]] as const).map(([level,label,icon])=><button key={level} className={page==="plan"&&levelFilter===level?"active":""} onClick={()=>goPlanning(level)}><Icon name={icon}/>{t(label)}</button>)}
            <button onClick={()=>openHost("manuscript")}><Icon name="pen"/>{t("章节正文")}</button>
          </div>
          <div className="navigation-section">
            <div className="navigation-label">{t("实体管理")}</div>
            <button className={page==="clues"?"active":""} onClick={()=>goPage("clues")}><Icon name="clue"/>{t("伏笔追踪")}</button>
            {Object.entries(typeNames).map(([kind,label])=><button key={kind} className={page==="entities"&&entityType===kind?"active":""} onClick={()=>{if(guard()){goPage("entities");setEntityType(kind as EntityType);}}}><Icon name={kind}/>{t(label+"卡")}</button>)}
            <button className={page==="relationships"?"active":""} onClick={()=>goPage("relationships")}><Icon name="relations"/>{t("关系图谱")}</button>
            <button onClick={()=>openHost("canon")}><Icon name="rules"/>{t("正式设定")}</button>
          </div>
          <div className="navigation-section">
            <button className={page==="compare"?"active":""} onClick={()=>goPage("compare")}><Icon name="compare"/>{t("版本比较")}</button>
          </div>
          <div className="navigation-progress">
            <button className={page==="progress"?"active":""} onClick={()=>goPage("progress")}><Icon name="progress"/>{t("工作记录")}<span className="nav-count">{runs.length}</span></button>
            {runs.length > 0 && <button className="resume-work" onClick={()=>goPage("progress")}><span>{runs[0].object.content.goal}</span><small>{t(runStateNames[runs[0].object.content.state]??runs[0].object.content.state)}</small></button>}
          </div>
          {!!failedInputs.current.length && (
            <button
              onClick={() =>
                setDialog({ kind: "input", value: failedInputs.current })
              }
            >
              {t("失败操作记录")}
            </button>
          )}
          {current && (
            <p className="revision">
              {t("当前固定修订")}
              {current.object.revision}
              <br />
              {t("规划保存不代表采纳或定稿")}
            </p>
          )}
        </nav>}
        {!current ? (
          <main className="empty">
            <h2>{t("从一个创作目标开始")}</h2>
            <p>{t("向Agent说明故事方向、保留内容和希望规划的范围。")}</p>
            <button
              className="primary"
              onClick={() =>
                void attempt(() =>
                  handoff(
                    t("整理小说构思、作者主张和待确认问题，创建完整规划方案。"),
                  ),
                )
              }
            >
              {t("让AI准备规划")}
            </button>
          </main>
        ) : (
          <div className={['plan','recycle'].includes(page)?'workspace outline-workspace':'workspace'}>
            {scopeTabs}
            {['plan','recycle'].includes(page)&&<>
              <div className="planner-toolbar"><button className="layout-toggle" aria-label={t(directoryVisible?"收起卷章目录":"展开卷章目录")} aria-expanded={directoryVisible} onClick={()=>setDirectoryVisible(!directoryVisible)}>{directoryVisible?"‹":"›"}</button><label className="search"><span>{t(levelFilter === "volume" ? "搜索卷" : levelFilter === "chapter" ? "搜索篇章" : "搜索卷章")}</span><div className="search-input">
                  <input
                    aria-label={t("搜索卷章")}
                    placeholder={t("标题、副标题、目标或主题")}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <button
                    onClick={() =>
                      void attempt(async () => {
                        let cursor: any,
                          all: any[] = [];
                        do {
                          const r = await invoke("query_nodes", {
                            object_id: current.object.object_id,
                            revision: current.object.revision,
                            query,
                            limit: 100,
                            include_archived: page === "recycle",
                            ...(filter !== "all"
                              ? { planning_status: filter }
                              : {}),
                            ...(cursor ? { cursor } : {}),
                          });
                          all.push(...r.nodes);
                          cursor = r.next_cursor;
                        } while (cursor);
                        setDialog({ kind: "search", value: all });
                      })
                    }
                  >
                    {t("搜索")}
                  </button>
                </div></label>
                <label className="status-filter"><span>{t("状态")}</span><select
                  aria-label={t("状态筛选")}
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                >
                  <option value="all">{t("全部状态")}</option>
                  {Object.entries(statusNames).map(([k, v]) => (
                    <option key={k} value={k}>
                      {t(v)}
                    </option>
                  ))}
                </select></label>
                {page === "plan" && (
                  <button className="primary"
                    disabled={busy || (levelFilter === "chapter" && node?.level !== "volume" && node?.level !== "chapter")}
                    onClick={() => void attempt(createNode)}
                  >
                    {levelFilter !== "chapter" ? t("新增卷") : t("新增章")}
                  </button>
                )}
<button disabled={busy} onClick={()=>void attempt(()=>handoff(t('规划全书分卷，保留作者已定主张。')))}>{t('让AI规划全书')}</button><button disabled={busy||!node} onClick={()=>void attempt(()=>handoff(node?.level==='volume'?t('展开当前卷，保留其他范围。'):t('规划全书分卷，保留作者已定主张。')))}>{node?.level==='volume'?t('让AI展开本卷'):t('让AI准备此处')}</button></div>
            </>}
            <div className="work-area">
            {directoryVisible && ["plan", "recycle"].includes(page) && (
              <aside aria-label={t("卷章目录")}>
                {levelFilter !== "all" ? <NodeDirectory nodes={visible} plan={plan!} selected={selected} choose={(id)=>void attempt(()=>changeNode(id))}/> : <div role="tree" aria-label={t("卷章")}>
                  <Tree
                    plan={plan!}
                    root={plan!.root_id}
                    visible={new Set(visible.map((n) => n.id))}
                    selected={selected}
                    choose={(id) => void attempt(() => changeNode(id))}
                  />
                </div>}
                {!visible.length && <div className="directory-empty"><p>{t(query || filter !== "all" ? "没有符合条件的规划。" : "当前范围尚无规划。")}</p>{(query || filter !== "all") && <button onClick={()=>{setQuery("");setFilter("all");}}>{t("清除筛选")}</button>}</div>}
              </aside>
            )}
            <main>
              {["plan", "recycle"].includes(page) && node && (
                <>
                  <div className={"node-heading"+(tab === "overview" && !editing ? " reading-heading" : "")}>
                    <div>
                      <span className="muted">
                        {node.level === "book"
                          ? t("整书")
                          : node.level === "volume"
                            ? t("卷规划")
                            : t("章规划")}
                      </span>
                      <h2>{node.title}</h2>
                      {node.subtitle && <p>{node.subtitle}</p>}
                    </div>
                    <div className="actions">
                      <span className="badge">
                        {t(statusNames[node.planning_status])}
                      </span>
                      {node.id !== plan!.root_id && (
                        <>
                          <button
                            aria-label={t("上移")}
                            onClick={() => void attempt(() => reorder(-1))}
                          >
                            ↑
                          </button>
                          <button
                            aria-label={t("下移")}
                            onClick={() => void attempt(() => reorder(1))}
                          >
                            ↓
                          </button>
                          <button
                            onClick={() =>
                              void attempt(async () => {
                                if (!current) return;
                                await write("archive_node", {
                                  ...baseline(current),
                                  node_id: node.id,
                                  archived: !node.archived,
                                });
                              })
                            }
                          >
                            {node.archived ? t("恢复") : t("归档")}
                          </button>
                        </>
                      )}
                      <button disabled={busy || !!pending} onClick={startEdit}>
                        {t("编辑")}
                      </button>
                      {node.level === "chapter" && (
                        <button
                          onClick={() =>
                            setDialog({
                              kind: "move",
                              value: {
                                parent_id: plan!.nodes.find((n) =>
                                  n.children.includes(node.id),
                                )!.id,
                              },
                            })
                          }
                        >
                          {t("移至其他卷")}
                        </button>
                      )}
                    </div>
                  </div>
                  {tab === "overview" && (
                    <>
                      {editing && draft && meta ? (
                        <section className="editor">
                          <div className="form-grid">
                            {field(
                              t("标题"),
                              meta.title,
                              (v) => {
                                setMeta({ ...meta, title: v });
                                setDirty(true);
                              },
                              false,
                            )}
                            {field(
                              t("副标题"),
                              meta.subtitle,
                              (v) => {
                                setMeta({ ...meta, subtitle: v });
                                setDirty(true);
                              },
                              false,
                            )}
                            <label className="field">
                              <span>{t("规划状态")}</span>
                              <select
                                value={meta.planning_status}
                                onChange={(e) => {
                                  setMeta({
                                    ...meta,
                                    planning_status: e.target.value as any,
                                  });
                                  setDirty(true);
                                }}
                              >
                                {Object.entries(statusNames).map(([k, v]) => (
                                  <option key={k} value={k}>
                                    {t(v)}
                                  </option>
                                ))}
                              </select>
                            </label>
                            {(["target_chapters", "target_words"] as const).map(
                              (k) => (
                                <label className="field" key={k}>
                                  <span>
                                    {k === "target_chapters"
                                      ? t("目标章节数")
                                      : t("目标字数")}
                                  </span>
                                  <input
                                    type="number"
                                    min="0"
                                    value={meta[k]}
                                    onChange={(e) => {
                                      setMeta({
                                        ...meta,
                                        [k]: Number(e.target.value),
                                      });
                                      setDirty(true);
                                    }}
                                  />
                                </label>
                              ),
                            )}
                          </div>
                          {Object.entries(detailLabels).map(([k, label]) => (
                            <React.Fragment key={k}>
                              {field(label, (draft as any)[k], (v) => {
                                setDraft({ ...draft, [k]: v });
                                setDirty(true);
                              })}
                            </React.Fragment>
                          ))}
                          {field(
                            t("关键转折（每行一项）"),
                            draft.turns.join("\n"),
                            (v) => {
                              setDraft({
                                ...draft,
                                turns: v.split("\n").filter(Boolean),
                              });
                              setDirty(true);
                            },
                          )}
                          {field(
                            t("待确认问题（每行一项）"),
                            draft.questions.join("\n"),
                            (v) => {
                              setDraft({
                                ...draft,
                                questions: v.split("\n").filter(Boolean),
                              });
                              setDirty(true);
                            },
                          )}
                          <h3>{t("节拍")}</h3>
                          {draft.beats.map((b, i) => (
                            <div className="repeat-row" key={b.id}>
                              {field(
                                t("节拍标题"),
                                b.title,
                                (v) => {
                                  const d = clone(draft);
                                  d.beats[i].title = v;
                                  setDraft(d);
                                  setDirty(true);
                                },
                                false,
                              )}
                              {field(t("节拍概要"), b.summary, (v) => {
                                const d = clone(draft);
                                d.beats[i].summary = v;
                                setDraft(d);
                                setDirty(true);
                              })}
                              <fieldset>
                                <legend>{t("关联实体")}</legend>
                                {story?.entities.map((e) => (
                                  <label className="check" key={e.id}>
                                    <input
                                      type="checkbox"
                                      checked={b.entity_ids.includes(e.id)}
                                      onChange={(event) => {
                                        const d = clone(draft);
                                        d.beats[i].entity_ids = event.target
                                          .checked
                                          ? [...b.entity_ids, e.id]
                                          : b.entity_ids.filter(
                                              (id) => id !== e.id,
                                            );
                                        setDraft(d);
                                        setDirty(true);
                                      }}
                                    />
                                    {e.name}
                                  </label>
                                ))}
                              </fieldset>
                              <fieldset>
                                <legend>{t("关联伏笔")}</legend>
                                {story?.clues.map((c) => (
                                  <label className="check" key={c.id}>
                                    <input
                                      type="checkbox"
                                      checked={b.clue_ids.includes(c.id)}
                                      onChange={(event) => {
                                        const d = clone(draft);
                                        d.beats[i].clue_ids = event.target
                                          .checked
                                          ? [...b.clue_ids, c.id]
                                          : b.clue_ids.filter(
                                              (id) => id !== c.id,
                                            );
                                        setDraft(d);
                                        setDirty(true);
                                      }}
                                    />
                                    {c.title}
                                  </label>
                                ))}
                              </fieldset>
                              <button
                                onClick={() => {
                                  setDraft({
                                    ...draft,
                                    beats: draft.beats.filter(
                                      (x) => x.id !== b.id,
                                    ),
                                  });
                                  setDirty(true);
                                }}
                              >
                                {t("移除此节拍")}
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={() => {
                              setDraft({
                                ...draft,
                                beats: [
                                  ...draft.beats,
                                  {
                                    id: key(),
                                    title: t("新节拍"),
                                    summary: "",
                                    entity_ids: [],
                                    clue_ids: [],
                                  },
                                ],
                              });
                              setDirty(true);
                            }}
                          >
                            {t("新增节拍")}
                          </button>
                          <h3>{t("当前节点关联")}</h3>
                          {(story?.entities ?? [])
                            .filter((e) => !e.archived)
                            .map((e) => (
                              <label className="check" key={e.id}>
                                <input
                                  type="checkbox"
                                  checked={draft.entity_links.some(
                                    (l) => l.entity_id === e.id,
                                  )}
                                  onChange={(event) => {
                                    setDraft({
                                      ...draft,
                                      entity_links: event.target.checked
                                        ? [
                                            ...draft.entity_links,
                                            {
                                              entity_id: e.id,
                                              role: "",
                                              notes: "",
                                            },
                                          ]
                                        : draft.entity_links.filter(
                                            (l) => l.entity_id !== e.id,
                                          ),
                                    });
                                    setDirty(true);
                                  }}
                                />
                                {e.name}
                              </label>
                            ))}
                          {draft.entity_links.map((link, i) => (
                            <div className="repeat-row" key={link.entity_id}>
                              <h4>
                                {
                                  story?.entities.find(
                                    (e) => e.id === link.entity_id,
                                  )?.name
                                }
                              </h4>
                              {field(
                                t("出场作用"),
                                link.role,
                                (v) => {
                                  const d = clone(draft);
                                  d.entity_links[i].role = v;
                                  setDraft(d);
                                  setDirty(true);
                                },
                                false,
                              )}
                              {field(t("关联说明"), link.notes, (v) => {
                                const d = clone(draft);
                                d.entity_links[i].notes = v;
                                setDraft(d);
                                setDirty(true);
                              })}
                            </div>
                          ))}
                          <h3>{t("正式章节关联")}</h3>
                          <button
                            onClick={() =>
                              void attempt(async () => {
                                if (!window.hetu.host) return;
                                setDocumentOptions(
                                  (await window.hetu.host("work_snapshot", {}))
                                    .documents,
                                );
                              })
                            }
                          >
                            {t("读取可关联章节")}
                          </button>
                          {documentOptions.map((d) => (
                            <label className="check" key={d.document_id}>
                              <input
                                type="checkbox"
                                checked={draft.formal_documents.some(
                                  (f) => f.document_id === d.document_id,
                                )}
                                onChange={(event) => {
                                  const source = d.source_ref;
                                  setDraft({
                                    ...draft,
                                    formal_documents: event.target.checked
                                      ? [
                                          ...draft.formal_documents,
                                          {
                                            document_id: source.document_id,
                                            revision_id: source.revision_id,
                                            sha256: source.sha256,
                                          },
                                        ]
                                      : draft.formal_documents.filter(
                                          (f) =>
                                            f.document_id !== d.document_id,
                                        ),
                                  });
                                  setDirty(true);
                                }}
                              />
                              {d.title}
                            </label>
                          ))}
                          <div className="sticky-actions">
                            <button
                              onClick={() => {
                                if (confirm(t("取消本次编辑？"))) {
                                  delete drafts.current[
                                    draftKey(current.object.object_id, selected)
                                  ];
                                  setDirty(false);
                                  setEditing(false);
                                  void journal(undefined, {
                                    drafts: clone(drafts.current),
                                  });
                                }
                              }}
                            >
                              {t("取消编辑")}
                            </button>
                            <button
                              className="primary"
                              disabled={busy}
                              onClick={() => void attempt(saveDetail)}
                            >
                              {t("保存规划")}
                            </button>
                          </div>
                        </section>
                      ) : (
                        <article>
                          {node.level === "book" && (
                            <section>
                              <h3>{t("作者主张")}</h3>
                              <Markdown remarkPlugins={[remarkGfm]}>
                                {plan!.author_constraints ||
                                  t("尚未记录作者主张。")}
                              </Markdown>
                              <button
                                onClick={() => {
                                  const v = prompt(
                                    t("作者主张"),
                                    plan!.author_constraints,
                                  );
                                  if (v !== null)
                                    void attempt(() =>
                                      write("put_plan", {
                                        ...baseline(current),
                                        title: current.object.title,
                                        content: {
                                          ...plan,
                                          author_constraints: v,
                                        },
                                        source_refs:
                                          current.object.source_refs ?? [],
                                      }),
                                    );
                                }}
                              >
                                {t("编辑主张")}
                              </button>
                            </section>
                          )}
                          <PlanReading node={node} plan={plan!} detail={readOnlyDetail} actual={workSnapshot?.node_id===node.id?workSnapshot:undefined} edit={startEdit} prepare={()=>void attempt(()=>handoff(`为「${node.title}」准备完整规划与详细剧情，保留其他节点。`))} records={<>{runs.filter(r=>r.object.content.target_node_ids.includes(node.id)).map(r=><section className="inline-run" key={r.object.object_id}><div><h3>{r.object.content.goal}</h3><span className="badge">{t(runStateNames[r.object.content.state]??r.object.content.state)}</span></div><details><summary>{t('查看步骤')}</summary><ol>{r.object.content.steps.map((step:any)=><li key={step.id}><strong>{step.title}</strong><span>{step.message||step.status}</span></li>)}</ol></details><div className="actions"><button onClick={()=>setPage('progress')}>{t('查看工作记录')}</button>{!['succeeded','failed','stopped'].includes(r.object.content.state)&&<button onClick={()=>void attempt(async()=>{const stopped=await write('request_stop',{...baseline(r),reason:t('作者请求停止当前工作。')});await handoff(t('请停止当前工作并回传确切结果；先确认未知操作，成功写入不回滚。'),stopped);})}>{t('请求停止')}</button>}</div></section>)}</>}/>

                          <details className="checks">
                            <summary>{t("检查与继续")}</summary>
                            <button
                              onClick={() =>
                                void attempt(async () =>
                                  setIssues(
                                    (
                                      await allPages(
                                        "check_plan",
                                        {
                                          object_id: current.object.object_id,
                                          revision: current.object.revision,
                                        },
                                        "issues",
                                      )
                                    ).items,
                                  ),
                                )
                              }
                            >
                              {t("检查结构与线索")}
                            </button>
                            {issues.map((i, n) => (
                              <p key={n}>
                                {i.message}
                                <button
                                  onClick={() => {
                                    if (i.node_id) void changeNode(i.node_id);
                                  }}
                                >
                                  {t("定位")}
                                </button>
                              </p>
                            ))}
                          </details>
                        </article>
                      )}
                    </>
                  )}
                  {["character", "faction", "location"].includes(tab) && (
                    <section>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={direct}
                          onChange={(e) => setDirect(e.target.checked)}
                        />
                        {t("仅直接关联")}
                      </label>
                      <button onClick={() => void attempt(scopeNetwork)}>
                        {t("读取本卷关联")}
                      </button>
                      <p className="muted">
                        {t("关联使用固定实体与节点，包含后代时保留来源节点。")}
                      </p>
                    </section>
                  )}
                  {tab === "documents" && (
                    <section>
                      <h3>{t("正文接续")}</h3>
                      <p>
                        {t(
                          "规划与正式正文分开保存。建立或调整正式卷章，先交给Agent准备具体方案。",
                        )}
                      </p>
                      <button
                        className="primary"
                        onClick={() =>
                          void attempt(() =>
                            handoff(
                              `将「${node.title}」规划接续到正式卷章与大纲，先核对映射和差异，另行确认正文采纳与定稿。`,
                            ),
                          )
                        }
                      >
                        {t("让AI接续正式卷章")}
                      </button>
                      <button
                        onClick={() =>
                          void attempt(async () => {
                            await actualStatistics();
                          })
                        }
                      >
                        {t("读取实际统计")}
                      </button>
                      {readOnlyDetail?.formal_documents.map((d) => (
                        <button
                          key={d.document_id}
                          onClick={() =>
                            void attempt(async () => {
                              if (!window.hetu.host)
                                throw new Error(t("宿主未提供正文入口。"));
                              await window.hetu.host("open_document", {
                                source_ref: {
                                  kind: "document",
                                  ...d,
                                  work_ref: context.work_ref,
                                },
                              });
                            })
                          }
                        >
                          {t("打开已关联正文")}
                        </button>
                      ))}
                      {workSnapshot?.node_id === node.id && (
                        <p className="statistics">
                          {workSnapshot.word_count === null
                            ? t("当前范围尚未绑定正式正文。")
                            : `${cn(`当前范围共 ${workSnapshot.document_count} 章，${workSnapshot.word_count} 字。`,`${workSnapshot.document_count} chapters, ${workSnapshot.word_count} characters in scope.`)}`}
                          <small>
                            {t("按非空白Unicode字符计数；每章来源固定。")}
                          </small>
                        </p>
                      )}
                    </section>
                  )}
                </>
              )}
              {page === "entities" && (
                <>
                  <div className="section-heading">
                    <h2>{t("实体卡片")}</h2>
                    <button className="primary" onClick={() => openEntity()}>
                      {t("新增")}
                      {t(typeNames[entityType])}
                    </button>
                  </div>
                  <div className="tabs">
                    {Object.entries(typeNames).map(([k, v]) => (
                      <button
                        className={entityType === k ? "active" : ""}
                        key={k}
                        onClick={() => setEntityType(k as EntityType)}
                      >
                        {t(v)}
                      </button>
                    ))}
                  </div>
                  {archiveControl}
                  <div className="cards">
                    {story?.entities
                      .filter(
                        (e) => e.type === entityType && isShown(e.archived),
                      )
                      .map((e) => (
                        <article className="entity" key={e.id}>
                          <h3>
                            {e.name}
                            {e.archived && t("（已归档）")}
                          </h3>
                          <span className="badge">
                            {e.canonical_ref
                              ? t("固定正式来源")
                              : t("规划候选")}
                          </span>
                          <Markdown remarkPlugins={[remarkGfm]}>
                            {e.summary}
                          </Markdown>
                          <p>{e.notes}</p>
                          {e.canonical_ref && (
                            <button
                              onClick={() =>
                                void attempt(async () => {
                                  const source =
                                    network!.object.source_refs[
                                      e.canonical_ref!.source_index
                                    ];
                                  const value = data(
                                    await window.hetu.request(
                                      "hetu.extensions.sources.inspect",
                                      {
                                        source_ref: source,
                                        entity_ref: e.canonical_ref!.entity_ref,
                                      },
                                    ),
                                  );
                                  setDialog({ kind: "source", value });
                                })
                              }
                            >
                              {t("查看正式来源")}
                            </button>
                          )}
                          <button
                            onClick={() =>
                              void attempt(() =>
                                handoff(
                                  `核对规划实体「${e.name}」的正式来源，并通过固定source_refs与canonical_ref接入；未确定的候选保持候选。`,
                                ),
                              )
                            }
                          >
                            {t("让AI核对来源")}
                          </button>
                          <button onClick={() => openEntity(e)}>
                            {t("编辑规划卡")}
                          </button>
                          <button
                            onClick={() =>
                              void attempt(async () => {
                                const n = clone(story!);
                                n.entities.find(
                                  (x) => x.id === e.id,
                                )!.archived = !e.archived;
                                await saveNetwork(n);
                              })
                            }
                          >
                            {e.archived ? t("恢复") : t("归档")}
                          </button>
                        </article>
                      ))}
                  </div>
                  {!story?.entities.some((e) => e.type === entityType) && (
                    <Empty
                      title={cn(`尚无${typeNames[entityType]}规划卡`,`No ${t(typeNames[entityType]).toLowerCase()} cards yet`)}
                      action={() =>
                        void attempt(() =>
                          handoff(
                            `整理当前小说的${t(typeNames[entityType])}，区分规划候选与正式设定。`,
                          ),
                        )
                      }
                    />
                  )}
                </>
              )}
              {page === "clues" && (
                <>
                  <div className="section-heading">
                    <h2>{t("伏笔追踪")}</h2>
                    <button
                      className="primary"
                      onClick={() =>
                        setDialog({
                          kind: "clue",
                          value: {
                            id: key(),
                            title: "",
                            description: "",
                            status: "open",
                            placements: [],
                            notes: "",
                            archived: false,
                          },
                        })
                      }
                    >
                      {t("新增伏笔")}
                    </button>
                  </div>
                  {archiveControl}
                  <label className="field">
                    <span>{t("线索状态")}</span>
                    <select
                      aria-label={t("线索状态")}
                      value={clueFilter}
                      onChange={(e) => setClueFilter(e.target.value)}
                    >
                      {[
                        "all",
                        "open",
                        "developing",
                        "resolved",
                        "abandoned",
                      ].map((v, i) => (
                        <option key={v} value={v}>
                          {
                            [
                              t("全部"),
                              t("未解决"),
                              t("发展中"),
                              t("已回收"),
                              t("已放弃"),
                            ][i]
                          }
                        </option>
                      ))}
                    </select>
                  </label>
                  {story?.clues
                    .filter(
                      (c) =>
                        isShown(c.archived) &&
                        (clueFilter === "all" || c.status === clueFilter),
                    )
                    .map((c) => (
                      <article className="line-item" key={c.id}>
                        <div>
                          <h3>
                            {c.title}
                            {c.archived && t("（已归档）")}
                          </h3>
                          <p>{c.description}</p>
                          <span className="badge">
                            {t(
                              (
                                {
                                  open: "未解决",
                                  developing: "发展中",
                                  resolved: "已回收",
                                  abandoned: "已放弃",
                                } as any
                              )[c.status],
                            )}
                          </span>
                        </div>
                        <div>
                          {c.placements.map((p, i) => (
                            <button
                              key={i}
                              onClick={() => {
                                setPage("plan");
                                void changeNode(p.node_id);
                              }}
                            >
                              {
                                plan?.nodes.find((n) => n.id === p.node_id)
                                  ?.title
                              }{" "}
                              {t(
                                (
                                  {
                                    plant: "埋设",
                                    hint: "提示",
                                    payoff: "回收",
                                  } as any
                                )[p.stage],
                              )}
                            </button>
                          ))}
                        </div>
                        <button
                          onClick={() =>
                            setDialog({ kind: "clue", value: clone(c) })
                          }
                        >
                          {t("编辑")}
                        </button>
                        <button
                          onClick={() =>
                            void attempt(async () => {
                              const n = clone(story!);
                              n.clues.find((x) => x.id === c.id)!.archived =
                                !c.archived;
                              await saveNetwork(n);
                            })
                          }
                        >
                          {c.archived ? t("恢复") : t("归档")}
                        </button>
                      </article>
                    ))}
                  {!story?.clues.length && (
                    <Empty
                      title={t("记录埋设、提示与回收位置")}
                      action={() =>
                        void attempt(() =>
                          handoff(
                            t(
                              "梳理当前规划中的伏笔及回收位置，列明未解决问题。",
                            ),
                          ),
                        )
                      }
                    />
                  )}
                </>
              )}
              {page === "relationships" && (
                <>
                  <div className="section-heading">
                    <h2>{t("关系图谱")}</h2>
                    <button
                      onClick={() =>
                        setDialog({
                          kind: "relation",
                          value: {
                            id: key(),
                            from_id: story?.entities[0]?.id ?? "",
                            to_id: story?.entities[1]?.id ?? "",
                            label: "",
                            notes: "",
                            node_ids: [],
                            archived: false,
                          },
                        })
                      }
                    >
                      {t("新增关系")}
                    </button>
                  </div>
                  {archiveControl}
                  <label className="field">
                    <span>{t("实体类型")}</span>
                    <select
                      aria-label={t("实体类型")}
                      value={graphType}
                      onChange={(e) => setGraphType(e.target.value)}
                    >
                      <option value="all">{t("全部")}</option>
                      {Object.entries(typeNames).map(([k, v]) => (
                        <option key={k} value={k}>
                          {t(v)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <RelationshipGraph network={graphNetwork} />
                  <table>
                    <caption>{t("关系表")}</caption>
                    <thead>
                      <tr>
                        <th>{t("来源")}</th>
                        <th>{t("关系")}</th>
                        <th>{t("关系目标")}</th>
                        <th>{t("操作")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {graphNetwork?.relations.map((r) => (
                        <tr key={r.id}>
                          <td>
                            {
                              story!.entities.find((e) => e.id === r.from_id)
                                ?.name
                            }
                          </td>
                          <td>
                            {r.label}
                            {r.archived && t("（已归档）")}
                          </td>
                          <td>
                            {story!.entities.find((e) => e.id === r.to_id)?.name}
                          </td>
                          <td>
                            <button
                              onClick={() =>
                                setDialog({ kind: "relation", value: clone(r) })
                              }
                            >
                              {t("编辑")}
                            </button>
                            <button
                              onClick={() =>
                                void attempt(async () => {
                                  const n = clone(story!);
                                  n.relations.find(
                                    (x) => x.id === r.id,
                                  )!.archived = !r.archived;
                                  await saveNetwork(n);
                                })
                              }
                            >
                              {r.archived ? t("恢复") : t("归档")}
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!story?.relations.length && (
                    <Empty
                      title={t("让关系回到人物与剧情语境")}
                      action={() =>
                        void attempt(() =>
                          handoff(
                            t("梳理人物、势力和地点关系，标明相关卷章与依据。"),
                          ),
                        )
                      }
                    />
                  )}
                </>
              )}
              {page === "progress" && (
                <>
                  <h2>{t("工作记录")}</h2>
                  <button
                    onClick={() =>
                      void attempt(() =>
                        handoff(
                          t(
                            "接续本方案上次未完成目标，先查询原操作与待接入成果。",
                          ),
                        ),
                      )
                    }
                  >
                    {t("让AI继续工作")}
                  </button>
                  {runs.map((r) => (
                    <article className="run" key={r.object.object_id}>
                      <h3>{r.object.content.goal}</h3>
                      <span className="badge">{t(runStateNames[r.object.content.state]??r.object.content.state)}</span>
                      <ol>
                        {r.object.content.steps.map((s: any) => (
                          <li key={s.id}>
                            <strong>{s.title}</strong>
                            <span>{s.status}</span>
                            <p>{s.message}</p>
                            <small>
                              {s.evidence.kind === "agent_report"
                                ? t("Agent报告")
                                : s.evidence.kind === "core_receipt"
                                  ? t("Core回执")
                                  : t("外部回执")}
                            </small>
                          </li>
                        ))}
                      </ol>
                      <p>{r.object.content.continuation}</p>
                      <button
                        onClick={() =>
                          void attempt(async () => {
                            const stopped = await write("request_stop", {
                              ...baseline(r),
                              reason: t("作者请求停止当前工作。"),
                            });
                            await handoff(
                              t(
                                "请停止当前工作并回传确切结果；先确认未知操作，成功写入不回滚。",
                              ),
                              stopped,
                            );
                          })
                        }
                      >
                        {t("请求停止")}
                      </button>
                      <button
                        onClick={() =>
                          void attempt(() =>
                            handoff(
                              r.object.content.continuation ||
                                r.object.content.goal,
                              r,
                            ),
                          )
                        }
                      >
                        {t("继续此工作")}
                      </button>
                    </article>
                  ))}
                  {!runs.length && (
                    <p>
                      {t(
                        "尚无已交接工作记录。已复制目标不代表Agent已开始执行。",
                      )}
                    </p>
                  )}
                </>
              )}
              {page === "compare" && (
                <>
                  <h2>{t("版本比较")}</h2>
                  <label className="field">
                    <span>{t("与历史修订比较")}</span>
                    <input
                      type="number"
                      min="1"
                      max={current.object.revision}
                      value={revision}
                      onChange={(e) => setRevision(e.target.value)}
                    />
                  </label>
                  <button
                    onClick={() =>
                      void attempt(async () =>
                        setComparison(
                          await allPages(
                            "compare_revisions",
                            {
                              object_id: current.object.object_id,
                              from_revision: Number(revision),
                              to_revision: current.object.revision,
                            },
                            "changes",
                          ).then((r) => ({ ...r, changes: r.items })),
                        ),
                      )
                    }
                  >
                    {t("读取固定差异")}
                  </button>
                  {comparison && (
                    <>
                      <p>
                        {t("修订")}
                        {comparison.from.revision} → {comparison.to.revision}
                      </p>
                      {comparison.changes.length ? (
                        comparison.changes.map((c: any, i: number) => (
                          <section className="diff" key={i}>
                            <code>{c.path}</code>
                            <del>
                              {typeof c.before === "string"
                                ? c.before
                                : JSON.stringify(c.before)}
                            </del>
                            <ins>
                              {typeof c.after === "string"
                                ? c.after
                                : JSON.stringify(c.after)}
                            </ins>
                          </section>
                        ))
                      ) : (
                        <p>{t("两端内容一致。")}</p>
                      )}
                    </>
                  )}
                </>
              )}
            </main>
            </div>
          </div>
        )}
      </div>
      {dialog && (
        <Modal close={() => setDialog(undefined)}>
          <button
            className="close"
            onClick={() => setDialog(undefined)}
            aria-label={t("关闭")}
          >
            ×
          </button>
          {dialog.kind === 'merge' ? <><h2>{t('选择冲突字段')}</h2>{['detail','meta'].flatMap(scope=>dialog.value[scope].conflicts.map((c:any)=><section className="diff" key={scope+':'+c.field}><h3>{t((detailLabels as any)[c.field]??c.field)}</h3><p>{t('编辑基线')}</p><pre>{JSON.stringify(c.base)}</pre><p>{t('本地修改')}</p><pre>{JSON.stringify(c.local)}</pre><p>{t('当前版本')}</p><pre>{JSON.stringify(c.remote)}</pre><select aria-label={t('选择字段版本')+' '+c.field} value={dialog.value.choices[scope+':'+c.field]??''} onChange={e=>setDialog({...dialog,value:{...dialog.value,choices:{...dialog.value.choices,[scope+':'+c.field]:e.target.value}}})}><option value="">{t('请选择')}</option><option value="local">{t('保留本地修改')}</option><option value="remote">{t('保留当前版本')}</option></select></section>))}<button onClick={()=>void attempt(applyMerge)}>{t('确认合并并继续编辑')}</button></> : dialog.kind === "failure" ? (
            <>
              <h2>{t("比较并重新准备")}</h2>
              <p>
                {t(
                  "原操作尚未写入。请核对基线、当前版本与本地输入，确认后重新准备。",
                )}
              </p>
              <h3>{t("当前版本的变化")}</h3>
              <pre>{JSON.stringify(dialog.value.diff, null, 2)}</pre>
              <h3>{t("保留的本地输入")}</h3>
              <pre>{JSON.stringify(dialog.value.pending.input, null, 2)}</pre>
              <button onClick={() => void attempt(prepareAgain)}>
                {t("使用当前版本重新准备")}
              </button>
            </>
          ) : dialog.kind === "source" ? (
            <>
              <h2>{t("固定正式来源")}</h2>
              <Markdown remarkPlugins={[remarkGfm]}>
                {typeof dialog.value.content === "string"
                  ? dialog.value.content
                  : JSON.stringify(
                      dialog.value.entity ?? dialog.value.content,
                      null,
                      2,
                    )}
              </Markdown>
              <details>
                <summary>{t("来源信息")}</summary>
                <pre>{JSON.stringify(dialog.value.source_ref, null, 2)}</pre>
              </details>
            </>
          ) : dialog.kind === "input" ? (
            <>
              <h2>{t("保留的本地输入")}</h2>
              <pre>{JSON.stringify(dialog.value, null, 2)}</pre>
            </>
          ) : dialog.kind === "move" ? (
            <>
              <h2>{t("移至其他卷")}</h2>
              <select
                aria-label={t("目标卷")}
                value={dialog.value.parent_id}
                onChange={(e) =>
                  setDialog({ ...dialog, value: { parent_id: e.target.value } })
                }
              >
                {plan!.nodes
                  .filter((n) => n.level === "volume")
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.title}
                    </option>
                  ))}
              </select>
              <button
                onClick={() =>
                  void attempt(async () => {
                    await write("move_node", {
                      ...baseline(current!),
                      node_id: selected,
                      parent_id: dialog.value.parent_id,
                    });
                    setDialog(undefined);
                  })
                }
              >
                {t("移动章节")}
              </button>
            </>
          ) : dialog.kind === "search" ? (
            <>
              <h2>{t("检索结果")}</h2>
              {dialog.value.map((r: any) => (
                <button
                  className="result"
                  key={r.node.id}
                  onClick={() => {
                    setDialog(undefined);
                    setPage("plan");
                    void changeNode(r.node.id);
                  }}
                >
                  {r.path.map((n: any) => n.title).join(" / ")}
                </button>
              ))}
            </>
          ) : dialog.kind === "scope" ? (
            <>
              <h2>{t("当前范围关联")}</h2>
              {dialog.value?.entities?.map((e: any) => (
                <p key={e.id}>
                  <strong>{e.name}</strong> {e.summary}
                  <small>
                    {dialog.value.associations
                      .filter((a: any) => a.entity_id === e.id)
                      .map(
                        (a: any) =>
                          plan?.nodes.find((n) => n.id === a.node_id)?.title,
                      )
                      .join(" / ")}
                  </small>
                </p>
              ))}
            </>
          ) : (
            <>
              <h2>
                {dialog.kind === "entity"
                  ? t("规划卡")
                  : dialog.kind === "relation"
                    ? t("关系")
                    : t("伏笔")}
              </h2>
              {dialog.kind === "entity" && (
                <>
                  <label className="field">
                    <span>{t("类型")}</span>
                    <select
                      disabled={
                        !!story?.entities.some((e) => e.id === dialog.value.id)
                      }
                      value={dialog.value.type}
                      onChange={(e) =>
                        setDialog({
                          ...dialog,
                          value: { ...dialog.value, type: e.target.value },
                        })
                      }
                    >
                      {Object.entries(typeNames).map(([k, v]) => (
                        <option value={k} key={k}>
                          {t(v)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {field(
                    t("名称"),
                    dialog.value.name,
                    (v) =>
                      setDialog({
                        ...dialog,
                        value: { ...dialog.value, name: v },
                      }),
                    false,
                  )}
                  {field(t("概要"), dialog.value.summary, (v) =>
                    setDialog({
                      ...dialog,
                      value: { ...dialog.value, summary: v },
                    }),
                  )}
                </>
              )}
              {dialog.kind === "relation" && (
                <>
                  {(["from_id", "to_id"] as const).map((k) => (
                    <label className="field" key={k}>
                      <span>{k === "from_id" ? t("来源") : t("目标")}</span>
                      <select
                        value={dialog.value[k]}
                        onChange={(e) =>
                          setDialog({
                            ...dialog,
                            value: { ...dialog.value, [k]: e.target.value },
                          })
                        }
                      >
                        <option value="">{t("选择实体")}</option>
                        {story?.entities.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  {field(
                    t("关系名称"),
                    dialog.value.label,
                    (v) =>
                      setDialog({
                        ...dialog,
                        value: { ...dialog.value, label: v },
                      }),
                    false,
                  )}
                  <h3>{t("相关卷章")}</h3>
                  {plan!.nodes.map((n) => (
                    <label className="check" key={n.id}>
                      <input
                        type="checkbox"
                        checked={dialog.value.node_ids.includes(n.id)}
                        onChange={(e) =>
                          setDialog({
                            ...dialog,
                            value: {
                              ...dialog.value,
                              node_ids: e.target.checked
                                ? [...dialog.value.node_ids, n.id]
                                : dialog.value.node_ids.filter(
                                    (id: string) => id !== n.id,
                                  ),
                            },
                          })
                        }
                      />
                      {n.title}
                    </label>
                  ))}
                </>
              )}
              {dialog.kind === "clue" && (
                <>
                  {field(
                    t("标题"),
                    dialog.value.title,
                    (v) =>
                      setDialog({
                        ...dialog,
                        value: { ...dialog.value, title: v },
                      }),
                    false,
                  )}
                  {field(t("内容"), dialog.value.description, (v) =>
                    setDialog({
                      ...dialog,
                      value: { ...dialog.value, description: v },
                    }),
                  )}
                  <label className="field">
                    <span>{t("状态")}</span>
                    <select
                      value={dialog.value.status}
                      onChange={(e) =>
                        setDialog({
                          ...dialog,
                          value: { ...dialog.value, status: e.target.value },
                        })
                      }
                    >
                      {["open", "developing", "resolved", "abandoned"].map(
                        (v, i) => (
                          <option key={v} value={v}>
                            {
                              [
                                t("未解决"),
                                t("发展中"),
                                t("已回收"),
                                t("已放弃"),
                              ][i]
                            }
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <h3>{t("埋设与回收")}</h3>
                  {dialog.value.placements.map((p: any, i: number) => (
                    <div className="placement" key={i}>
                      <select
                        aria-label={t("关联节点")}
                        value={p.node_id}
                        onChange={(e) => {
                          const v = clone(dialog.value);
                          v.placements[i].node_id = e.target.value;
                          setDialog({ ...dialog, value: v });
                        }}
                      >
                        {plan!.nodes.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.title}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label={t("线索阶段")}
                        value={p.stage}
                        onChange={(e) => {
                          const v = clone(dialog.value);
                          v.placements[i].stage = e.target.value;
                          setDialog({ ...dialog, value: v });
                        }}
                      >
                        <option value="plant">{t("埋设")}</option>
                        <option value="hint">{t("提示")}</option>
                        <option value="payoff">{t("回收")}</option>
                      </select>
                      {field(
                        t("位置说明"),
                        p.notes,
                        (v) => {
                          const c = clone(dialog.value);
                          c.placements[i].notes = v;
                          setDialog({ ...dialog, value: c });
                        },
                        false,
                      )}
                      <button
                        onClick={() => {
                          const v = clone(dialog.value);
                          v.placements.splice(i, 1);
                          setDialog({ ...dialog, value: v });
                        }}
                      >
                        {t("移除")}
                      </button>
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      setDialog({
                        ...dialog,
                        value: {
                          ...dialog.value,
                          placements: [
                            ...dialog.value.placements,
                            {
                              node_id: selected || plan!.root_id,
                              stage: "plant",
                              notes: "",
                            },
                          ],
                        },
                      })
                    }
                  >
                    {t("新增位置")}
                  </button>
                </>
              )}
              {field(t("备注"), dialog.value.notes, (v) =>
                setDialog({ ...dialog, value: { ...dialog.value, notes: v } }),
              )}
              <button
                className="primary"
                disabled={busy}
                onClick={() => void attempt(submitDialog)}
              >
                {t("保存")}
              </button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
function Icon({name}:{name:string}) {
  const paths:Record<string,React.ReactNode> = {
    book:<><path d="M12 7v14M3 3h6a3 3 0 0 1 3 3 3 3 0 0 1 3-3h6v16h-6a3 3 0 0 0-3 2 3 3 0 0 0-3-2H3Z"/></>,
    layers:<><path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5"/></>,
    outline:<><rect x="3" y="3" width="18" height="4" rx="1"/><path d="M12 7v5M6 12h12M6 12v3m12-3v3"/><rect x="3" y="15" width="6" height="6" rx="1"/><rect x="15" y="15" width="6" height="6" rx="1"/></>,
    pen:<><path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 6 6-1M12 21h9"/></>,
    clue:<><path d="M5 3h14v18H5zM8 7h8M8 11h5M8 15h8"/></>,
    character:<><circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/></>,
    location:<><path d="M20 10c0 6-8 11-8 11S4 16 4 10a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></>,
    faction:<><path d="M5 21V3c5-4 9 4 14 0v11c-5 4-9-4-14 0"/></>,
    item:<><path d="m12 2 9 5v10l-9 5-9-5V7l9-5ZM3 7l9 5 9-5M12 12v10M7 4.8l10 5.5"/></>,
    rule:<><path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/><circle cx="12" cy="12" r="6"/><path d="m9 12 2 2 4-4"/></>,
    rules:<><path d="M4 3h16v18H4zM8 7h8M8 11h8M8 15h5"/></>,
    relations:<><circle cx="6" cy="5" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v8a4 4 0 0 0 4 4h6M18 17V9a4 4 0 0 0-4-4h-2"/></>,
    progress:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/></>,
    compare:<><path d="M8 3v18m8-18v18M4 7l4-4 4 4m0 10 4 4 4-4"/></>,
    plus:<path d="M12 4v16M4 12h16"/>,
    refresh:<><path d="M20 7V3l-4 4M4 17v4l4-4M20 7a8 8 0 0 0-14-2M4 17a8 8 0 0 0 14 2"/></>,
  };
  return <svg className="icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]??paths.book}</svg>;
}
function NodeDirectory({nodes,plan,selected,choose}:{nodes:PlanNode[];plan:Plan;selected:string;choose:(id:string)=>void}) {
  const container = useRef<HTMLDivElement>(null);
  return <div className="outline-list" role="listbox" aria-label={t("卷章")} ref={container}>
    {nodes.map((node,i)=>{
      const parent=plan.nodes.find(n=>n.children.includes(node.id));
      const ordinal=(parent?.children.indexOf(node.id)??i)+1;
      return <button className="node-option" role="option" key={node.id} data-node-id={node.id} aria-selected={node.id===selected} tabIndex={node.id===selected||(!nodes.some(n=>n.id===selected)&&i===0)?0:-1} onClick={()=>choose(node.id)} onKeyDown={event=>{
        const index=event.key==='ArrowDown'?Math.min(i+1,nodes.length-1):event.key==='ArrowUp'?Math.max(i-1,0):event.key==='Home'?0:event.key==='End'?nodes.length-1:-1;
        if(index<0)return;
        event.preventDefault();
        choose(nodes[index].id);
        container.current?.querySelectorAll<HTMLElement>('[role="option"]')[index]?.focus();
      }}><strong>{node.title}</strong><small>{node.level==='volume'?t('第 {n} 卷').replace('{n}',String(ordinal)):parent?.title} <span>{t(statusNames[node.planning_status])}</span></small><span className={'node-state '+node.planning_status} aria-hidden="true"/></button>;
    })}
  </div>;
}
function PlanReading({node,plan,detail,actual,edit,prepare,records}:{node:PlanNode;plan:Plan;detail?:Detail;actual?:any;edit:()=>void;prepare:()=>void;records?:React.ReactNode}){
 const chapterCount=descendants(plan,node.id).filter(id=>nodeOf(plan,id).level==='chapter'&&!effectiveArchived(plan,id)).length;
 const field=(label:string,value:string,wide=false)=><div className={'reading-field'+(wide?' wide':'')}><h4>{t(label)}</h4><Markdown remarkPlugins={[remarkGfm]}>{value||t('待补充')}</Markdown></div>;
 const section=(number:string,title:string,body:React.ReactNode,id?:string)=><section className="reading-section" id={id}><div className="section-marker"><span>{number}</span><h3>{t(title)}</h3><button className="edit-section" aria-label={t('编辑')+' '+t(title)} onClick={edit}><Icon name="pen"/></button></div><div className="section-content">{body}</div></section>;
 return <div className="plan-reading">
  <button className="jump-to-plot" onClick={()=>document.getElementById('detailed-plot')?.scrollIntoView({block:'start'})}>↓ {t('前往详细剧情')}</button>
  {section('01',node.level==='volume'?'卷信息':node.level==='chapter'?'章信息':'整书信息',<div className="reading-grid information-grid">
   {field(node.level==='volume'?'卷标题':'标题',node.title)}{field(node.level==='volume'?'卷副标题':'副标题',node.subtitle)}{field('规划状态',t(statusNames[node.planning_status]))}
   {field('概要',detail?.summary??'',true)}{field(node.level==='volume'?'本卷目标':'目标',detail?.goal??'')}{field(node.level==='volume'?'本卷主题':'主题',detail?.theme??'')}
   <div className="reading-field"><h4>{t('已规划章节')}</h4><p>{chapterCount}</p></div><div className="reading-field"><h4>{t('正文实际字数')}</h4><p>{actual?actual.word_count?.toLocaleString()??t('未绑定正文'):t('未读取')}</p></div>
  </div>)}
  {section('02',node.level==='volume'?'本卷规划':node.level==='chapter'?'本章规划':'整书规划',<div className="reading-grid planning-grid">
   {field('开局',detail?.opening??'')}{field('主要冲突',detail?.conflict??'')}
   <div className="reading-field wide"><h4>{t('关键转折')}</h4>{detail?.turns.length?<ol className="turning-points">{detail.turns.map((turn,i)=><li key={i}>{turn}</li>)}</ol>:<p className="muted">{t('待补充')}</p>}</div>
   {field('起始状态',detail?.start_state??'')}{field('结束状态',detail?.end_state??'')}
   <div className="reading-field"><h4>{t('目标章节数')}</h4><p>{node.target_chapters||t('未设定')}</p></div><div className="reading-field"><h4>{t('目标字数')}</h4><p>{node.target_words?node.target_words.toLocaleString():t('未设定')}</p></div>
   {!!detail?.hook&&field('悬念',detail.hook,true)}
  </div>)}
  {section('03','详细剧情',<>{records}<div className="plot-prose"><Markdown remarkPlugins={[remarkGfm]}>{detail?.detailed_plot||t('尚无详细剧情。')}</Markdown></div>{!detail?.detailed_plot&&<button onClick={prepare}>{t('让AI准备此处')}</button>}{!!detail?.beats.length&&<div className="beats"><h4>{t('节拍')}</h4>{detail.beats.map((beat,i)=><div key={beat.id}><span>{String(i+1).padStart(2,'0')}</span><div><h4>{beat.title}</h4><p>{beat.summary}</p></div></div>)}</div>}{!!detail?.notes&&field('备注',detail.notes,true)}{!!detail?.questions.length&&<div className="open-questions"><h4>{t('待确认问题')}</h4><ul>{detail.questions.map((q,i)=><li key={i}>{q}</li>)}</ul></div>}</>,'detailed-plot')}
 </div>;
}
function Modal({
  children,
  close,
}: {
  children: React.ReactNode;
  close: () => void;
}) {
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const first = element.current?.querySelector<HTMLElement>(
      "button,input,select,textarea,[tabindex]",
    );
    first?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        ref={element}
        role="dialog"
        aria-modal="true"
        aria-label={t("规划编辑")}
        className="modal"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.stopPropagation();
            close();
          }
          if (event.key === "Tab") {
            const list = [
              ...element.current!.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
              ),
            ].filter((e) => e.getClientRects().length);
            const at = list.indexOf(document.activeElement as HTMLElement);
            if (event.shiftKey && at <= 0) {
              event.preventDefault();
              list.at(-1)?.focus();
            } else if (!event.shiftKey && at === list.length - 1) {
              event.preventDefault();
              list[0]?.focus();
            }
          }
        }}
      >
        {children}
      </section>
    </div>
  );
}
function Tree({
  plan,
  root,
  visible,
  selected,
  choose,
}: {
  plan: Plan;
  root: string;
  visible: Set<string>;
  selected: string;
  choose: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(new Set<string>()),
    container = useRef<HTMLDivElement>(null);
  const ordered: { node: PlanNode; level: number }[] = [];
  const visit = (id: string, level: number) => {
    const node = nodeOf(plan, id);
    if (
      !visible.has(id) &&
      !descendants(plan, id).some((child) => visible.has(child))
    )
      return;
    ordered.push({ node, level });
    if (!collapsed.has(id))
      node.children.forEach((child) => visit(child, level + 1));
  };
  visit(root, 1);
  const focus = (id: string) => {
    choose(id);
    requestAnimationFrame(() =>
      container.current
        ?.querySelector<HTMLButtonElement>(
          '[data-node-id="' + CSS.escape(id) + '"]',
        )
        ?.focus(),
    );
  };
  const collapse = (id: string, value: boolean) =>
    setCollapsed((old) => {
      const next = new Set(old);
      value ? next.add(id) : next.delete(id);
      return next;
    });
  return (
    <div ref={container}>
      {ordered.map(({ node, level }, i) => (
        <div
          className="tree-row"
          key={node.id}
          style={{ paddingLeft: (level - 1) * 12 }}
        >
          {!!node.children.length && (
            <button
              className="tree-toggle"
              tabIndex={-1}
              aria-label={
                (collapsed.has(node.id) ? t("展开") : t("折叠")) +
                " " +
                node.title
              }
              onClick={() => collapse(node.id, !collapsed.has(node.id))}
            >
              {collapsed.has(node.id) ? "›" : "⌄"}
            </button>
          )}
          <button
            role="treeitem"
            data-node-id={node.id}
            tabIndex={
              selected === node.id ||
              (!ordered.some((r) => r.node.id === selected) && i === 0)
                ? 0
                : -1
            }
            aria-level={level}
            aria-selected={selected === node.id}
            aria-expanded={
              node.children.length ? !collapsed.has(node.id) : undefined
            }
            className={selected === node.id ? "active" : ""}
            onClick={() => choose(node.id)}
            onKeyDown={(event) => {
              const k = event.key;
              if (
                ![
                  "ArrowDown",
                  "ArrowUp",
                  "ArrowRight",
                  "ArrowLeft",
                  "Home",
                  "End",
                ].includes(k)
              )
                return;
              event.preventDefault();
              if (k === "ArrowDown" && ordered[i + 1])
                focus(ordered[i + 1].node.id);
              if (k === "ArrowUp" && ordered[i - 1])
                focus(ordered[i - 1].node.id);
              if (k === "Home") focus(ordered[0].node.id);
              if (k === "End") focus(ordered.at(-1)!.node.id);
              if (k === "ArrowRight" && node.children.length) {
                if (collapsed.has(node.id)) collapse(node.id, false);
                else focus(node.children[0]);
              }
              if (k === "ArrowLeft") {
                if (node.children.length && !collapsed.has(node.id))
                  collapse(node.id, true);
                else {
                  const parent = plan.nodes.find((n) =>
                    n.children.includes(node.id),
                  );
                  if (parent) focus(parent.id);
                }
              }
            }}
          >
            {node.title}
            <small>{t(statusNames[node.planning_status])}</small>
          </button>
        </div>
      ))}
    </div>
  );
}
function Empty({ title, action }: { title: string; action: () => void }) {
  return (
    <div className="empty small">
      <h3>{title}</h3>
      <button onClick={action}>{t("让AI处理")}</button>
    </div>
  );
}
function RelationshipGraph({ network }: { network?: Network }) {
  const nodes = network?.entities ?? [],
    width = 820,
    height = Math.max(150, Math.ceil(nodes.length / 4) * 130);
  const position = (id: string) => {
    const i = nodes.findIndex((n) => n.id === id);
    return { x: 110 + (i % 4) * 200, y: 65 + Math.floor(i / 4) * 130 };
  };
  return (
    <div className="graph">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={t("实体关系图")}
      >
        <defs>
          <marker
            id="arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="3"
            orient="auto"
          >
            <path d="M0 0 L0 6 L7 3z" />
          </marker>
        </defs>
        {network?.relations
          .filter(
            (r) =>
              nodes.some((n) => n.id === r.from_id) &&
              nodes.some((n) => n.id === r.to_id),
          )
          .map((r) => {
            const a = position(r.from_id),
              b = position(r.to_id);
            const dx=b.x-a.x,dy=b.y-a.y;
            const scale=dx||dy?Math.min(dx?75/Math.abs(dx):Infinity,dy?20/Math.abs(dy):Infinity):0;
            return (
              <g key={r.id}>
                <line
                  x1={a.x+dx*scale}
                  y1={a.y+dy*scale}
                  x2={b.x-dx*scale}
                  y2={b.y-dy*scale}
                  markerEnd="url(#arrow)"
                />
                <text
                  x={(a.x + b.x) / 2}
                  y={(a.y + b.y) / 2 - 10}
                  textAnchor="middle"
                >
                  {r.label}
                </text>
              </g>
            );
          })}
        {nodes.map((n) => {
          const p = position(n.id);
          return (
            <g key={n.id}>
              <title>{n.name}</title>
              <rect x={p.x - 75} y={p.y - 20} width="150" height="40" rx="6" />
              <text x={p.x} y={p.y + 5} textAnchor="middle">
                {Array.from(n.name).length>12?Array.from(n.name).slice(0,11).join("")+"…":n.name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
