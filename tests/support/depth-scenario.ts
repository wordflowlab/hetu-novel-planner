import assert from "node:assert/strict";
import { newContinuity } from "../../src/continuity/model.ts";
import { newDepth } from "../../src/continuity/depth.ts";
export function fixtureContent(plan_ref: any, ev: any) {
  const p: any = newContinuity(plan_ref, "雨港时序深化");
  p.events = [1, 2, 3].map((n) => ({
    id: "e" + n,
    title: ["收到旧信", "追查渡口", "忘却暗号"][n - 1],
    summary: "固定来源及专业解释",
    story_time: n === 2 ? "翌日" : null,
    narrative_order: n === 1 ? 3 : n - 1,
    participants: ["lin"],
    evidence: [ev],
  }));
  const basis = (n: number) => ({
    id: "b" + n,
    event_id: "e" + n,
    basis: "observed",
    layer: "reality",
    branch: "main",
    depends_on_event_ids: n === 1 ? [] : ["e" + (n - 1)],
    source_indices: [0],
    review_status: "checked",
  });
  const constraint = (n: number) => ({
    id: "t" + n,
    from: "e" + n,
    to: "e" + (n + 1),
    relation: "before",
    gap: { min: 1, max: 2, unit: "day" },
    evidence: [ev],
  });
  p.depth = {
    ...newDepth(),
    event_basis: [basis(1), basis(2), basis(3)],
    constraints: [constraint(1), constraint(2)],
    knowledge: [
      {
        id: "learn",
        entity_ref: "lin",
        event_id: "e1",
        proposition: "暗号",
        change: "learn",
        evidence: [ev],
      },
      {
        id: "forget",
        entity_ref: "lin",
        event_id: "e3",
        proposition: "暗号",
        change: "forget",
        evidence: [ev],
      },
    ],
    coverage: [{ source_index: 0, status: "read", note: "已读固定范围" }],
  };
  return p;
}
export async function runDepthScenario(
  c: any,
  refs: any[],
  ev: any,
  plan_ref: any,
) {
  let r = await c.invoke("save_continuity", {
      content: fixtureContent(plan_ref, ev),
      source_refs: refs,
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "depth-create",
    }),
    serial = 0;
  const write = async (a: string, i: any) =>
    (r = await c.invoke(a, {
      object_id: r.object.object_id,
      expected_revision: r.object.revision,
      expected_sha256: r.sha256,
      operation_key: "depth-" + ++serial,
      ...i,
    }));
  const read = (a: string, i: any = {}) =>
    c.invoke(a, {
      object_id: r.object.object_id,
      revision: r.object.revision,
      ...i,
    });
  await write("save_depth", { depth: r.object.content.depth });
  await write("put_event_basis", {
    event_basis: r.object.content.depth.event_basis[0],
  });
  await write("put_temporal_constraint", {
    constraint: r.object.content.depth.constraints[0],
  });
  await write("put_knowledge_transition", {
    transition: r.object.content.depth.knowledge[0],
  });
  const time = await read("preview_temporal_constraints");
  assert.deepEqual(time.levels, [[["e1"]], [["e2"]], [["e3"]]]);
  assert.equal(time.conflicts.length, 0);
  assert.equal(
    (await read("preview_knowledge", { entity_ref: "lin", event_id: "e2" }))
      .states[0].state,
    "known",
  );
  assert.equal(
    (await read("preview_knowledge", { entity_ref: "lin", event_id: "e3" }))
      .states[0].state,
    "forgotten",
  );
  assert.equal(
    (await read("preview_continuity_impact", { changed_source_indices: [0] }))
      .events.length,
    3,
  );
  assert.equal(
    (await c.invoke("get_operation", { operation_key: "depth-" + serial }))
      .sha256,
    r.sha256,
  );
  const previous = {
    owner_plugin_id: "org.wordflowlab.novel-planner",
    object_id: r.object.object_id,
    revision: r.object.revision,
    sha256: r.sha256,
  };
  await write("save_depth", {
    depth: { ...r.object.content.depth, basis_refs: [previous] },
  });
  const basis = await read("inspect_basis", { basis_index: 0 });
  assert.equal(basis.record.sha256, previous.sha256);
  return r;
}
