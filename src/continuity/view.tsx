import { DepthView } from "./depth-view.tsx";
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { unwrap, type PluginBridge } from "../../vendor/hetu-sdk.ts";
import "./style.css";
const api = (window as unknown as { hetu: PluginBridge }).hetu;
async function call(a: string, i: any = {}) {
  return unwrap<any>((await api.invoke(a, i)) as any);
}
function App() {
  const [rows, setRows] = useState<any[]>([]),
    [r, setR] = useState<any>(),
    [tab, setTab] = useState("decisions"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [order, setOrder] = useState("narrative");
  const p = r?.object.content;
  async function run(f: () => Promise<void>) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await f();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function load() {
    const out: any[] = [];
    let cursor: string | undefined;
    do {
      const v = await call("list_continuities", {
        limit: 100,
        ...(cursor ? { cursor } : {}),
      });
      out.push(...v.objects);
      cursor = v.next_cursor ?? undefined;
    } while (cursor);
    setRows(out);
    if (r || out[0])
      setR(
        await call("get_continuity", {
          object_id: r?.object.object_id ?? out[0].object_id,
        }),
      );
  }
  useEffect(() => {
    void run(async () => {
      const pref: any = await api.host?.("preferences", {});
      const theme = (v: any) => {
        document.documentElement.style.colorScheme =
          v.theme === "system" ? "light dark" : v.theme;
      };
      theme(pref ?? { theme: "system" });
      api.onPreferences?.(theme);
      await load();
    });
  }, []);
  return (
    <>
      <header>
        <button onClick={() => api.host?.("close_view", {})}>← 返回</button>
        <h1>剧情决策与时间线</h1>
        <select
          aria-label="选择连续性方案"
          value={r?.object.object_id ?? ""}
          onChange={(e) =>
            void run(async () =>
              setR(await call("get_continuity", { object_id: e.target.value })),
            )
          }
        >
          <option value="">选择方案</option>
          {rows.map((v) => (
            <option key={v.object_id} value={v.object_id}>
              {v.title}
            </option>
          ))}
        </select>
        <button disabled={busy} onClick={() => void run(load)}>
          刷新
        </button>
        <button
          disabled={busy}
          className="primary"
          onClick={() =>
            void run(async () => {
              await api.host?.("handoff", {
                goal: "先读取当前规划和已写正文，比较真正不同的后续方向，梳理故事时间与人物知情状态；续写候选由宿主承载。",
                ...(r
                  ? {
                      object_ref: {
                        object_id: r.object.object_id,
                        revision: r.object.revision,
                        sha256: r.sha256,
                      },
                    }
                  : {}),
              });
              setStatus("已复制接续说明，可粘贴到当前Agent对话");
            })
          }
        >
          让AI处理
        </button>
      </header>
      <nav aria-label="专业视图">
        {[
          ["decisions", "方向比较"],
          ["events", "时间线"],
          ["states", "人物状态"],
          ["constraints", "偏序约束"],
          ["knowledge", "人物知情"],
          ["impact", "修改影响"],
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>
      {status && (
        <p role="status" className="status">
          {status}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <main>
        {!p ? (
          <>
            <h2>接续整部作品</h2>
            <p>
              先让Agent读取已写内容与整书规划，再准备方向、时间和状态；不把未来规划当成已发生事实。
            </p>
          </>
        ) : (
          <>
            <h2>{p.title}</h2>
            <p className="muted">
              固定规划修订 {p.plan_ref.revision}，连续性修订 {r.object.revision}
            </p>
            {tab === "events" && (
              <label>
                时间线排序{" "}
                <select
                  aria-label="时间线排序"
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                >
                  <option value="narrative">叙事顺序</option>
                  <option value="story">故事时间文本，未知置后</option>
                </select>
              </label>
            )}
            {["constraints", "knowledge", "impact"].includes(tab) && (
              <DepthView
                key={tab}
                p={p}
                tab={tab}
                invoke={(a, i) =>
                  call(a, {
                    object_id: r.object.object_id,
                    revision: r.object.revision,
                    ...i,
                  })
                }
                onError={(e) => setError(String(e))}
              />
            )}
            {[...(p[tab] ?? [])]
              .sort((a: any, b: any) =>
                tab !== "events"
                  ? 0
                  : order === "narrative"
                    ? a.narrative_order - b.narrative_order
                    : a.story_time === null
                      ? b.story_time === null
                        ? 0
                        : 1
                      : b.story_time === null
                        ? -1
                        : a.story_time.localeCompare(b.story_time),
              )
              .map((v: any) => (
                <article key={v.id}>
                  <h3>{v.title ?? "人物状态"}</h3>
                  {v.entity_ref && (
                    <details>
                      <summary>对象引用</summary>
                      <code>{v.entity_ref}</code>
                    </details>
                  )}
                  {v.question && <p>{v.question}</p>}
                  {v.options && (
                    <div className="compare">
                      {v.options.map((o: any) => (
                        <section key={o.id}>
                          <h4>
                            {o.summary}
                            {v.selected_option_id === o.id ? "，选定方向" : ""}
                          </h4>
                          <p>代价：{o.costs.join("；") || "待说明"}</p>
                          <p>承诺：{o.promises.join("；") || "待说明"}</p>
                          <p>影响：{o.consequences.join("；") || "待说明"}</p>
                        </section>
                      ))}
                    </div>
                  )}
                  {v.story_time !== undefined && (
                    <p>
                      故事时间：{v.story_time ?? "未知"}，叙事顺序：
                      {v.narrative_order}
                    </p>
                  )}
                  {v.summary && <p>{v.summary}</p>}
                  {v.knowledge && <p>人物知情：{v.knowledge}</p>}
                  {v.condition && <p>状态：{v.condition}</p>}
                  {v.evidence?.map((e: any, i: number) => (
                    <blockquote key={i}>
                      {e.quote}
                      <small>固定来源 {e.source_index + 1}</small>
                    </blockquote>
                  ))}
                </article>
              ))}
            {!["constraints", "knowledge", "impact"].includes(tab) &&
              !(p[tab] ?? []).length && (
                <p>此项尚未整理，可让Agent基于固定依据补齐。</p>
              )}
          </>
        )}
      </main>
      <footer>方向选择是规划决定，正文采纳与定稿独立处理。</footer>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
