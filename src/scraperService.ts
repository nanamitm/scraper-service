import axios from "axios";
import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import { ScrapedTarget, ScrapeResult } from "./types";

const MAX_RESULTS_PER_TARGET = 60;
const MAX_HTML_BYTES = 512 * 1024; // 512KB

export class ScraperService extends EventEmitter {
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

  addTarget(url: string, filter?: string, filterReplace?: string): ScrapedTarget {
    for (const target of this.targets.values()) {
      if (target.url === url) return target;
    }

    const target: ScrapedTarget = {
      id: randomUUID(),
      url,
      createdAt: new Date().toISOString(),
      scrapeCount: 0,
      results: [],
      ...(filter !== undefined && { filter }),
      ...(filterReplace !== undefined && { filterReplace }),
    };

    this.targets.set(target.id, target);
    console.log(`[ScraperService] Target added: ${url} (id: ${target.id})`);
    this.scrape(target.id);
    return target;
  }

  setFilter(id: string, filter: string | undefined, filterReplace?: string | undefined): boolean {
    const target = this.targets.get(id);
    if (!target) return false;
    if (filter === undefined) {
      delete target.filter;
      delete target.filterReplace;
    } else {
      target.filter = filter;
      if (filterReplace !== undefined) {
        target.filterReplace = filterReplace;
      } else {
        delete target.filterReplace;
      }
    }
    // 既存の全結果にフィルターを即時再適用
    for (const result of target.results) {
      result.html = result.rawHtml; // いったん生HTMLに戻す
      this.applyFilter(result, target.filter, target.filterReplace);
    }
    console.log(`[ScraperService] Filter updated and reapplied to ${target.results.length} result(s) for ${target.url}`);
    return true;
  }

  /** rawHtml を元にフィルター／置換を適用して html を上書きする */
  private applyFilter(result: ScrapeResult, filter?: string, filterReplace?: string): void {
    if (!result.success || !filter) return;
    try {
      const regex = new RegExp(filter, "g");
      if (filterReplace !== undefined) {
        result.html = result.rawHtml.replace(regex, filterReplace);
      } else {
        const matches = Array.from(result.rawHtml.matchAll(regex), (m) => m[0]);
        result.html = matches.join("\n");
      }
    } catch (e) {
      console.warn(`[ScraperService] Invalid regex filter "${filter}":`, e);
    }
  }

  /**
   * 全ターゲットのフィルター設定を永続化用に返す
   */
  getTargetSettings(): Array<{ url: string; filter?: string; filterReplace?: string }> {
    return Array.from(this.targets.values()).map((t) => ({
      url: t.url,
      ...(t.filter !== undefined && { filter: t.filter }),
      ...(t.filterReplace !== undefined && { filterReplace: t.filterReplace }),
    }));
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

      const fetched: string = response.data;
      const truncated = Buffer.byteLength(fetched, "utf-8") > MAX_HTML_BYTES;
      const rawHtml = truncated
        ? Buffer.from(fetched, "utf-8").slice(0, MAX_HTML_BYTES).toString("utf-8") +
          "\n<!-- [scraper-service] HTML truncated: exceeded 512KB -->"
        : fetched;

      result = {
        url: target.url,
        html: rawHtml,
        rawHtml,
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
        rawHtml: "",
        statusCode: 0,
        scrapedAt: new Date().toISOString(),
        success: false,
        error: message,
      };
    }

    // 正規表現フィルター／置換が設定されている場合に html を上書き（rawHtml は保持）
    this.applyFilter(result, target.filter, target.filterReplace);

    target.results.push(result);
    if (target.results.length > MAX_RESULTS_PER_TARGET) {
      target.results.shift();
    }
    target.scrapeCount++;
    target.lastScrapedAt = result.scrapedAt;
    this.emit("scrape-complete", { id: target.id, url: target.url });

    const status = result.success
      ? `✓ ${result.statusCode}`
      : `✗ ${result.error ?? result.statusCode}`;
    console.log(`[ScraperService] ${target.url} → ${status}`);

    return result;
  }
}
