import { test } from "node:test";
import assert from "node:assert/strict";
import { memoryCore, hash } from "./support/continuity-memory.ts";
import { newContinuity, validate } from "../src/continuity/model.ts";
import { newPlan } from "../src/domain/model.ts";
const base = (r: any, key: string) => ({
  object_id: r.object.object_id,
  expected_revision: r.object.revision,
  expected_sha256: r.sha256,
  operation_key: key,
});
function fixture() {
  const c = memoryCore(),
    object = {
      object_id: "ext_plan",
      owner_plugin_id: "org.wordflowlab.novel-planner",
      kind: "novel_plan",
      revision: 1,
      content: newPlan("雨港", "book"),
    },
    plan = { object, sha256: hash(object) };
  c.records.set(object.object_id, [plan]);
  const ref = { object_id: object.object_id, revision: 1, sha256: plan.sha256 };
  return { c, ref };
}
function value(r: any) {
  assert.equal(r.status, "succeeded", JSON.stringify(r));
  return r.data;
}
async function create(c: any, ref: any) {
  return value(
    await c.invoke("save_continuity", {
      content: newContinuity(ref),
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "create",
    }),
  );
}
const decision: any = {
  id: "d",
  title: "下一封信",
  question: "先查寄件人还是保护邮局",
  options: [
    {
      id: "a",
      summary: "追查寄件人",
      costs: ["暴露线索"],
      promises: ["揭示旧案"],
      consequences: ["推进外部冲突"],
    },
    {
      id: "b",
      summary: "先守住邮局",
      costs: ["线索延后"],
      promises: ["人物信任"],
      consequences: ["强化内部关系"],
    },
  ],
  selected_option_id: null,
};
test("连续性固定关联真实规划，错误类型或摘要拒绝", async () => {
  const { c, ref } = fixture();
  const r = await create(c, ref);
  assert.equal(r.object.kind, "novel_plan_continuity");
  const bad = await c.invoke("save_continuity", {
    content: newContinuity({ ...ref, sha256: "f".repeat(64) }),
    expected_revision: 0,
    expected_sha256: "",
    operation_key: "bad",
  });
  assert.equal(bad.error?.code, "hetu.stale_evidence");
});
test("方向不同、选中引用及重复ID验证", () => {
  const { ref } = fixture(),
    p: any = newContinuity(ref);
  p.decisions = [decision];
  validate(p);
  p.decisions[0] = { ...decision, selected_option_id: "missing" };
  assert.throws(() => validate(p));
  p.decisions = [
    {
      ...decision,
      options: [
        decision.options[0],
        { ...decision.options[1], summary: decision.options[0].summary },
      ],
    },
  ];
  assert.throws(() => validate(p));
});
test("保存方向与事件、未知时间和状态锚定", async () => {
  const { c, ref } = fixture();
  let r = await create(c, ref);
  r = value(await c.invoke("put_decision", { ...base(r, "d"), decision }));
  const event = {
    id: "e",
    title: "来信",
    summary: "收到空白信",
    story_time: null,
    narrative_order: 1,
    participants: ["character_lin"],
    evidence: [],
  };
  r = value(await c.invoke("put_event", { ...base(r, "e"), event }));
  const state = {
    id: "s",
    entity_ref: "character_lin",
    event_id: "e",
    knowledge: "只知道信封来自旧港",
    condition: "尚未决定离开",
    evidence: [],
  };
  r = value(await c.invoke("put_state", { ...base(r, "s"), state }));
  assert.equal(
    value(
      await c.invoke("get_timeline", {
        object_id: r.object.object_id,
        order: "narrative",
      }),
    ).events[0].story_time,
    null,
  );
  const bad = await c.invoke("put_state", {
    ...base(r, "wrong"),
    state: { ...state, event_id: "missing" },
  });
  assert.equal(bad.status, "failed");
});
test("CAS与原键恢复、同键异输入拒绝", async () => {
  const { c, ref } = fixture();
  let r = await create(c, ref);
  const input = { ...base(r, "update"), decision };
  r = value(await c.invoke("put_decision", input));
  assert.equal(value(await c.invoke("put_decision", input)).sha256, r.sha256);
  assert.equal(
    (
      await c.invoke("put_decision", {
        ...input,
        decision: { ...decision, title: "换输入" },
      })
    ).error?.code,
    "idempotency_conflict",
  );
  assert.equal(
    (await c.invoke("put_decision", { ...input, operation_key: "stale" })).error
      ?.code,
    "revision_conflict",
  );
});
test("响应丢失后保留一次写入，unknown不继续写", async () => {
  const { c, ref } = fixture();
  const r = await create(c, ref),
    i = { ...base(r, "lost"), decision };
  c.failAfterWrite = true;
  assert.equal((await c.invoke("put_decision", i)).status, "failed");
  assert.equal(value(await c.invoke("put_decision", i)).object.revision, 2);
  assert.equal(c.writes, 2);
  c.unknown = true;
  assert.equal(
    (await c.invoke("put_decision", { ...base(r, "unknown"), decision })).error
      ?.code,
    "unknown",
  );
  assert.equal(c.writes, 2);
});
test("续写上下文固定旧计划，不静默超预算", async () => {
  const { c, ref } = fixture();
  let r = await create(c, ref);
  r = value(await c.invoke("put_decision", { ...base(r, "d"), decision }));
  const ctx = value(
    await c.invoke("build_continuation_context", {
      object_id: r.object.object_id,
      goal: "写下一章候选",
      max_chars: 12000,
    }),
  );
  assert.deepEqual(ctx.plan_ref, ref);
  assert.equal(ctx.token_count, null);
  assert.equal(
    (
      await c.invoke("build_continuation_context", {
        object_id: r.object.object_id,
        goal: "继续",
        max_chars: 100,
      })
    ).error?.code,
    "hetu.budget_exceeded",
  );
});
