import assert from "node:assert/strict";
import { test } from "node:test";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { start } from "./support/machine.ts";
import { importText } from "./support/import.ts";
import { candidate } from "./support/creative.ts";
import { newPlan, newNode } from "../src/domain/model.ts";
import { fixtureContent as continuityContent } from "./support/depth-scenario.ts";
const fixed = (r: any, slug: string) => ({
  owner_plugin_id: "org.wordflowlab." + slug,
  object_id: r.object.object_id,
  revision: r.object.revision,
  sha256: r.sha256,
});
test(
  "整书复盘到下一章：四插件固定依据、局部返工、审校、图鉴与换连接",
  { timeout: 1800000 },
  async (t) => {
    const c = await start(),
      root = path.resolve(process.env.HETU_DEPTH_ROOT ?? ".."),
      clients = new Map<string, any>(),
      stages: string[] = [],
      snapshots: any[] = [];
    let n = 0;
    const base = (r: any) => ({
      object_id: r.object.object_id,
      expected_revision: r.object.revision,
      expected_sha256: r.sha256,
      operation_key: "cross-" + ++n,
    });
    try {
      for (const slug of [
        "novel-planner",
        "prose-studio",
        "novel-review",
        "novel-atlas",
      ]) {
        let pkg = c.pkg;
        if (slug !== "novel-planner") {
          const directory = path.join(c.directory, "peers", slug);
          await cp(
            path.join(root, "hetu-" + slug + "-depth", "dist"),
            directory,
            { recursive: true },
          );
          pkg = await c.ok("hetu_plugins_inspect_package", {
            package_directory: directory,
          });
          await c.ok("hetu_plugins_apply", {
            action: "install",
            plugin_id: "org.wordflowlab." + slug,
            package_directory: directory,
            package_sha256: pkg.package_sha256,
            expected_sha256: (await c.ok("hetu_plugins_inspect")).state_sha256,
            authorization_note: "四插件完整接续验收，仅操作本次隔离小说",
            operation_key: "cross-install-" + slug,
          });
        }
        const binding = {
            management_ref: c.management,
            work_ref: c.work,
            plugin_id: "org.wordflowlab." + slug,
            package_sha256: pkg.package_sha256,
          },
          cap = await c.ok("hetu_plugins_capabilities", binding);
        const raw = (action: string, input: any = {}) =>
          c.call("hetu_plugins_invoke", {
            ...binding,
            capabilities_sha256: cap.capabilities_sha256,
            action,
            arguments: input,
          });
        const invoke = async (action: string, input: any = {}) => {
          let outer = await raw(action, input);
          if (
            outer.status !== "succeeded" &&
            input.operation_key &&
            ["hetu.plugin_operation_failed", "hetu.outcome_unknown"].includes(
              outer.error?.code,
            )
          ) {
            const recovery = await raw("hetu.extensions.operations.get", {
              operation_key: input.operation_key,
            });
            assert.equal(
              recovery.status,
              "succeeded",
              JSON.stringify(recovery),
            );
            if (recovery.data.result.status === "succeeded") outer = recovery;
            else if (recovery.data.result.error?.code === "not_found")
              outer = await raw(action, input);
            else assert.fail(JSON.stringify(recovery));
          }
          assert.equal(outer.status, "succeeded", JSON.stringify(outer));
          assert.equal(
            outer.data.result.status,
            "succeeded",
            JSON.stringify(outer.data.result),
          );
          return outer.data.result.data;
        };
        const fixture =
          slug === "novel-planner"
            ? null
            : await import(
                pathToFileURL(
                  path.join(
                    root,
                    "hetu-" + slug + "-depth/tests/support/depth-scenario.ts",
                  ),
                ).href
              );
        clients.set(slug, { invoke, raw, binding, cap, fixture, pkg });
        const skill = await invoke("skills.read", {
          skill_id: slug,
          resource: "references/depth.md",
        });
        assert.ok(skill.content.includes("固定"));
      }
      const originals = [
          "第1章 来信\n雨港。林溪在旧邮局等待。\n",
          "第2章 渡口\n雨港。陈舟仍不知道暗号。\n",
        ],
        refs = await importText(c, originals),
        before = await c.ok("hetu_get_novel", { management_ref: c.management });
      const ev = {
        source_index: 0,
        byte_start: Buffer.from(originals[0]).indexOf(Buffer.from("雨港。")),
        byte_end: Buffer.from(originals[0]).indexOf(Buffer.from("雨港。")) + 9,
        quote: "雨港。",
      };
      const planner = clients.get("novel-planner"),
        prose = clients.get("prose-studio"),
        review = clients.get("novel-review"),
        atlas = clients.get("novel-atlas");
      const plan = newPlan("雨港整书复盘与未来", "book");
      plan.nodes.push(
        newNode("volume", "第一卷", "volume-a"),
        newNode("chapter", "第三章 把信送还", "chapter-a"),
      );
      plan.nodes[0].children = ["volume-a"];
      plan.nodes.find((x: any) => x.id === "volume-a")!.children = [
        "chapter-a",
      ];
      const pr = await planner.invoke("put_plan", {
        title: "雨港整书复盘与未来",
        content: plan,
        source_refs: refs,
        expected_revision: 0,
        expected_sha256: "",
        operation_key: "cross-plan",
      });
      const continuity = continuityContent(
        {
          object_id: pr.object.object_id,
          revision: pr.object.revision,
          sha256: pr.sha256,
        },
        ev,
      );
      continuity.depth.coverage.push({
        source_index: 1,
        status: "read",
        note: "第二章实际已读",
      });
      let cr = await planner.invoke("save_continuity", {
        content: continuity,
        source_refs: refs,
        expected_revision: 0,
        expected_sha256: "",
        operation_key: "cross-continuity",
      });
      stages.push("已导入两章的固定复盘与整书卷章规划");
      assert.equal(
        (
          await planner.invoke("preview_temporal_constraints", {
            object_id: cr.object.object_id,
          })
        ).conflicts.length,
        0,
      );
      const pp = prose.fixture.fixtureContent(ev);
      pp.depth.basis_refs = [fixed(cr, "novel-planner")];
      let ps = await prose.invoke("save_project", {
        content: pp,
        source_refs: refs,
        expected_revision: 0,
        expected_sha256: "",
        operation_key: "cross-prose",
      });
      assert.equal(
        (
          await prose.invoke("inspect_basis", {
            object_id: ps.object.object_id,
            basis_index: 0,
          })
        ).record.sha256,
        cr.sha256,
      );
      const ctx = await prose.invoke("compile_context", {
        object_id: ps.object.object_id,
        target: prose.fixture.target,
        goal: "第三章只写林溪送信动作，保留停顿",
        max_chars: 12000,
        source_indices: [0, 1],
      });
      assert.equal(ctx.complete, true);
      stages.push("确切人物与章节作用域的有界上下文");
      const draft1 = await candidate(
        c,
        "第3章 归还\n林溪把信放在桌上。她很害怕。\n",
        "cross-first",
      );
      refs.push(draft1.source_ref);
      const draftText = "第3章 归还\n林溪把信放在桌上。她很害怕。\n",
        start = Buffer.from(draftText).indexOf(Buffer.from("她很害怕。"));
      ps = await prose.invoke("save_project", {
        ...base(ps),
        source_refs: refs,
        content: ps.object.content,
      });
      const revised = await prose.invoke("preview_refinement", {
        object_id: ps.object.object_id,
        source_index: 2,
        replacements: [
          {
            byte_start: start,
            byte_end: start + Buffer.byteLength("她很害怕。"),
            replacement: "指尖离开信封，又轻轻按了回去。",
          },
        ],
      });
      const oldCandidate = draft1.result.submission.candidates[0];
      const feedback = await c.ok("hetu_save_task_feedback", {
        task_ref: draft1.task.task_ref,
        target_refs: [
          {
            kind: "candidate",
            candidate_ref: {
              task_ref: draft1.task.task_ref,
              submission_id: draft1.result.submission.submission_id,
              candidate_id: oldCandidate.candidate_id,
            },
          },
        ],
        expected_feedback_head: null,
        intent: "request_changes",
        public_comment:
          "隔离验收意见：让动作承载害怕，不直接解释；只改确切选区。",
        selected_refs: [],
        operation_key: "cross-feedback",
      });
      const resubmitted = await c.ok("hetu_submit_creative_result", {
        task_ref: draft1.task.task_ref,
        request_sha256: draft1.task.request_sha256,
        candidates: [
          {
            kind: "text",
            title: "按固定意见局部返工",
            source_format: "markdown",
            source_ref_indices: [],
            content: revised.content,
          },
        ],
        complete: true,
        missing_items: [],
        provenance: { client: "codex", skill_version: "depth-1" },
        feedback_refs: [feedback.feedback_ref],
        operation_key: "cross-revised-submission",
      });
      const draftRecord = await c.ok("hetu_managed_drafts_get", {
        management_ref: c.management,
        draft_id: resubmitted.submission.candidates[0].draft_ref.draft_id,
      });
      const draft2 = {
        source_ref: {
          kind: "document",
          work_ref: c.work,
          document_id: draftRecord.draft.evidence_document_id,
          revision_id: draftRecord.draft.evidence_revision_id,
          sha256: revised.content_sha256,
        },
      };
      refs.push(draft2.source_ref);
      stages.push("固定宿主候选与指定选区返工，范围外字节保持");
      ps = await prose.invoke("save_project", {
        ...base(ps),
        source_refs: refs,
        content: ps.object.content,
      });
      ps = await prose.invoke("put_learning_sample", {
        ...base(ps),
        sample: {
          id: "author-edit",
          before: {
            source_index: 2,
            byte_start: start,
            byte_end: start + Buffer.byteLength("她很害怕。"),
            quote: "她很害怕。",
          },
          after: {
            source_index: 3,
            byte_start: start,
            byte_end:
              start + Buffer.byteLength("指尖离开信封，又轻轻按了回去。"),
            quote: "指尖离开信封，又轻轻按了回去。",
          },
          feedback: "让动作承载害怕，不直接解释",
          usage: "reusable",
        },
      });
      stages.push("从明确修改与意见保留学习样本");
      const rp = review.fixture.fixtureContent(ev);
      rp.scope_indices = [0, 1, 2, 3];
      rp.depth.basis_refs = [
        fixed(ps, "prose-studio"),
        fixed(cr, "novel-planner"),
      ];
      let rr = await review.invoke("save_project", {
        content: rp,
        source_refs: refs,
        expected_revision: 0,
        expected_sha256: "",
        operation_key: "cross-review",
      });
      const oldRun = {
        id: "old",
        source_indices: [2],
        state_event_ids: [],
        ruleset: {
          ...review.fixture.ruleset(),
          dictionary: [
            {
              id: "direct",
              term: "她很害怕",
              replacement: "有据动作表达",
              source: "本次作者明确反馈",
              exceptions: [],
            },
          ],
        },
      };
      rr = await review.invoke("put_rule_run", { ...base(rr), run: oldRun });
      const checked = await review.invoke("preview_recheck", {
        object_id: rr.object.object_id,
        old_run_id: "old",
        run: { ...oldRun, id: "new", source_indices: [3] },
      });
      assert.equal(checked.findings[0].status, "not_reproduced");
      assert.equal(checked.issues_unchanged, true);
      stages.push("新候选逐项审校复核，作者问题不自动解决");
      const ap = atlas.fixture.fixtureContent(ev);
      ap.depth.basis_refs = [
        fixed(cr, "novel-planner"),
        fixed(rr, "novel-review"),
      ];
      ap.depth.extractions = [
        {
          id: "read",
          extractor_version: "codex-review-1",
          blocks: refs.map((_: any, index: number) => ({
            id: "source-" + index,
            source_index: index,
            status: index < 2 ? "completed" : "unread",
            error: "",
            result_ids: index === 0 ? ["lin", "e1"] : [],
          })),
          ambiguities: ["候选尚未采纳，不转为已发生事实"],
        },
      ];
      const ar = await atlas.invoke("save_project", {
        content: ap,
        source_refs: refs,
        expected_revision: 0,
        expected_sha256: "",
        operation_key: "cross-atlas",
      });
      const projected = await atlas.invoke("get_projection_bundle", {
        object_id: ar.object.object_id,
      });
      assert.equal(projected.extractions[0].completed, 2);
      assert.equal(projected.routes[0].distance, null);
      stages.push("同源地图、变化、流转与真实阅读覆盖");
      const oldCr = cr;
      cr = await planner.invoke("put_event", {
        ...base(cr),
        event: {
          ...cr.object.content.events[0],
          title: "原文新解释，待作者复核",
        },
      });
      assert.equal(
        (
          await prose.invoke("inspect_basis", {
            object_id: ps.object.object_id,
            basis_index: 0,
          })
        ).record.sha256,
        oldCr.sha256,
      );
      const impact = await planner.invoke("preview_continuity_impact", {
        object_id: cr.object.object_id,
        changed_source_indices: [0],
      });
      assert.ok(impact.events.length > 0);
      assert.equal(impact.unchanged_continuity, true);
      stages.push("上游产生新修订，旧下游依据保持，影响单独复核");
      const resumed = c.cli("hetu.plugins.invoke", {
        ...planner.binding,
        capabilities_sha256: planner.cap.capabilities_sha256,
        action: "build_continuation_context",
        arguments: {
          object_id: cr.object.object_id,
          goal: "换连接后准备第四章，先检查既有稿与待复核项",
          max_chars: 20000,
        },
      });
      assert.equal(resumed.data.result.status, "succeeded");
      assert.ok(resumed.data.result.data.depth);
      stages.push("独立CLI进程接续下一章，正文仍为宿主候选");
      const after = await c.ok("hetu_get_novel", {
        management_ref: c.management,
      });
      assert.equal(after.sha256, before.sha256);
      for (const [slug, r] of [
        ["novel-planner", cr],
        ["prose-studio", ps],
        ["novel-review", rr],
        ["novel-atlas", ar],
      ] as const)
        snapshots.push({
          slug,
          ref: fixed(r, slug),
          package_sha256: clients.get(slug).pkg.package_sha256,
        });
      await mkdir("docs/research", { recursive: true });
      await writeFile(
        "docs/research/cross-depth-acceptance.json",
        JSON.stringify(
          {
            recorded_at: new Date().toISOString(),
            platform: process.platform + " " + process.arch,
            host_version: "0.11.11",
            source_build: false,
            stages,
            snapshots,
            original_sha256: before.sha256,
            final_sha256: after.sha256,
            adopted: false,
            finalized: false,
            limits: [
              "本轮候选为固定验收样稿，非文学质量评价",
              "不包含付费模型、正文采纳和定稿",
            ],
          },
          null,
          2,
        ) + "\n",
      );
      t.diagnostic(c.directory);
    } finally {
      await c.client.close();
    }
  },
);
