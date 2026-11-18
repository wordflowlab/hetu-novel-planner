import { writeFile } from "node:fs/promises";
import { _electron as electron, expect, test } from "@playwright/test";
import { createRequire } from "node:module";
import path from "node:path";
import { fixtureContent } from "../support/depth-scenario.ts";
import { importText } from "../support/import.ts";
import { host, start } from "../support/machine.ts";
import { newPlan } from "../../src/domain/model.ts";

test("有数据的专业深化工作面、真实计算、浅暗窄窗与键盘", async ({}, info) => {
  const c = await start();
  let app: any;
  try {
    const refs = await importText(c, ["雨港。林溪在旧邮局等信。\n雨港。\n"]),
      ev = { source_index: 0, byte_start: 0, byte_end: 9, quote: "雨港。" };
    const plan = await c.invoke("put_plan", {
      title: "整书规划",
      content: newPlan("雨港", "book"),
      source_refs: refs,
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "ui-plan",
    });
    const content = fixtureContent(
      {
        object_id: plan.object.object_id,
        revision: plan.object.revision,
        sha256: plan.sha256,
      },
      ev,
    );
    const record = await c.invoke("save_continuity", {
      content,
      source_refs: refs,
      expected_revision: 0,
      expected_sha256: "",
      operation_key: "ui-depth",
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
    await app.evaluate(
      ({ dialog }: any, { workspace }: any) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [workspace],
        });
        dialog.showMessageBox = async () => ({
          response: 1,
          checkboxChecked: false,
        });
      },
      { workspace: c.workspace },
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
    const page: any = app
        .context()
        .pages()
        .find((p: any) => p.url().startsWith("hetu-plugin:")),
      errors: string[] = [];
    page.on("pageerror", (e: Error) => errors.push(e.message));
    await expect(
      page.getByRole("heading", {
        name: record.object.content.title,
        exact: true,
      }),
    ).toBeVisible();
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value: string) => {
        document.documentElement.style.colorScheme = value;
      }, theme);
      for (const [width, height] of [
        [1360, 900],
        [760, 860],
      ]) {
        await page.setViewportSize({ width, height });
        for (const label of ["偏序约束", "人物知情", "修改影响"]) {
          await page.getByRole("button", { name: label, exact: true }).click();
          await page.screenshot({
            path: info.outputPath(
              "before-" + theme + "-" + width + "-" + label + ".png",
            ),
            fullPage: true,
          });
          await writeFile(
            info.outputPath(
              "before-" + theme + "-" + width + "-" + label + ".txt",
            ),
            await page.locator("body").innerText(),
          );
          expect(errors).toEqual([]);
          if (label === "人物知情") {
            await page
              .getByLabel("知情人物", { exact: true })
              .selectOption("lin");
            await page
              .getByLabel("知情事件", { exact: true })
              .selectOption("e2");
            await page
              .getByRole("button", { name: "核对这个时点", exact: true })
              .click();
            await expect(page.getByLabel("知情结果")).toContainText("已获知");
          }
          if (label === "修改影响") {
            await page
              .getByRole("button", { name: "查看依赖影响", exact: true })
              .click();
            await expect(
              page.getByText("待复核", { exact: true }).first(),
            ).toBeVisible();
          }
          await expect(page.getByRole("alert")).toHaveCount(0);
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.screenshot({
            path: info.outputPath(theme + "-" + width + "-" + label + ".png"),
            fullPage: true,
          });
        }
      }
    }
    await page.getByRole("button", { name: "让AI处理", exact: true }).focus();
    await expect(
      page.getByRole("button", { name: "让AI处理", exact: true }),
    ).toBeFocused();
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await c.client.close();
  }
});
