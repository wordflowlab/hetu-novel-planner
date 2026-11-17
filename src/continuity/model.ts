import * as validators from "./validators.ts";
import {
  requireValue as need,
  clone,
  canonical,
} from "../../vendor/project-store.ts";
import manifest from "../../contracts/plugin-manifest.json" with { type: "json" };
export { clone, canonical };
export const ids = new Set([
  "list_continuities",
  "get_continuity",
  "save_continuity",
  "put_decision",
  "put_event",
  "put_state",
  "get_timeline",
  "build_continuation_context",
]);
export const effects = new Set([
  "save_continuity",
  "put_decision",
  "put_event",
  "put_state",
]);
export function validateAction(action: string, input: unknown) {
  const f = (validators as any)[action];
  need(f && f(input), "连续性动作参数无效：" + JSON.stringify(f?.errors));
}
export function validate(p: any) {
  const f = (validators as any).continuity;
  need(f(p), "连续性数据无效：" + JSON.stringify(f.errors));
  for (const key of ["decisions", "events", "states"])
    need(
      new Set(p[key].map((v: any) => v.id)).size === p[key].length,
      "专业ID重复。",
    );
  for (const d of p.decisions) {
    need(d.options.length >= 2, "剧情决策至少比较两个不同选项。");
    need(
      new Set(d.options.map((o: any) => o.id)).size === d.options.length,
      "选项ID重复。",
    );
    need(
      new Set(d.options.map((o: any) => o.summary.trim())).size ===
        d.options.length,
      "选项必须具有不同方向。",
    );
    need(
      d.selected_option_id === null ||
        d.options.some((o: any) => o.id === d.selected_option_id),
      "选定方向不存在。",
    );
  }
  for (const s of p.states)
    need(
      p.events.some((e: any) => e.id === s.event_id),
      "状态必须锚定已有事件。",
    );
}
export function newContinuity(plan_ref: any, title = "剧情接续") {
  return {
    format_version: 1,
    title,
    plan_ref,
    decisions: [],
    events: [],
    states: [],
  };
}

export const PLUGIN_ID = "org.wordflowlab.novel-planner",
  KIND = "novel_plan_continuity",
  WORK_KIND = "novel" as const;
