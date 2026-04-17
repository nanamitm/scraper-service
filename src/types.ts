export interface ScrapeResult {
  url: string;
  html: string;
  statusCode: number;
  scrapedAt: string;
  success: boolean;
  error?: string;
  truncated?: boolean;      // HTMLが512KBを超えて切り詰められた場合にtrue
  matches?: string[];       // 正規表現フィルターにマッチした文字列の配列
  replacedHtml?: string;    // 置換後のHTML（filterReplaceが設定されている場合）
}

export interface ScrapedTarget {
  id: string;
  url: string;
  createdAt: string;
  lastScrapedAt?: string;
  results: ScrapeResult[];
  filter?: string;          // 正規表現フィルター（オプション）
  filterReplace?: string;   // 置換文字列（filterと組み合わせて使用）
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
