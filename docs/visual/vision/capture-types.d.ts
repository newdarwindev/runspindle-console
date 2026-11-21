import type {
  Page as VisualPage,
  Context as VisualContext,
  Locator,
} from "../../../tools/console-visual-browser-types.js";

export interface Scenario {
  id: string;
  width: number;
  height: number;
  zoom: 100 | 200;
}
export type Subject = "reference" | "canonical";
export interface Manifest {
  cases: Scenario[];
  sections: ({ id: string; source?: string } & Record<Subject, string>)[];
  assets: Record<string, string>;
  expected: Record<Subject, string[]>;
  navigation: {
    skip: string;
    local: string[];
    external: string[];
    unavailable: string[];
  };
}
export interface Page extends VisualPage {
  locator(selector: string): Locator & { ariaSnapshot(): Promise<string> };
  hover(selector: string): Promise<void>;
  url(): string;
  waitForURL(url: string): Promise<void>;
}
export interface Context extends VisualContext {
  pages(): Page[];
  newPage(): Promise<Page>;
}
export interface Chromium {
  launchPersistentContext(
    profile: string,
    options: {
      executablePath: string;
      chromiumSandbox: boolean;
      headless: boolean;
      viewport: { width: number; height: number } | null;
      deviceScaleFactor?: number;
      locale: string;
      timezoneId: string;
      colorScheme: "light";
      reducedMotion: "reduce";
      offline: boolean;
      timeout: number;
      args: string[];
    },
  ): Promise<Context>;
}
