import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFile, mkdir } from "node:fs/promises";
import { start } from "./support/machine.ts";
import { importText } from "./support/import.ts";
import { candidate } from "./support/creative.ts";
import { newPlan } from "../src/domain/model.ts";
import { newContinuity, ids } from "../src/continuity/model.ts";
let n = 0;
const base = (r: any) => ({
  object_id: r.object.object_id,
  expected_revision: r.object.revision,
  expected_sha256: r.sha256,
  operation_key: "continuity-" + ++n,
});
test(
  "剧情方向→双时间线→人物知情→固定上下文→宿主续写候选",
  { timeout: 600000 },
  async (t) => {
    const c = await start();
    t.diagnostic(c.directory);
    try {
      for (const resource of [
        undefined,
        "references/operations.md",
        "references/continuity-v2.md",
      ])
        await c.invoke("skills.read", {
          skill_id: "novel-planner",
          ...(resource ? { resource } : {}),
        });
      const text = "第1章 来信\n林溪收到一封没有署名的旧信。\n",
        refs = await importText(c, [text]);
      const plan = await c.invoke("put_plan", {
          title: "雨港整书规划",
          content: newPlan("雨港来信", "book"),
          source_refs: refs,
          expected_revision: 0,
          expected_sha256: "",
          operation_key: "plan",
        }),
        plan_ref = {
          object_id: plan.object.object_id,
          revision: plan.object.revision,
          sha256: plan.sha256,
        };
      let r = await c.invoke("save_continuity", {
        content: newContinuity(plan_ref, "雨港第二章接续"),
        source_refs: refs,
        expected_revision: 0,
        expected_sha256: "",
        operation_key: "continuity",
      });
      r = await c.invoke("put_decision", {
        ...base(r),
        decision: {
          id: "next",
          title: "下一封信的方向",
          question: "先查来信还是先守邮局",
          options: [
            {
              id: "a",
              summary: "追查寄件人",
              costs: ["暴露调查"],
              promises: ["外部线索"],
              consequences: ["前往渡口"],
            },
            {
              id: "b",
              summary: "先守住邮局",
              costs: ["寄件人延后"],
              promises: ["人物信任"],
              consequences: ["内部冲突"],
            },
          ],
          selected_option_id: "a",
        },
      });
      const b = Buffer.from(text),
        start = b.indexOf(Buffer.from("林溪")),
        evidence = [
          {
            source_index: 0,
            byte_start: start,
            byte_end: start + 6,
            quote: "林溪",
          },
        ];
      r = await c.invoke("put_event", {
        ...base(r),
        event: {
          id: "letter",
          title: "收到来信",
          summary: "第一章已写事实",
          story_time: null,
          narrative_order: 1,
          participants: ["character_lin"],
          evidence,
        },
      });
      r = await c.invoke("put_state", {
        ...base(r),
        state: {
          id: "lin",
          entity_ref: "character_lin",
          event_id: "letter",
          knowledge: "只知道信来自旧港，不知道寄件人身份",
          condition: "决定去渡口调查",
          evidence,
        },
      });
      for (const order of ["narrative", "story"])
        assert.equal(
          (
            await c.invoke("get_timeline", {
              object_id: r.object.object_id,
              order,
            })
          ).events[0].story_time,
          null,
        );
      const ctx = await c.invoke("build_continuation_context", {
        object_id: r.object.object_id,
        goal: "第二章沿追查寄件人方向续写",
        max_chars: 12000,
      });
      assert.equal(ctx.decisions[0].selected_option_id, "a");
      const generated = await candidate(
        c,
        "第2章 渡口\n天未亮，林溪把旧信收进内袋，独自走向渡口。她仍不知道是谁留下那行字，只能从信封上模糊的戳记查起。",
        "continuation",
      );
      assert.ok(generated.draft.draft.evidence_document_id);
      assert.equal((await c.invoke("list_continuities", {})).objects.length, 1);
      assert.equal(
        (
          await c.invoke("get_continuity", {
            object_id: r.object.object_id,
            revision: r.object.revision,
          })
        ).sha256,
        r.sha256,
      );
      const cli = c.cli("hetu.plugins.invoke", {
        ...c.binding,
        capabilities_sha256: c.cap.capabilities_sha256,
        action: "get_continuity",
        arguments: { object_id: r.object.object_id },
      });
      assert.equal(cli.data.result.data.sha256, r.sha256);
      await c.apply("disable");
      await c.apply("enable");
      await c.discover();
      assert.equal(
        (await c.invoke("get_continuity", { object_id: r.object.object_id }))
          .sha256,
        r.sha256,
      );
      await c.apply("uninstall");
      await c.apply("install");
      await c.discover();
      assert.equal(
        (await c.invoke("get_continuity", { object_id: r.object.object_id }))
          .sha256,
        r.sha256,
      );
      assert.deepEqual(
        [...ids].filter((id) => !c.actions.has(id)),
        [],
      );
      await mkdir("docs/research", { recursive: true });
      await writeFile(
        "docs/research/continuity-v2-acceptance.json",
        JSON.stringify(
          {
            platform: process.platform + " " + process.arch,
            package_sha256: c.pkg.package_sha256,
            actions: [...c.actions],
            candidate_source: true,
            cli_mcp: true,
            hotplug: true,
            uninstall_reinstall: true,
            windows: false,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      await c.client.close();
    }
  },
);
