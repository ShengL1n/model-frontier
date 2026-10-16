import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const base = process.env.FRONTIER_URL ?? "http://localhost:4317";
const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL || "chrome",
  headless: true,
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
page.on("pageerror", (e) => errors.push(e.message));
async function choose(label, text) {
  console.log("select", label, text);
  await page.evaluate(() => scrollTo(0, 0));
  const input = page.getByRole("combobox", { name: label, exact: true });
  await input.scrollIntoViewIfNeeded();
  await input.click();
  await page.waitForTimeout(250);
  await page
    .locator(".ant-select-dropdown:visible .ant-select-item-option")
    .filter({ has: page.getByText(text, { exact: true }) })
    .click();
}
try {
  await page.goto(base);
  await page.evaluate(() =>
    localStorage.setItem(
      "frontier:preferences",
      JSON.stringify({
        preset: "capability",
        weights: { arena: 10, aa: 35, vals: 30, livebench: 25 },
        minSources: 4,
        coverageSchemaVersion: 2,
        costSchemaVersion: 2,
      }),
    ),
  );
  await page.reload();
  await page.waitForFunction(() => {
    const p = JSON.parse(localStorage.getItem("frontier:preferences"));
    return p.weights.aa === 40 && !("arena" in p.weights) && p.minSources === 3;
  });
  await page.getByRole("tab", { name: "前沿探索", exact: true }).click();
  await page.getByRole("heading", { name: "综合能力 / 成本前沿" }).waitFor();
  await page.locator("canvas").waitFor();
  await page
    .getByText("综合相对成本（基准 1 倍）", { exact: true })
    .first()
    .waitFor();
  assert.equal(await page.getByLabel("覆盖度微调", { exact: true }).count(), 0);
  const data = await (await page.request.get(base + "/api/data")).json();
  assert.ok(data.models.length > 100);
  assert.deepEqual(Object.keys(data.sources).sort(), [
    "aa",
    "livebench",
    "vals",
  ]);
  assert.ok(
    data.models.every((m) => !m.records.arena && !m.representatives.arena),
  );
  assert.ok(Object.values(data.sources).every((s) => s.count > 5 && !s.stale));
  const checkOverflow = async () => {
    await page.waitForFunction(
      () => document.documentElement.scrollWidth <= innerWidth,
      null,
      { timeout: 4000 },
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
  };
  await checkOverflow();
  // Mouse wheel must scroll the document, rather than trigger chart zoom.
  await page.locator("canvas").scrollIntoViewIfNeeded();
  const canvasBox = await page.locator("canvas").boundingBox();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.55,
    canvasBox.y + canvasBox.height * 0.45,
  );
  const previousScroll = await page.evaluate(() => scrollY);
  await page.mouse.wheel(0, 200);
  await page.waitForFunction((y) => scrollY > y, previousScroll, {
    timeout: 3000,
  });
  assert.equal(
    await page
      .getByRole("button", { name: "重置图表", exact: true })
      .isDisabled(),
    true,
  );
  await page.getByRole("button", { name: "放大图表", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "重置图表", exact: true })
      .isEnabled(),
    true,
  );
  await page.getByRole("button", { name: "重置图表", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "重置图表", exact: true })
      .isDisabled(),
    true,
  );
  const pngPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载图表", exact: true }).click();
  const png = await pngPromise;
  assert.equal(png.suggestedFilename(), "model-frontier.png");
  await page.getByRole("button", { name: "切换图表全屏", exact: true }).click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.getByRole("button", { name: "切换图表全屏", exact: true }).click();
  await page.waitForFunction(() => !document.fullscreenElement);
  const legend = page
    .locator(".chart-legend")
    .getByRole("button", { name: "闭源 / 未确认", exact: true });
  await legend.click();
  assert.equal(await legend.getAttribute("aria-pressed"), "false");
  await legend.click();
  await page.getByLabel("搜索模型", { exact: true }).fill("MiMo");
  await page.getByRole("button", { name: /MiMo V2.6 Pro/ }).click();
  await page
    .getByText(
      "按模型族归并。这里保留各榜单具体配置；跨站分数不代表同一个推理档位。",
    )
    .waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByLabel("搜索模型", { exact: true }).fill("");
  await choose("权重预设", "广覆盖双榜");
  await page.getByText("全部 2 榜 · 严格比较", { exact: true }).waitFor();
  const csvPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV", exact: true }).click();
  const download = await csvPromise;
  assert.equal(download.suggestedFilename(), "model-frontier.csv");
  const csv = await readFile(await download.path(), "utf8");
  assert.ok(csv.includes("MiMo"));
  assert.ok(csv.includes("开放权重前沿"));
  await choose("成本来源", "Vals 每次测试成本");
  await choose("最低榜单覆盖", "至少 1 榜 · 探索模式");
  await page.getByText(/扩展比较：缺分不补零/).waitFor();
  await page.getByRole("tab", { name: "权重敏感性", exact: true }).click();
  await page
    .getByRole("heading", { name: "结论对权重敏感吗？", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "前沿稳定性指数", exact: true })
    .waitFor();
  assert.equal(await page.locator(".preset-cards>div").count(), 3);
  await page.getByRole("tab", { name: "数据来源与刷新", exact: true }).click();
  assert.equal(await page.locator(".source-card").count(), 3);
  await page.getByText("703 条源站模型配置", { exact: false }).count();
  const response = await page.request.put(base + "/api/settings", {
    data: { refreshHours: 7 },
  });
  assert.equal(response.status(), 400);
  const rejected = await page.request.post(base + "/api/refresh", {
    headers: { Origin: "https://external.invalid" },
  });
  assert.equal(rejected.status(), 403);
  await page.getByRole("button", { name: "计算方法", exact: true }).click();
  await page
    .getByRole("heading", { name: "如何设置三榜权重？", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("tab", { name: "前沿探索", exact: true }).click();
  await choose("权重预设", "能力优先");
  await choose("成本来源", "AA 每次任务成本");
  await page.evaluate(() => localStorage.removeItem("frontier:preferences"));
  await page.reload();
  await page.locator("canvas").waitFor();
  // A passive API poll must not replace the canvas or reset the user's zoom.
  const before = await page.locator("canvas").evaluate((e) => {
    e.dataset.qaIdentity = "retained";
    return e.dataset.qaIdentity;
  });
  await page.waitForTimeout(5500);
  assert.equal(
    await page.locator("canvas").getAttribute("data-qa-identity"),
    before,
  );
  await mkdir("test-artifacts", { recursive: true });
  await page.screenshot({ path: "test-artifacts/desktop.png", fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  await checkOverflow();
  await page.screenshot({ path: "test-artifacts/mobile.png", fullPage: true });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 812, height: 375 });
  await checkOverflow();
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        sourceCounts: Object.fromEntries(
          Object.entries(data.sources).map(([k, v]) => [k, v.count]),
        ),
        modelFamilies: data.models.length,
        uiChecks: [
          "chart",
          "wheel page scroll",
          "zoom buttons",
          "PNG export",
          "fullscreen",
          "legend toggle",
          "detail",
          "presets",
          "cost",
          "partial coverage warning",
          "CSV",
          "sensitivity",
          "source status",
          "settings validation",
          "local origin guard",
          "method",
          "passive polling",
          "375px",
          "landscape",
          "reduced motion",
        ],
        pageErrors: errors,
      },
      null,
      2,
    ),
  );
} catch (e) {
  await mkdir("test-artifacts", { recursive: true });
  await page.screenshot({ path: "test-artifacts/failure.png", fullPage: true });
  throw e;
} finally {
  await browser.close();
}
