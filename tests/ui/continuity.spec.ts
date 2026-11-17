import { _electron as electron, expect, test } from "@playwright/test";

import { createRequire } from "node:module";
import path from "node:path";

import { newPlan } from "../../src/domain/model.ts";
import { newContinuity } from "../../src/continuity/model.ts";
import { importText } from "../support/import.ts";
import { host, start } from "../support/machine.ts";
test("真实Electron专业工作面、AI交接、固定导出、冲突与重开", async ({}, info) => {
  const c = await start();
  let app: any;
  try {
    const text = "林溪收到一封旧信。\n",
      refs = await importText(c, [text]);
    const plan = await c.invoke("put_plan", {
      title: "雨港整书规划",
      content: newPlan("雨港来信", "book"),
      source_refs: refs,
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "plan",
    });
    const p: any = newContinuity(
      {
        object_id: plan.object.object_id,
        revision: plan.object.revision,
        sha256: plan.sha256,
      },
      "雨港第二章接续",
    );
    p.decisions = [
      {
        id: "next",
        title: "下一封信的方向",
        question: "先查寄件人还是守住邮局",
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
            summary: "守住邮局",
            costs: ["线索延后"],
            promises: ["人物信任"],
            consequences: ["内部冲突"],
          },
        ],
        selected_option_id: "a",
      },
    ];
    const evidence = [
      { source_index: 0, byte_start: 0, byte_end: 6, quote: "林溪" },
    ];
    p.events = [
      {
        id: "letter",
        title: "收到来信",
        summary: "第一章已写事实",
        story_time: null,
        narrative_order: 1,
        participants: ["character_lin"],
        evidence,
      },
    ];
    p.states = [
      {
        id: "lin",
        entity_ref: "character_lin",
        event_id: "letter",
        knowledge: "不知道寄件人身份",
        condition: "准备去渡口",
        evidence,
      },
    ];
    const record = await c.invoke("save_continuity", {
      content: p,
      source_refs: refs,
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "ui-continuity",
    });
    app = await electron.launch({
      executablePath:
        process.env.HETU_PACKAGED_APP ??
        createRequire(path.join(host, "package.json"))("electron"),
      args: process.env.HETU_PACKAGED_APP
        ? []
        : [path.join(host, "apps/desktop")],
      env: c.env,
    });
    const exportPath = path.join(c.directory, "连续性.md");
    await app.evaluate(
      ({ dialog }: any, { workspace, exportPath }: any) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [workspace],
        });
        dialog.showSaveDialog = async () => ({
          canceled: false,
          filePath: exportPath,
        });
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      },
      { workspace: c.workspace, exportPath },
    );
    const shell = await app.firstWindow();
    await shell
      .getByRole("button", { name: "打开作品", exact: true })
      .first()
      .click();
    await shell
      .getByRole("button", { name: "雨港来信", exact: false })
      .first()
      .click();
    const open = async () => {
      await shell
        .getByRole("button", { name: "剧情决策与时间线", exact: true })
        .click();
      await expect
        .poll(() =>
          app
            .context()
            .pages()
            .some((p: any) => p.url().startsWith("hetu-plugin:")),
        )
        .toBe(true);
      return app
        .context()
        .pages()
        .find((p: any) => p.url().startsWith("hetu-plugin:"));
    };
    let page: any = await open();
    const errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await page.setViewportSize({ width: 1360, height: 900 });
    await expect(
      page.getByRole("heading", { name: "雨港第二章接续", exact: true }),
    ).toBeVisible();
    const buttons = await page
      .getByRole("navigation", { name: "专业视图" })
      .getByRole("button")
      .all();
    for (const [index, b] of buttons.entries()) {
      await b.click();
      await expect(b).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("alert")).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath(`view-${index}.png`),
        fullPage: true,
      });
    }
    await buttons[0].click();
    expect(
      await page.evaluate(
        () => getComputedStyle(document.body).backgroundImage,
      ),
    ).toContain("gradient");
    await page.getByRole("button", { name: "让AI处理", exact: true }).focus();
    await expect(
      page.getByRole("button", { name: "让AI处理", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "时间线", exact: true }).click();
    await page.getByLabel("时间线排序", { exact: true }).selectOption("story");
    await expect(
      page.getByText("故事时间：未知，叙事顺序：1", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "人物状态", exact: true }).click();
    await expect(
      page.getByText("人物知情：不知道寄件人身份", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "让AI处理", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已复制");
    const copied = await app.evaluate(({ clipboard }: any) =>
      clipboard.readText(),
    );
    expect(copied).toContain(record.object.object_id);
    await page.getByRole("button", { name: "方向比较", exact: true }).click();
    await page.screenshot({
      path: info.outputPath("continuity-light.png"),
      fullPage: true,
    });
    await page.evaluate(
      () => (document.documentElement.style.colorScheme = "dark"),
    );
    await page.screenshot({
      path: info.outputPath("continuity-dark.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 760, height: 860 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("continuity-narrow.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "← 返回", exact: true }).click();
    await expect
      .poll(() =>
        app
          .context()
          .pages()
          .some((p: any) => p.url().startsWith("hetu-plugin:")),
      )
      .toBe(false);
    page = await open();
    await expect(
      page.getByRole("heading", { name: "雨港第二章接续", exact: true }),
    ).toBeVisible();
    expect(
      (await c.invoke("get_continuity", { object_id: record.object.object_id }))
        .sha256,
    ).toBe(record.sha256);
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await c.client.close();
  }
});
