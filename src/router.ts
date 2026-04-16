import { Router, Request, Response } from "express";
import cron from "node-cron";
import { ScraperService } from "./scraperService";
import { SettingsStore } from "./settingsStore";
import { ApiResponse, ScrapeResult } from "./types";

/**
 * 公開API用ルーター（port 3000）
 * 結果の取得のみ。/api/targets は管理画面のみ。
 */
export function createPublicRouter(service: ScraperService): Router {
  const router = Router();

  // ヘルスチェック
  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // デフォルトURL全件の最新スクレイピング結果を返す
  router.get("/defaults/latest", (_req: Request, res: Response) => {
    const defaultUrls = service.getDefaultUrls();
    if (defaultUrls.length === 0) {
      const body: ApiResponse<never> = {
        success: false,
        error: "No default URLs configured",
      };
      res.status(404).json(body);
      return;
    }

    const results: { url: string; result: ScrapeResult | null }[] = defaultUrls.map((url) => {
      const target = service.getAllTargets().find((t) => t.url === url);
      const result = target ? service.getLatestResult(target.id) ?? null : null;
      return { url, result };
    });

    const body: ApiResponse<typeof results> = { success: true, data: results };
    res.json(body);
  });

  // URLで最新スクレイピング結果を取得（IDなし）
  router.get("/latest", (req: Request, res: Response) => {
    const filterUrl = req.query.url as string | undefined;
    if (!filterUrl) {
      const body: ApiResponse<never> = {
        success: false,
        error: '"url" query parameter is required',
      };
      res.status(400).json(body);
      return;
    }

    const target = service.getAllTargets().find((t) => t.url === filterUrl);
    if (!target) {
      const body: ApiResponse<never> = {
        success: false,
        error: `No target found for url: ${filterUrl}`,
      };
      res.status(404).json(body);
      return;
    }

    const result = service.getLatestResult(target.id);
    if (!result) {
      const body: ApiResponse<never> = {
        success: false,
        error: "No results yet",
      };
      res.status(404).json(body);
      return;
    }

    const body: ApiResponse<typeof result> = { success: true, data: result };
    res.json(body);
  });

  return router;
}

/**
 * 管理API用ルーター（port 3001）
 * /api/targets の操作・即時スクレイピングはここのみ
 */
