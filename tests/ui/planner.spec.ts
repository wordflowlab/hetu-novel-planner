import {test,expect,_electron as electron} from "@playwright/test";
import {readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import {createRequire} from "node:module";
import {newPlan,newNode,newDetail} from "../../src/domain/model.ts";
import {start,host} from "../support/machine.ts";
import {importText} from "../support/import.ts";

test("NP完整工作面通过真实Electron、Core与机器入口共享成果", async ({}, info) => {
  const c=await start(),directory=c.directory,workspace=c.workspace,env=c.env,pkg={sha256:c.pkg.package_sha256};
  const fixture={work_ref:c.work,source_refs:await importText(c,["雨港旧邮局里，江岚收到一封没有署名的来信。\n"])};
  let serial=0;
  const invoke=(a:string,i:any)=>c.invoke(a,i);
  const fixed = (r: any) => ({
    object_id: r.object.object_id,
    revision: r.object.revision,
    sha256: r.sha256,
  });
  const base = (r: any) => ({
    object_id: r.object.object_id,
    expected_revision: r.object.revision,
    expected_sha256: r.sha256,
    operation_key: "ui-" + ++serial,
  });
  const p = newPlan("雨港来信", "book");
  p.nodes.push(
    newNode("volume", "第一卷 旧邮局", "volume"),
    newNode("chapter", "第一章 来信", "chapter"),
  );
  p.nodes.push(
    newNode("volume", "第二卷 潮汐档案", "volume-two"),
    newNode("volume", "第三卷 回声", "volume-three"),
  );
  p.nodes[0].children = ["volume", "volume-two", "volume-three"];
  p.nodes[1].subtitle = "雨水褪去，旧信浮现";
  p.nodes[1].planning_status = "planned";
  p.nodes[1].target_chapters = 36;
  p.nodes[1].target_words = 108000;
  p.nodes[1].children = ["chapter"];
  p.author_constraints = "保留开放结局，不改写已经定稿的正文。";
  let plan = await invoke("put_plan", {
    title: "雨港方案",
    content: p,
    source_refs: [],
    expected_revision: 0,
    expected_sha256: "",
    operation_key: "plan",
  });
  const story = await invoke("put_story_network", {
    title: "人物线索",
    content: {
      format_version: 1,
      plan_id: plan.object.object_id,
      entities: [
        {
          id: "person",
          type: "character",
          name: "江岚",
          summary: "寻找寄信人。",
          notes: "规划候选",
          archived: false,
          canonical_ref: null,
        },
        {
          id: "postoffice",
          type: "location",
          name: "旧邮局",
          summary: "被遗忘的来信保存处。",
          notes: "",
          archived: false,
          canonical_ref: null,
        },
      ],
      relations: [
        {
          id: "relation",
          from_id: "person",
          to_id: "postoffice",
          label: "调查",
          notes: "因来信进入邮局。",
          node_ids: ["chapter"],
          archived: false,
        },
      ],
      clues: [
        {
          id: "letter",
          title: "信封日期",
          description: "日期早于邮局开业。",
          status: "open",
          placements: [
            { node_id: "chapter", stage: "plant", notes: "首次出现" },
          ],
          notes: "尚未回收",
          archived: false,
        },
      ],
    },
    source_refs: [],
    expected_revision: 0,
    expected_sha256: "",
    operation_key: "story",
  });
  plan = await invoke("attach_object", {
    ...base(plan),
    role: "story",
    target: fixed(story),
  });
  const d = newDetail(plan.object.object_id, "volume");
  Object.assign(d, {
    summary: "旧邮局的来信让江岚回到雨港。",
    goal: "找到寄信人",
    theme: "记忆与证词",
    opening: "江岚在暴雨中收到一封旧信。",
    conflict: "证词与邮局档案互相矛盾。",
    start_state: "江岚相信收信地址已经废弃。",
    end_state: "他决定寻找仍在寄信的人。",
    turns: ["信封日期早于邮局开业。"],
    detailed_plot:
      "## 暴雨来信\n\n江岚在旧邮局逐封核对信件。\n\n" +
      "木桌上的水迹映出门外的人影。".repeat(150),
    entity_links: [{ entity_id: "person", role: "调查者", notes: "贯穿本卷" }],
    formal_documents: [
      {
        document_id: fixture.source_refs[0].document_id,
        revision_id: fixture.source_refs[0].revision_id,
        sha256: fixture.source_refs[0].sha256,
      },
    ],
  });
  const detail = await invoke("put_detail", {
    title: "第一卷完整规划",
    content: d,
    source_refs: fixture.source_refs,
    expected_revision: 0,
    expected_sha256: "",
    operation_key: "detail",
  });
  plan = await invoke("attach_object", {
    ...base(plan),
    role: "detail",
    node_id: "volume",
    target: fixed(detail),
  });
  let run = await invoke("put_run", {
    title: "本卷剧情整理",
    content: {
      format_version: 1,
      plan_ref: fixed(plan),
      target_node_ids: ["volume"],
      goal: "完善旧邮局的详细剧情",
      state: "prepared",
      steps: [
        {
          id: "read",
          title: "整理已有规划",
          status: "pending",
          message: "",
          operation_key: null,
          result_ref: null,
          evidence: { kind: "agent_report", locator: "" },
        },
        {
          id: "plot",
          title: "展开剧情节拍",
          status: "pending",
          message: "等待外部 Agent 接续。",
          operation_key: null,
          result_ref: null,
          evidence: { kind: "agent_report", locator: "" },
        },
      ],
      continuation: "保留来信悬念，继续完善剧情。",
    },
    source_refs: [],
    expected_revision: 0,
    expected_sha256: "",
    operation_key: "ui-run",
  });
  plan = await invoke("attach_object", {
    ...base(plan),
    role: "run",
    target: fixed(run),
  });
  run = await invoke("patch_run", { ...base(run), state: "handed_off" });
  run = await invoke("patch_run", {
    ...base(run),
    state: "running",
    steps: run.object.content.steps.map((step: any, i: number) =>
      i === 0
        ? {
            ...step,
            status: "succeeded",
            message: "已读取本卷固定规划与来源。",
            result_ref: fixed(detail),
            evidence: {
              kind: "agent_report",
              locator: detail.object.object_id,
            },
          }
        : step,
    ),
  });

  const app = await electron.launch({
    executablePath:
      process.env.HETU_PACKAGED_APP ??
      createRequire(path.join(host, "package.json"))("electron"),
    args: process.env.HETU_PACKAGED_APP
      ? []
      : [path.join(host, "apps/desktop")],
    env,
  });
  try {
    await app.evaluate(({ dialog, clipboard }, directory) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [directory],
      });
      dialog.showMessageBox = async () => ({
        response: 1,
        checkboxChecked: false,
      });
      let copied = "";
      clipboard.writeText = (value: string) => {
        copied = value;
      };
      clipboard.readText = () => copied;
    }, workspace);
    const shell = await app.firstWindow();
    await shell
      .getByRole("button", { name: "打开作品", exact: true })
      .first()
      .click();
    await shell.getByRole("button", { name: "雨港来信",exact:true }).click();
    app.context().on("page", (page) => {
      page.on("pageerror", (error) =>
        console.error("Plugin page error:", error.message),
      );
      page.on("console", (message) => {
        if (message.type() === "error")
          console.error("Plugin console:", message.text());
      });
    });
    await shell.getByRole("button", { name: "小说规划", exact: true }).click();
    await expect
      .poll(() =>
        app
          .context()
          .pages()
          .some((w) => w.url().startsWith("hetu-plugin:")),
      )
      .toBe(true);
    let view = app
      .context()
      .pages()
      .find((w) => w.url().startsWith("hetu-plugin:"))!;
    await expect(
      view.getByRole("heading", { name: "小说规划", exact: true }),
    ).toBeVisible();
    await expect(shell.locator(".workbench-topbar")).toHaveCount(0);
    await expect(shell.locator(".project-navigation")).toHaveCount(0);
    await expect(shell.locator(".toolbar")).toHaveCount(0);
    await expect(
      view.getByRole("button", { name: "返回工作台", exact: true }),
    ).toBeVisible();
    const area = await shell.locator(".surface").boundingBox();
    expect(area?.x).toBe(0);
    expect(area?.y).toBe(0);
    await expect(shell.locator(".plugin-page-navigation")).toHaveCount(0);
    expect(
      (await view.locator(".planner > header").boundingBox())!.height,
    ).toBeLessThanOrEqual(50);
    await expect
      .poll(() => view.evaluate(() => innerWidth))
      .toBe(Math.round(area!.width));
    await expect
      .poll(() => view.evaluate(() => innerHeight))
      .toBe(Math.round(area!.height));
    await view.screenshot({ path: info.outputPath("standalone-plugin.png") });
    await expect(
      view.getByRole("listbox", { name: "卷章", exact: true }),
    ).toBeVisible();
    await expect(view.getByRole("listbox").getByRole("option")).toHaveCount(3);
    await expect(
      view.getByRole("option", { name: /第一卷 旧邮局/ }),
    ).toHaveAttribute("aria-selected", "true");
    const geometry = await view.evaluate(() => {
      const box = (q: string) => {
        const r = document.querySelector(q)!.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      };
      return {
        header: box(".planner > header"),
        nav: box("nav"),
        tabs: box(".workspace-tabs"),
        toolbar: box(".planner-toolbar"),
        list: box("aside"),
        detail: box("main"),
        sections: document.querySelectorAll(".reading-section").length,
      };
    });
    expect(geometry.tabs.y).toBe(geometry.header.height);
    expect(geometry.tabs.x).toBe(geometry.nav.width);
    expect(geometry.toolbar.y).toBeGreaterThan(geometry.tabs.y);
    expect(geometry.list.y).toBeGreaterThan(geometry.toolbar.y);
    expect(geometry.list.x).toBeLessThan(geometry.detail.x);
    expect(geometry.sections).toBe(3);
    await expect(view.locator("#detailed-plot .inline-run")).toContainText(
      "完善旧邮局的详细剧情",
    );
    await view
      .getByRole("textbox", { name: "搜索卷章", exact: true })
      .fill("找到寄信人");
    await expect(view.getByRole("listbox").getByRole("option")).toHaveCount(1);
    await view
      .getByRole("textbox", { name: "搜索卷章", exact: true })
      .fill("没有这卷");
    await expect(
      view.getByText("没有符合条件的规划。", { exact: true }),
    ).toBeVisible();
    await view.getByRole("button", { name: "清除筛选", exact: true }).click();
    await expect(view.getByRole("listbox").getByRole("option")).toHaveCount(3);
    await view.getByRole("option", { name: /第一卷 旧邮局/ }).focus();
    await view.keyboard.press("ArrowDown");
    await expect(
      view.getByRole("option", { name: /第二卷 潮汐档案/ }),
    ).toHaveAttribute("aria-selected", "true");
    await view.keyboard.press("Home");
    await expect(
      view.getByRole("option", { name: /第一卷 旧邮局/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(view.getByText("找到寄信人", { exact: true })).toBeVisible();
    await expect(
      view.getByRole("heading", { name: "暴雨来信", exact: true }),
    ).toBeVisible();
    await view.getByRole("heading", { name: "小说规划", exact: true }).click();
    await view.screenshot({
      path: info.outputPath("plan-light.png"),
      scale: "css",
    });
    await view.setViewportSize({ width: 2560, height: 1279 });
    await expect.poll(() => view.evaluate(() => innerWidth)).toBe(2560);
    await view.screenshot({
      path: info.outputPath("plan-wide.png"),
      scale: "css",
    });
    await view.setViewportSize({ width: 1360, height: 900 });
    await expect.poll(() => view.evaluate(() => innerWidth)).toBe(1360);
    await view.getByRole("button", { name: "编辑", exact: true }).click();
    await view
      .getByRole("textbox", { name: "标题", exact: true })
      .fill("第一卷 潮声");
    await view
      .getByRole("textbox", { name: "目标", exact: true })
      .fill("核实来信来源");
    await view
      .getByRole("textbox", { name: "目标", exact: true })
      .dispatchEvent("compositionstart");
    await view.getByRole("button", { name: "保存规划", exact: true }).click();
    expect(
      (await invoke("get_plan", { object_id: plan.object.object_id })).sha256,
    ).toBe(plan.sha256);
    await view
      .getByRole("textbox", { name: "目标", exact: true })
      .dispatchEvent("compositionend");
    await view.getByRole("button", { name: "整书规划", exact: true }).click();
    await view.getByRole("treeitem", { name: /^雨港来信/ }).click();
    await expect(
      view.getByRole("heading", { name: "雨港来信", exact: true }),
    ).toBeVisible();
    await view.getByRole("button", { name: "卷规划", exact: true }).click();
    await view.getByRole("option", { name: /第一卷 旧邮局/ }).click();
    await expect(
      view.getByRole("textbox", { name: "目标", exact: true }),
    ).toHaveValue("核实来信来源");
    await view.evaluate(() => {
      (window as any).removeCloseBlock = window.hetu.onBeforeClose!(
        async () => {
          throw new Error("injected_buffer_failure");
        },
      );
    });
    await view.getByRole("button", { name: "返回工作台", exact: true }).click();
    await expect(shell.getByRole("status")).toContainText("恢复稿");
    await expect(
      view.getByRole("textbox", { name: "目标", exact: true }),
    ).toHaveValue("核实来信来源");
    await expect(shell.locator(".workbench-topbar")).toHaveCount(0);
    await view.evaluate(() => (window as any).removeCloseBlock());
    await view.getByRole("button", { name: "返回工作台", exact: true }).click();
    await expect(shell.locator(".workbench-topbar")).toBeVisible();
    await expect(shell.locator(".project-navigation")).toBeVisible();
    await expect(shell.locator(".reader-main")).toBeVisible();
    await shell.getByRole("button", { name: "小说规划", exact: true }).click();
    await expect
      .poll(() =>
        app
          .context()
          .pages()
          .some((w) => w.url().startsWith("hetu-plugin:")),
      )
      .toBe(true);
    view = app
      .context()
      .pages()
      .find((w) => w.url().startsWith("hetu-plugin:"))!;
    await expect(
      view.getByRole("textbox", { name: "目标", exact: true }),
    ).toHaveValue("核实来信来源");
    await view.getByRole("button", { name: "保存规划", exact: true }).click();
    await expect(
      view.getByRole("heading", { name: "第一卷 潮声", exact: true }),
    ).toBeVisible();
    await expect(view.getByText("核实来信来源", { exact: true })).toBeVisible();
    let latest = await invoke("get_plan", { object_id: plan.object.object_id });
    expect(latest.object.revision).toBe(plan.object.revision + 2);
    const fixedDetail = latest.object.content.nodes.find(
      (n: any) => n.id === "volume",
    ).detail_ref;
    expect(
      (
        await invoke("get_detail", {
          object_id: fixedDetail.object_id,
          revision: fixedDetail.revision,
        })
      ).object.content.goal,
    ).toBe("核实来信来源");
    await view.getByRole("button", { name: "编辑", exact: true }).click();
    await view
      .getByRole("textbox", { name: "目标", exact: true })
      .fill("本地选择：查清来信");
    const oldDetail = await invoke("get_detail", {
      object_id: fixedDetail.object_id,
      revision: fixedDetail.revision,
    });
    const remoteDetail = await invoke("put_detail", {
      ...base(oldDetail),
      title: oldDetail.object.title,
      content: {
        ...oldDetail.object.content,
        goal: "外部选择：追踪证人",
        theme: "保留远端新主题",
      },
      source_refs: oldDetail.object.source_refs,
    });
    latest = await invoke("attach_object", {
      ...base(latest),
      role: "detail",
      node_id: "volume",
      target: fixed(remoteDetail),
    });
    await view.getByRole("button", { name: "保存规划", exact: true }).click();
    await expect(
      view.getByRole("button", { name: "比较并重新准备", exact: true }),
    ).toBeVisible();
    await view
      .getByRole("button", { name: "比较并重新准备", exact: true })
      .click();
    await expect(view.getByRole("dialog")).toContainText("原操作尚未写入");
    await view
      .getByRole("dialog")
      .getByRole("button", { name: "使用当前版本重新准备", exact: true })
      .click();
    await expect(view.getByRole("dialog")).toContainText("选择冲突字段");
    await view
      .getByRole("combobox", { name: "选择字段版本 goal", exact: true })
      .selectOption("local");
    await view
      .getByRole("button", { name: "确认合并并继续编辑", exact: true })
      .click();
    await expect(
      view.getByRole("textbox", { name: "目标", exact: true }),
    ).toHaveValue("本地选择：查清来信");
    await expect(
      view.getByRole("textbox", { name: "主题", exact: true }),
    ).toHaveValue("保留远端新主题");
    await view.getByRole("button", { name: "保存规划", exact: true }).click();
    await expect(
      view.getByRole("textbox", { name: "目标", exact: true }),
    ).toHaveCount(0);
    await expect(
      view.getByText("本地选择：查清来信", { exact: true }),
    ).toBeVisible();
    latest = await invoke("get_plan", { object_id: plan.object.object_id });
    const exportPath = path.join(directory, "完整规划.md");
    await app.evaluate(({ dialog }, filename) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: filename,
      });
    }, exportPath);
    await view.getByRole("button", { name: "导出", exact: true }).click();
    await expect(view.getByRole("status")).toContainText("完整固定版本已导出");
    expect(await readFile(exportPath, "utf8")).toContain("本地选择：查清来信");
    await view.getByRole("tab", { name: "卷内角色", exact: true }).click();
    await view
      .getByRole("button", { name: "读取本卷关联", exact: true })
      .click();
    await expect(view.getByRole("dialog")).toContainText("江岚");
    await view.keyboard.press("Escape");
    await expect(view.getByRole("dialog")).toHaveCount(0);
    await view.getByRole("tab", { name: "正文接续", exact: true }).click();
    await view
      .getByRole("button", { name: "读取实际统计", exact: true })
      .click();
    await expect(view.locator(".statistics")).toContainText("1 章");
    await view
      .getByRole("button", { name: "让AI展开本卷", exact: true })
      .click();
    await expect(view.getByRole("status")).toContainText("已复制当前目标");
    const handoff = await app.evaluate(({ clipboard }) =>
      JSON.parse(clipboard.readText().split("\n").slice(1).join("\n")),
    );
    expect(handoff.node_id).toBe("volume");
    expect(handoff.fixed_refs[0].revision).toBe(latest.object.revision);
    expect(handoff.management_ref).toBeDefined();
    expect(
      await view.evaluate(() => JSON.stringify(window.hetu)),
    ).not.toContain(handoff.management_ref.grant_id);
    await view.getByRole("tab", { name: /卷概览/ }).click();
    await view
      .getByRole("button", { name: "前往详细剧情", exact: false })
      .click();
    await expect(view.locator("#detailed-plot .inline-run")).toBeInViewport();
    await view.locator("#detailed-plot .inline-run summary").click();
    await expect(
      view.getByText("等待外部 Agent 接续。", { exact: true }),
    ).toBeVisible();
    await view.screenshot({
      path: info.outputPath("plot-progress.png"),
      scale: "css",
    });
    await view.evaluate(() => scrollTo(0, 0));
    await view
      .getByRole("status")
      .getByRole("button", { name: "关闭", exact: true })
      .click();

    await app.evaluate(({ webContents }) => {
      webContents
        .getAllWebContents()
        .find((w: any) => w.getURL().startsWith("hetu-plugin:"))
        ?.send("plugin:preferences", { theme: "dark", language: "zh-CN" });
    });
    await expect(view.locator("html")).toHaveAttribute("data-theme", "dark");
    await view.screenshot({
      path: info.outputPath("plan-dark.png"),
      scale: "css",
    });
    await view.setViewportSize({ width: 760, height: 800 });
    await expect.poll(() => view.evaluate(() => innerWidth)).toBe(760);
    await expect
      .poll(() =>
        view.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await view.screenshot({
      path: info.outputPath("plan-narrow.png"),
      scale: "css",
    });
    await view.setViewportSize({ width: 1360, height: 900 });
    await expect.poll(() => view.evaluate(() => innerWidth)).toBe(1360);
    await view
      .getByRole("button", { name: "展开规划导航", exact: true })
      .click();
    await view.getByRole("button", { name: "关系图谱", exact: true }).click();
    await expect(view.getByRole("img", { name: "实体关系图" })).toBeVisible();
    await expect(view.getByRole("table")).toContainText("调查");
    await view.screenshot({
      path: info.outputPath("relationships-light.png"),
      fullPage: true,
    });
    await app.evaluate(({ webContents }) => {
      const view = webContents
        .getAllWebContents()
        .find((w: any) => w.getURL().startsWith("hetu-plugin:"));
      view?.send("plugin:preferences", { theme: "dark", language: "en" });
    });
    await expect(
      view.getByRole("heading", { name: "Novel Planner", exact: true }),
    ).toBeVisible();
    await expect(view.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(
      view.getByRole("button", { name: "Relationships", exact: true }),
    ).toBeVisible();
    await view.screenshot({
      path: info.outputPath("relationships-dark-en.png"),
      fullPage: true,
    });
    await view.setViewportSize({ width: 760, height: 800 });
    await expect.poll(() => view.evaluate(() => innerWidth)).toBe(760);
    await expect
      .poll(() =>
        view.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
    await view.screenshot({
      path: info.outputPath("narrow-dark-en.png"),
      fullPage: true,
    });
    await view.setViewportSize({ width: 1360, height: 900 });
    await expect.poll(() => view.evaluate(() => innerWidth)).toBe(1360);
    call("hetu.plugins.apply", {
      action: "disable",
      plugin_id: pkg.manifest.id,
      package_sha256: pkg.sha256,
      expected_sha256: call("hetu.plugins.inspect", {}).state_sha256,
      authorization_note: "明确停用隔离测试插件。",
      operation_key: "disable",
    });
    await expect(shell.locator(".workbench-topbar")).toBeVisible();
    await expect(shell.locator(".plugin-page-navigation")).toHaveCount(0);
    await expect(shell.getByRole("status")).toContainText("插件状态已更新");
    await expect
      .poll(() =>
        app
          .context()
          .pages()
          .some((w) => w.url().startsWith("hetu-plugin:")),
      )
      .toBe(false);
    await writeFile(
      info.outputPath("acceptance.json"),
      JSON.stringify(
        {
          platform: process.platform,
          package_sha256: pkg.sha256,
          plan_ref: fixed(latest),
          checks: [
            "real_electron",
            "standalone_full_width",
            "volume_list_layout",
            "fixed_goal_search",
            "empty_filter",
            "list_keyboard",
            "plot_work_records",
            "trusted_back",
            "failed_flush_keeps_view",
            "return_restores_layout",
            "hot_disable_restores_layout",
            "machine_gui_same_revision",
            "save_meta_detail_attach",
            "ime_no_submission",
            "switch_preserves_draft",
            "close_reopen_recovery",
            "three_way_cas_merge",
            "native_fixed_export",
            "modal_escape",
            "scope_links",
            "actual_statistics",
            "trusted_handoff",
            "relationship_table",
            "light_dark",
            "zh_en",
            "narrow",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await c.client.close();
    await app.close();
  }
});
