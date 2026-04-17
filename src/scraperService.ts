import axios from "axios";
import { randomUUID } from "crypto";
import { ScrapedTarget, ScrapeResult } from "./types";

const MAX_RESULTS_PER_TARGET = 60;
const MAX_HTML_BYTES = 512 * 1024; // 512KB

export class ScraperService {
  private targets: Map<string, ScrapedTarget> = new Map();
  private defaultUrls: string[] = [];
  private scrapeInterval: string = "*/30 * * * * *";

  // ── デフォルトURL ──────────────────────────────────

  setDefaultUrls(urls: string[]): void {
    this.defaultUrls = [...urls];
  }

  getDefaultUrls(): string[] {
    return this.defaultUrls;
  }

  /**
   * デフォルトURLを追加し、ターゲットにも登録する
   */
  addDefaultUrl(url: string): void {
    if (!this.defaultUrls.includes(url)) {
      this.defaultUrls.push(url);
    }
    this.addTarget(url);
  }

  /**
   * デフォルトURLを削除する（ターゲット自体は残す）
   */
  removeDefaultUrl(url: string): boolean {
    const idx = this.defaultUrls.indexOf(url);
    if (idx === -1) return false;
    this.defaultUrls.splice(idx, 1);
    return true;
  }

  // ── スクレイピング間隔 ──────────────────────────────

  getScrapeInterval(): string {
    return this.scrapeInterval;
  }

  setScrapeInterval(interval: string): void {
    this.scrapeInterval = interval;
  }

  // ── ターゲット管理 ──────────────────────────────────

  addTarget(url: string, filter?: string): ScrapedTarget {
    for (const target of this.targets.values()) {
      if (target.url === url) return target;
    }

    const target: ScrapedTarget = {
      id: randomUUID(),
      url,
      createdAt: new Date().toISOString(),
      results: [],
      ...(filter !== undefined && { filter }),
    };

    this.targets.set(target.id, target);
    console.log(`[ScraperService] Target added: ${url} (id: ${target.id})`);
    this.scrape(target.id);
    return target;
  }

  setFilter(id: string, filter: string | undefined): boolean {
    const target = this.targets.get(id);
    if (!target) return false;
    if (filter === undefined) {
      delete target.filter;
    } else {
      target.filter = filter;
    }
    return true;
  }

  removeTarget(id: string): boolean {
    const existed = this.targets.has(id);
    this.targets.delete(id);
    return existed;
  }

  getAllTargets(): ScrapedTarget[] {
    return Array.from(this.targets.values());
  }

  getTarget(id: string): ScrapedTarget | undefined {
    return this.targets.get(id);
  }

  getLatestResult(id: string): ScrapeResult | undefined {
    const target = this.targets.get(id);
    if (!target || target.results.length === 0) return undefined;
    return target.results[target.results.length - 1];
  }

  getHistory(id: string): ScrapeResult[] {
    const target = this.targets.get(id);
    return target ? [...target.results].reverse() : [];
  }

  // ── スクレイピング ──────────────────────────────────

  async scrapeAll(): Promise<void> {
    const ids = Array.from(this.targets.keys());
    console.log(`[ScraperService] Scraping ${ids.length} target(s)...`);
    await Promise.all(ids.map((id) => this.scrape(id)));
  }

  async scrape(id: string): Promise<ScrapeResult | undefined> {
    const target = this.targets.get(id);
    if (!target) return undefined;

    let result: ScrapeResult;

    try {
      const response = await axios.get<string>(target.url, {
        responseType: "text",
        timeout: 15000,
        maxRedirects: 5,
        maxContentLength: 10 * 1024 * 1024, // 10MB
        maxBodyLength: 10 * 1024 * 1024,     // 10MB
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; ScraperService/1.0; +https://github.com/scraper-service)",
        },
        validateStatus: () => true,
      });

      const rawHtml: string = response.data;
      const truncated = Buffer.byteLength(rawHtml, "utf-8") > MAX_HTML_BYTES;
      const html = truncated
        ? Buffer.from(rawHtml, "utf-8").slice(0, MAX_HTML_BYTES).toString("utf-8") +
          "\n<!-- [scraper-service] HTML truncated: exceeded 512KB -->"
        : rawHtml;

      result = {
        url: target.url,
        html,
        statusCode: response.status,
        scrapedAt: new Date().toISOString(),
        success: response.status >= 200 && response.status < 400,
        ...(truncated && { truncated: true }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = {
        url: target.url,
        html: "",
        statusCode: 0,
        scrapedAt: new Date().toISOString(),
        success: false,
        error: message,
      };
    }

    // 正規表現フィルターが設定されている場合はマッチ結果を付加
    if (result.success && target.filter) {
      try {
        const regex = new RegExp(target.filter, "g");
        const matches = Array.from(result.html.matchAll(regex), (m) => m[0]);
        result.matches = matches;
        console.log(`[ScraperService] Filter matched ${matches.length} item(s) for ${target.url}`);
      } catch (e) {
        console.warn(`[ScraperService] Invalid regex filter "${target.filter}":`, e);
      }
    }

    target.results.push(result);
    if (target.results.length > MAX_RESULTS_PER_TARGET) {
      target.results.shift();
    }
    target.lastScrapedAt = result.scrapedAt;

    const status = result.success
      ? `✓ ${result.statusCode}`
      : `✗ ${result.error ?? result.statusCode}`;
    console.log(`[ScraperService] ${target.url} → ${status}`);

    return result;
  }
}
