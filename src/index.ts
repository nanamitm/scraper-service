import express from "express";
import path from "path";
import cron from "node-cron";
import { ScraperService } from "./scraperService";
import { SettingsStore } from "./settingsStore";
import { createPublicRouter, createAdminRouter } from "./router";

const PUBLIC_PORT = parseInt(process.env.PORT ?? "3000", 10);
const ADMIN_PORT  = parseInt(process.env.ADMIN_PORT ?? "3001", 10);

// =============================
// 設定ファイルの保存先
// =============================
const SETTINGS_PATH = path.join(__dirname, "..", "data", "settings.json");

// =============================
// コードに書いたデフォルト値
// （設定ファイルが存在しない初回起動時のみ使用）
// =============================
const INITIAL_DEFAULT_URL = "https://example.com";
const INITIAL_INTERVAL = "*/30 * * * * *";

async function main() {
  // 設定を読み込む（ファイルがなければ初期値を使用）
  const store = new SettingsStore(SETTINGS_PATH);
  let settings = store.load();

  // 設定ファイルが存在しない初回のみコードの初期値を使用
  const isFirstRun = !require("fs").existsSync(SETTINGS_PATH);
  if (isFirstRun) {
    settings.defaultUrls = [INITIAL_DEFAULT_URL];
    settings.scrapeInterval = INITIAL_INTERVAL;
    store.save(settings);
    console.log(`[Settings] First run — saved initial settings to ${SETTINGS_PATH}`);
  } else {
    console.log(`[Settings] Loaded from ${SETTINGS_PATH}`);
  }

  const service = new ScraperService();
  // デフォルトURLは常に1件（配列の先頭のみ使用）
  const defaultUrl = settings.defaultUrls[0] ?? "";
  service.setDefaultUrl(defaultUrl);
  service.setScrapeInterval(settings.scrapeInterval);

  // 保存されていた全ターゲットを復元（フィルター設定を含む）
  if (settings.targets && settings.targets.length > 0) {
    for (const ts of settings.targets) {
      // URLを登録（addTargetは重複を無視して既存ターゲットを返す）
      const target = service.addTarget(ts.url);
      // フィルター設定があれば復元
      if (ts.filter !== undefined) {
        service.setFilter(target.id, ts.filter, ts.filterReplace);
        console.log(`[Settings] Restored ${ts.url} (filter: /${ts.filter}/)`);
      } else {
        console.log(`[Settings] Restored ${ts.url}`);
      }
    }
  }

  // デフォルトURLが targets に含まれていない場合（初回起動等）は単独で登録
  if (defaultUrl && !service.getAllTargets().find((t) => t.url === defaultUrl)) {
    service.addTarget(defaultUrl);
  }

  // cronタスクを管理（動的に再起動できるよう変数で保持）
  let cronTask = startCron(service);

  const restartCron = () => {
    cronTask.stop();
    cronTask = startCron(service);
    console.log(`[Cron] Restarted with interval: "${service.getScrapeInterval()}"`);
  };

  // ── 公開APIサーバー（port 3000）──────────────────────
  const publicApp = express();
  publicApp.use(express.json());
  publicApp.use(express.static(path.join(__dirname, "public")));
  publicApp.use("/api", createPublicRouter(service));
  publicApp.use((_req, res) => {
    res.status(404).json({ success: false, error: "Not found" });
  });

  publicApp.listen(PUBLIC_PORT, () => {
    console.log(`\n🌐 Public API   → http://localhost:${PUBLIC_PORT}`);
    console.log(`   Test page    → http://localhost:${PUBLIC_PORT}/`);
    console.log(`   Endpoints:`);
    console.log(`     GET  /api/health`);
    console.log(`     GET  /api/defaults/latest`);
    console.log(`     GET  /api/latest?url=...`);
  });

  // ── 管理サーバー（port 3001）─────────────────────────
  const adminApp = express();
  adminApp.use(express.json());
  adminApp.use(express.static(path.join(__dirname, "admin")));
  adminApp.use("/api", createAdminRouter(service, restartCron, store));
  adminApp.use((_req, res) => {
    res.status(404).json({ success: false, error: "Not found" });
  });

  adminApp.listen(ADMIN_PORT, () => {
    console.log(`\n🔒 Admin Panel  → http://localhost:${ADMIN_PORT}`);
    console.log(`   Settings     → ${SETTINGS_PATH}`);
    console.log(`   Endpoints:`);
    console.log(`     GET    /api/health`);
    console.log(`     GET    /api/settings            ← 設定取得`);
    console.log(`     PUT    /api/settings            ← 設定更新・保存`);
    console.log(`     GET    /api/defaults/latest`);
    console.log(`     GET    /api/latest?url=...`);
    console.log(`     GET    /api/targets`);
    console.log(`     GET    /api/targets/:id`);
    console.log(`     GET    /api/targets/:id/history`);
    console.log(`     POST   /api/targets`);
    console.log(`     DELETE /api/targets/:id`);
    console.log(`     POST   /api/targets/:id/scrape`);
  });
}

function startCron(service: ScraperService): cron.ScheduledTask {
  const interval = service.getScrapeInterval();
  if (!cron.validate(interval)) {
    console.error(`[Cron] Invalid expression: "${interval}"`);
    process.exit(1);
  }
  console.log(`⏱  Scraping interval: "${interval}"`);
  return cron.schedule(interval, async () => {
    await service.scrapeAll();
  }, { scheduled: true });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
