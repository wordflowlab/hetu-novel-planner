import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonical } from "../vendor/project-store.ts";
import { memoryCore, hash } from "./support/continuity-memory.ts";
import { fixtureContent, runDepthScenario } from "./support/depth-scenario.ts";
import { newPlan } from "../src/domain/model.ts";
import { newContinuity, validate } from "../src/continuity/model.ts";
import { temporal, knowledge, impact } from "../src/continuity/depth.ts";
const ref = { object_id: "ext_plan", revision: 1, sha256: "a".repeat(64) },
  ev = { source_index: 0, byte_start: 0, byte_end: 9, quote: "雨港。" },
  p = () => fixtureContent(ref, ev);
test("NPD-01 narrative and story partial order differ; labels not parsed", () => {
  const a = p();
  validate(a);
  const t = temporal(a);
  assert.deepEqual(t.levels[0], [["e1"]]);
  assert.equal(a.events[0].narrative_order, 3);
  assert.equal(t.unknown_time_event_ids.includes("e1"), true);
});
test("NPD-02 incomparable events and units remain explicit", () => {
  const a = p();
  a.depth.constraints = [];
  const t = temporal(a);
  assert.equal(t.levels[0].length, 3);
  assert.equal(t.intervals.length, 0);
  a.depth.constraints = p().depth.constraints;
  a.depth.constraints[1].gap.unit = "fictional_watch";
  assert.equal(temporal(a).intervals.length, 2);
});
test("NPD-03 cycles return exact constraints instead of a fabricated total order", () => {
  const a = p();
  a.depth.constraints.push({
    id: "cycle",
    from: "e3",
    to: "e1",
    relation: "before",
    gap: null,
    evidence: [ev],
  });
  const t = temporal(a);
  assert.ok(
    t.conflicts
      .find((c) => c.kind === "cycle")
      .constraint_ids.includes("cycle"),
  );
  assert.equal(t.levels.length, 0);
});
test("NPD-03 bounded gaps detect impossible transitive timing", () => {
  const a = p();
  a.depth.constraints.push({
    id: "long",
    from: "e1",
    to: "e3",
    relation: "before",
    gap: { min: 5, max: 6, unit: "day" },
    evidence: [ev],
  });
  assert.ok(temporal(a).conflicts.find((c) => c.kind === "interval"));
});
test("NPD-04 knowledge uses explicit history; belief and forgetting stay distinct", () => {
  const a = p();
  assert.equal(knowledge(a, "lin", "e2").states[0].state, "known");
  assert.equal(knowledge(a, "lin", "e3").states[0].state, "forgotten");
  a.depth.knowledge[0].change = "believe";
  assert.equal(knowledge(a, "lin", "e2").states[0].state, "belief");
});
test("NPD-04 unordered knowledge is uncertain instead of narrative last-wins", () => {
  const a = p();
  a.depth.constraints = [];
  const out = knowledge(a, "lin", "e2");
  assert.equal(out.states.length, 0);
  assert.equal(out.uncertain.length, 1);
});
test("NPD-05 future basis is separate and dream constraint crossing fails", () => {
  const a = p();
  a.depth.event_basis[2].basis = "planned";
  assert.equal(knowledge(a, "lin", "e3").states[0].state, "known");
  a.depth.event_basis[2].layer = "dream";
  assert.throws(() => validate(a));
});
test("NPD-06 observed events cannot cite unread source", () => {
  const a = p();
  a.depth.coverage[0].status = "unread";
  assert.throws(() => validate(a));
});
test("NPD-07 direct and transitive impacts preserve original", () => {
  const a = p();
  a.events[1].evidence = [];
  a.depth.event_basis[1].source_indices = [];
  a.events[2].evidence = [];
  a.depth.event_basis[2].source_indices = [];
  const before = canonical(a),
    r = impact(a, [0]);
  assert.equal(r.events.length, 3);
  assert.match(r.events.find((e) => e.event_id === "e3")!.reasons[0], /依赖/);
  assert.equal(canonical(a), before);
});
test("NPD-08 invalid entity/event and cross-branch references fail closed", () => {
  const a = p();
  a.depth.knowledge[0].event_id = "missing";
  assert.throws(() => validate(a));
});
test("NPD-09 explicit simultaneous events form a group", () => {
  const a = p();
  a.depth.constraints = [
    { ...a.depth.constraints[0], relation: "simultaneous", gap: null },
  ];
  const t = temporal(a);
  assert.equal(
    t.levels[0].some((g) => g.length === 2),
    true,
  );
});
test("NPD-10 old v1 remains unchanged; new workflow uses same CAS store", async () => {
  const old = newContinuity(ref);
  validate(old);
  assert.equal("depth" in old, false);
  const c = memoryCore(),
    text = "雨港。\n",
    object = {
      object_id: "ext_plan",
      owner_plugin_id: "org.wordflowlab.novel-planner",
      kind: "novel_plan",
      revision: 1,
      content: newPlan("雨港", "book"),
    },
    plan = { object, sha256: hash(object) };
  c.records.set(object.object_id, [plan]);
  const source = {
    kind: "document",
    work_ref: c.work,
    document_id: "document_d",
    revision_id: "revision_d",
    sha256: createHash("sha256").update(text).digest("hex"),
  };
  c.sources.set(canonical(source), { source_ref: source, content: text });
  await runDepthScenario(
    {
      invoke: async (a: string, i: any) => {
        const r = await c.invoke(a, i);
        assert.equal(r.status, "succeeded", JSON.stringify(r));
        return r.data;
      },
    },
    [source],
    ev,
    { ...ref, sha256: plan.sha256 },
  );
});
