export interface ScrapeResult {
  url: string;
  html: string;
  statusCode: number;
  scrapedAt: string;
  success: boolean;
  error?: string;
  truncated?: boolean; // HTMLが512KBを超えて切り詰められた場合にtrue
}

export interface ScrapedTarget {
  id: string;
  url: string;
  createdAt: string;
  lastScrapedAt?: string;
  results: ScrapeResult[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
