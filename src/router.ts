import { Router, Request, Response } from "express";
import cron from "node-cron";
import dns from "dns/promises";
import { ScraperService } from "./scraperService";
import { SettingsStore } from "./settingsStore";
import { ApiResponse, ScrapeResult } from "./types";

// ── SSRF / DNSリバインディング対策 ───────────────────────

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,   // link-local / クラウドメタデータ (AWS等)
  /^[fFcCdD]{2}/,  // IPv6 ULA
];

/** IPアドレスがプライベート/予約済みアドレスかチェック */
function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(ip));
}

/**
 * URLのスキームとホスト名を静的に検証する（SSRF対策）。
 * 問題があればエラー文字列を返し、問題なければ null を返す。
 */
function validateUrl(rawUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Invalid URL format";
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return "Only http and https URLs are allowed";
  }
  if (isPrivateIp(parsed.hostname)) {
    return "URL points to a private or reserved address";
  }
  return null;
}

/**
 * DNS解決後のIPがプライベートアドレスでないか検証する（DNSリバインディング対策）。
 * 問題があればエラー文字列を返し、問題なければ null を返す。
 */
async function validateUrlDns(rawUrl: string): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "Invalid URL format";
  }
  const hostname = parsed.hostname;
  // IPアドレスが直接指定されている場合は静的チェック済みのためスキップ
  if (/^[\d.]+$/.test(hostname) || hostname.includes(":")) {
    return null;
  }
  try {
    const addresses = await dns.resolve(hostname);
    for (const addr of addresses) {
      if (isPrivateIp(addr)) {
        return `URL resolves to a private address (${addr}): DNS rebinding blocked`;
      }
    }
  } catch {
    return `Failed to resolve hostname: ${hostname}`;
  }
  return null;
}

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

/** 設定を永続化するヘルパー */
function persistSettings(service: ScraperService, store: SettingsStore): void {
  store.save({
    defaultUrls: service.getDefaultUrls(),
    scrapeInterval: service.getScrapeInterval(),
    targets: service.getTargetSettings(),
  });
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
  router.put("/settings", async (req: Request, res: Response) => {
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
      // URL形式・SSRF・DNSリバインディングチェック
      for (const url of defaultUrls) {
        const urlError = validateUrl(url);
        if (urlError) {
          const body: ApiResponse<never> = { success: false, error: urlError };
          res.status(400).json(body);
          return;
        }
        const dnsError = await validateUrlDns(url);
        if (dnsError) {
          const body: ApiResponse<never> = { success: false, error: dnsError };
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
      scrapeCount: t.scrapeCount,
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
  router.post("/targets", async (req: Request, res: Response) => {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== "string") {
      const body: ApiResponse<never> = {
        success: false,
        error: '"url" is required',
      };
      res.status(400).json(body);
      return;
    }

    // 静的チェック（スキーム・プライベートIP）
    const urlError = validateUrl(url);
    if (urlError) {
      const body: ApiResponse<never> = { success: false, error: urlError };
      res.status(400).json(body);
      return;
    }

    // DNSリバインディングチェック
    const dnsError = await validateUrlDns(url);
    if (dnsError) {
      const body: ApiResponse<never> = { success: false, error: dnsError };
      res.status(400).json(body);
      return;
    }

    // フィルター（正規表現）のバリデーション
    const { filter, filterReplace } = req.body as { filter?: string; filterReplace?: string };
    if (filter !== undefined) {
      if (typeof filter !== "string") {
        const body: ApiResponse<never> = { success: false, error: '"filter" must be a string' };
        res.status(400).json(body);
        return;
      }
      try {
        new RegExp(filter);
      } catch {
        const body: ApiResponse<never> = { success: false, error: `Invalid regex: "${filter}"` };
        res.status(400).json(body);
        return;
      }
    }
    if (filterReplace !== undefined && typeof filterReplace !== "string") {
      const body: ApiResponse<never> = { success: false, error: '"filterReplace" must be a string' };
      res.status(400).json(body);
      return;
    }

    const target = service.addTarget(url, filter, filterReplace);
    // ターゲット追加を永続化
    persistSettings(service, store);
    const body: ApiResponse<typeof target> = { success: true, data: target };
    res.status(201).json(body);
  });

  // フィルター設定・更新
  router.put("/targets/:id/filter", (req: Request, res: Response) => {
    const { filter, filterReplace } = req.body as { filter?: string; filterReplace?: string };
    if (!filter || typeof filter !== "string") {
      const body: ApiResponse<never> = { success: false, error: '"filter" is required and must be a string' };
      res.status(400).json(body);
      return;
    }
    try {
      new RegExp(filter);
    } catch {
      const body: ApiResponse<never> = { success: false, error: `Invalid regex: "${filter}"` };
      res.status(400).json(body);
      return;
    }
    if (filterReplace !== undefined && typeof filterReplace !== "string") {
      const body: ApiResponse<never> = { success: false, error: '"filterReplace" must be a string' };
      res.status(400).json(body);
      return;
    }
    const ok = service.setFilter(req.params.id, filter, filterReplace);
    if (!ok) {
      const body: ApiResponse<never> = { success: false, error: "Target not found" };
      res.status(404).json(body);
      return;
    }
    // フィルター設定を永続化
    persistSettings(service, store);
    const body: ApiResponse<{ filter: string; filterReplace?: string }> = {
      success: true,
      data: { filter, ...(filterReplace !== undefined && { filterReplace }) },
    };
    res.json(body);
  });

  // フィルター削除
  router.delete("/targets/:id/filter", (req: Request, res: Response) => {
    const ok = service.setFilter(req.params.id, undefined);
    if (!ok) {
      const body: ApiResponse<never> = { success: false, error: "Target not found" };
      res.status(404).json(body);
      return;
    }
    // フィルター設定を永続化
    persistSettings(service, store);
    const body: ApiResponse<{ removed: boolean }> = { success: true, data: { removed: true } };
    res.json(body);
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
    // ターゲット削除を永続化
    persistSettings(service, store);
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
