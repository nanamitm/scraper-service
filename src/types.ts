export interface ScrapeResult {
  url: string;
  html: string;             // フィルター設定時は処理後の結果、未設定時は生HTML
  rawHtml: string;          // フィルター適用前の生HTML（常に保持）
  statusCode: number;
  scrapedAt: string;
  success: boolean;
  error?: string;
  truncated?: boolean;      // HTMLが512KBを超えて切り詰められた場合にtrue
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
