import React, { useState } from "react";
import { temporal } from "./depth.ts";
export function DepthView({
  p,
  tab,
  invoke,
  onError,
}: {
  p: any;
  tab: string;
  invoke: (a: string, i: any) => Promise<any>;
  onError: (e: any) => void;
}) {
  const [entity, setEntity] = useState(""),
    [event, setEvent] = useState(""),
    [result, setResult] = useState<any>(),
    [changed, setChanged] = useState("0");
  const title = (id: string) =>
    p.events.find((e: any) => e.id === id)?.title ?? id;
  if (tab === "constraints") {
    const t = temporal(p);
    return (
      <section aria-label="偏序与时间约束">
        <h2>事件偏序</h2>
        <p className="muted">{t.basis}</p>
        {!p.depth && <p>尚未建立明确时间约束，原时间标签保持原义。</p>}
        {t.levels.map((level, i) => (
          <article key={i}>
            <h3>偏序层级 {i + 1}</h3>
            {level.map((group, k) => (
              <p key={k}>
                {group.map(title).join("、")}
                {group.length > 1 ? "（明确同时）" : ""}
              </p>
            ))}
          </article>
        ))}
        {t.conflicts.map((c: any, i) => (
          <p role="alert" key={i}>
            约束冲突：{c.constraint_ids.join("、")}，
            {c.kind === "interval" ? "时间区间无法同时满足" : "事件顺序成环"}
          </p>
        ))}
        <h3>时距</h3>
        {p.depth?.constraints.map((c: any) => (
          <article key={c.id}>
            <p>
              {title(c.from)}{" "}
              {c.relation === "before"
                ? "早于"
                : c.relation === "after"
                  ? "晚于"
                  : "同时于"}{" "}
              {title(c.to)}
            </p>
            {c.gap && (
              <p>
                间隔 {c.gap.min} 至 {c.gap.max ?? "无明确上限"} {c.gap.unit}
              </p>
            )}
            {c.evidence.map((e: any, i: number) => (
              <blockquote key={i}>{e.quote}</blockquote>
            ))}
          </article>
        ))}
        {t.unbound_event_ids.length > 0 && (
          <p>时间关系未明：{t.unbound_event_ids.map(title).join("、")}</p>
        )}
      </section>
    );
  }
  if (tab === "knowledge") {
    const people = [
      ...new Set<string>(
        (p.depth?.knowledge ?? []).map((k: any) => k.entity_ref),
      ),
    ];
    return (
      <section aria-label="人物知情变化">
        <h2>人物知情</h2>
        <div className="row">
          <label>
            人物
            <select
              aria-label="知情人物"
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                setResult(undefined);
              }}
            >
              <option value="">选择人物</option>
              {people.map((id, i) => (
                <option key={id} value={id}>
                  人物 {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label>
            事件
            <select
              aria-label="知情事件"
              value={event}
              onChange={(e) => {
                setEvent(e.target.value);
                setResult(undefined);
              }}
            >
              <option value="">选择时点</option>
              {p.events.map((e: any) => (
                <option key={e.id} value={e.id}>
                  {e.title}
                </option>
              ))}
            </select>
          </label>
          <button
            disabled={!entity || !event}
            onClick={() =>
              void invoke("preview_knowledge", {
                entity_ref: entity,
                event_id: event,
              })
                .then(setResult)
                .catch(onError)
            }
          >
            核对这个时点
          </button>
        </div>
        {result && (
          <aside aria-label="知情结果">
            {result.states.map((s: any) => (
              <p key={s.proposition}>
                {s.proposition}：
                {s.state === "known"
                  ? "已获知"
                  : s.state === "belief"
                    ? "相信，未核实"
                    : "已遗忘"}
              </p>
            ))}
            {result.uncertain.map((u: any) => (
              <p key={u.proposition}>
                {u.proposition}：{u.reason}
              </p>
            ))}
            {!result.states.length && !result.uncertain.length && (
              <p>本范围没有可确认的获知记录。</p>
            )}
          </aside>
        )}
        <h3>固定变化依据</h3>
        {p.depth?.knowledge.map((k: any) => (
          <article key={k.id}>
            <h3>{k.proposition}</h3>
            <p>
              {title(k.event_id)}，
              {k.change === "learn"
                ? "获知"
                : k.change === "believe"
                  ? "误信或相信"
                  : "遗忘"}
            </p>
            {k.evidence.map((e: any, i: number) => (
              <blockquote key={i}>{e.quote}</blockquote>
            ))}
          </article>
        ))}
      </section>
    );
  }
  return (
    <section aria-label="来源影响与阅读覆盖">
      <h2>修改影响预览</h2>
      <label>
        变化的固定来源
        <select
          aria-label="变化来源"
          value={changed}
          onChange={(e) => setChanged(e.target.value)}
        >
          {p.depth?.coverage.map((c: any) => (
            <option key={c.source_index} value={c.source_index}>
              固定来源 {c.source_index + 1}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={!p.depth?.coverage.length}
        onClick={() =>
          void invoke("preview_continuity_impact", {
            changed_source_indices: [Number(changed)],
          })
            .then(setResult)
            .catch(onError)
        }
      >
        查看依赖影响
      </button>
      {result?.events?.map((e: any) => (
        <article key={e.event_id}>
          <h3>{title(e.event_id)}</h3>
          <p>{e.reasons.join("；")}</p>
          <small>待复核</small>
        </article>
      ))}
      <h3>阅读覆盖</h3>
      {p.depth?.coverage.map((c: any) => (
        <p key={c.source_index}>
          固定来源 {c.source_index + 1}：
          {c.status === "read"
            ? "已读"
            : c.status === "failed"
              ? "失败"
              : "未读"}{" "}
          {c.note}
        </p>
      ))}
      <p className="muted">
        来源影响只准备复核范围，旧事件、正文与作者决定保持。
      </p>
    </section>
  );
}