export function createAdminRouter(service: ScraperService, restartCron: () => void, store: SettingsStore): Router {
  const router = Router();

  // ヘルスチェック
  router.get("/health", (_req: Request, res: Response) => {
    res.json({ status: "ok", role: "admin", timestamp: new Date().toISOString() });
  });

  // 設定取得
  router.get("/settings", (_req: Request, res: Response) => {
    // 設定をファイルに永続化
    store.save({
      defaultUrls: service.getDefaultUrls(),
      scrapeInterval: service.getScrapeInterval(),
    });

    const body: ApiResponse<{ defaultUrls: string[]; scrapeInterval: string }> = {
      success: true,
      data: {
        defaultUrls: service.getDefaultUrls(),
        scrapeInterval: service.getScrapeInterval(),
      },
    };
    res.json(body);
  });

  // 設定更新
  router.put("/settings", (req: Request, res: Response) => {
    const { defaultUrls, scrapeInterval } = req.body as {
      defaultUrls?: string[];
      scrapeInterval?: string;
    };

    // デフォルトURL更新
    if (defaultUrls !== undefined) {
      if (!Array.isArray(defaultUrls)) {
        const body: ApiResponse<never> = { success: false, error: '"defaultUrls" must be an array' };
        res.status(400).json(body);
        return;
      }
      // URL形式チェック
      for (const url of defaultUrls) {
        try { new URL(url); } catch {
          const body: ApiResponse<never> = { success: false, error: `Invalid URL: ${url}` };
          res.status(400).json(body);
          return;
        }
      }
      // 追加されたURLをターゲットに登録
      for (const url of defaultUrls) {
        service.addDefaultUrl(url);
      }
      // 削除されたURLをデフォルトから外す
      for (const url of service.getDefaultUrls()) {
        if (!defaultUrls.includes(url)) {
          service.removeDefaultUrl(url);
        }
      }
      service.setDefaultUrls(defaultUrls);
    }

    // スクレイピング間隔更新
    if (scrapeInterval !== undefined) {
      if (!cron.validate(scrapeInterval)) {
        const body: ApiResponse<never> = { success: false, error: `Invalid cron expression: "${scrapeInterval}"` };
        res.status(400).json(body);
        return;
      }
      service.setScrapeInterval(scrapeInterval);
      restartCron();
    }

    const body: ApiResponse<{ defaultUrls: string[]; scrapeInterval: string }> = {
      success: true,
      data: {
        defaultUrls: service.getDefaultUrls(),
        scrapeInterval: service.getScrapeInterval(),
      },
    };
    res.json(body);
  });

  // デフォルトURL全件の最新スクレイピング結果を返す
  router.get("/defaults/latest", (_req: Request, res: Response) => {
    const defaultUrls = service.getDefaultUrls();
    if (defaultUrls.length === 0) {
      const body: ApiResponse<never> = {
        success: false,
        error: "No default URLs configured",
      };
      res.status(404).json(body);
      return;
    }

    const results: { url: string; result: ScrapeResult | null }[] = defaultUrls.map((url) => {
      const target = service.getAllTargets().find((t) => t.url === url);
      const result = target ? service.getLatestResult(target.id) ?? null : null;
      return { url, result };
    });

    const body: ApiResponse<typeof results> = { success: true, data: results };
    res.json(body);
  });

  // URLで最新スクレイピング結果を取得（IDなし）
  router.get("/latest", (req: Request, res: Response) => {
    const filterUrl = req.query.url as string | undefined;
    if (!filterUrl) {
      const body: ApiResponse<never> = {
        success: false,
        error: '"url" query parameter is required',
      };
      res.status(400).json(body);
      return;
    }

    const target = service.getAllTargets().find((t) => t.url === filterUrl);
    if (!target) {
      const body: ApiResponse<never> = {
        success: false,
        error: `No target found for url: ${filterUrl}`,
      };
      res.status(404).json(body);
      return;
    }

    const result = service.getLatestResult(target.id);
    if (!result) {
      const body: ApiResponse<never> = {
        success: false,
        error: "No results yet",
      };
      res.status(404).json(body);
      return;
    }

    const body: ApiResponse<typeof result> = { success: true, data: result };
    res.json(body);
  });

  // ターゲット一覧取得（?url=... でフィルタ可能）
  router.get("/targets", (req: Request, res: Response) => {
    const filterUrl = req.query.url as string | undefined;
    let targets = service.getAllTargets().map((t) => ({
      id: t.id,
      url: t.url,
      createdAt: t.createdAt,
      lastScrapedAt: t.lastScrapedAt,
      resultCount: t.results.length,
      isDefault: service.getDefaultUrls().includes(t.url),
    }));

    if (filterUrl) {
      targets = targets.filter((t) => t.url === filterUrl);
      if (targets.length === 0) {
        const body: ApiResponse<never> = {
          success: false,
          error: `No target found for url: ${filterUrl}`,
        };
        res.status(404).json(body);
        return;
      }
    }

    const body: ApiResponse<typeof targets> = { success: true, data: targets };
    res.json(body);
  });

  // ターゲット詳細取得
  router.get("/targets/:id", (req: Request, res: Response) => {
    const target = service.getTarget(req.params.id);
    if (!target) {
      const body: ApiResponse<never> = {
        success: false,
        error: "Target not found",
      };
      res.status(404).json(body);
      return;
    }
    const body: ApiResponse<typeof target> = { success: true, data: target };
    res.json(body);
  });

  // ターゲット登録
  router.post("/targets", (req: Request, res: Response) => {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== "string") {
      const body: ApiResponse<never> = {
        success: false,
        error: '"url" is required',
      };
      res.status(400).json(body);
      return;
    }

    try {
      new URL(url);
    } catch {
      const body: ApiResponse<never> = {
        success: false,
        error: "Invalid URL format",
      };
      res.status(400).json(body);
      return;
    }

    const target = service.addTarget(url);
    const body: ApiResponse<typeof target> = { success: true, data: target };
    res.status(201).json(body);
  });

  // ターゲット削除
  router.delete("/targets/:id", (req: Request, res: Response) => {
    const removed = service.removeTarget(req.params.id);
    if (!removed) {
      const body: ApiResponse<never> = {
        success: false,
        error: "Target not found",
      };
      res.status(404).json(body);
      return;
    }
    const body: ApiResponse<{ removed: boolean }> = {
      success: true,
      data: { removed: true },
    };
    res.json(body);
  });

  // 即時スクレイピング実行
  router.post("/targets/:id/scrape", async (req: Request, res: Response) => {
    const target = service.getTarget(req.params.id);
    if (!target) {
      const body: ApiResponse<never> = {
        success: false,
        error: "Target not found",
      };
      res.status(404).json(body);
      return;
    }
    const result = await service.scrape(req.params.id);
    const body: ApiResponse<typeof result> = { success: true, data: result };
    res.json(body);
  });

  // スクレイピング履歴取得（新しい順）
  router.get("/targets/:id/history", (req: Request, res: Response) => {
    const target = service.getTarget(req.params.id);
    if (!target) {
      const body: ApiResponse<never> = {
        success: false,
        error: "Target not found",
      };
      res.status(404).json(body);
      return;
    }
    const limit = Math.min(
      parseInt((req.query.limit as string) ?? "10", 10),
      60
    );
    const history = service.getHistory(req.params.id).slice(0, limit);
    const body: ApiResponse<typeof history> = { success: true, data: history };
    res.json(body);
  });

  return router;
}
