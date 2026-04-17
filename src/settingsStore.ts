import fs from "fs";
import path from "path";

export interface TargetFilterSettings {
  url: string;
  filter?: string;
  filterReplace?: string;
}

export interface Settings {
  defaultUrls: string[];
  scrapeInterval: string;
  /** 各ターゲットのフィルター設定（URLをキーとして保存） */
  targets?: TargetFilterSettings[];
}

const DEFAULT_SETTINGS: Settings = {
  defaultUrls: [],
  scrapeInterval: "*/30 * * * * *",
  targets: [],
};

export class SettingsStore {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * 設定ファイルを読み込む。存在しない場合はデフォルト値を返す
   */
  load(): Settings {
    try {
      if (!fs.existsSync(this.filePath)) {
        return { ...DEFAULT_SETTINGS };
      }
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return {
        defaultUrls: Array.isArray(parsed.defaultUrls) ? parsed.defaultUrls : DEFAULT_SETTINGS.defaultUrls,
        scrapeInterval: typeof parsed.scrapeInterval === "string" ? parsed.scrapeInterval : DEFAULT_SETTINGS.scrapeInterval,
        targets: Array.isArray(parsed.targets) ? parsed.targets : [],
      };
    } catch (err) {
      console.warn(`[SettingsStore] Failed to load settings, using defaults:`, err);
      return { ...DEFAULT_SETTINGS };
    }
  }

  /**
   * 設定をJSONファイルに書き込む
   */
  save(settings: Settings): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(settings, null, 2), "utf-8");
      console.log(`[SettingsStore] Settings saved to ${this.filePath}`);
    } catch (err) {
      console.error(`[SettingsStore] Failed to save settings:`, err);
    }
  }
}
