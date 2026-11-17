// Compile-time structural boundary for the exact browser APIs used by the harness.
// This is not a replacement implementation, installed dependency, or runtime shim.
export interface Handle<T> {
  evaluate<R, A = undefined>(
    callback: (value: T, argument: A) => R | Promise<R>,
    argument?: A,
  ): Promise<Awaited<R>>;
  dispose(): Promise<void>;
}
export interface Locator {
  evaluate<R, A = undefined>(
    callback: (value: HTMLElement, argument: A) => R | Promise<R>,
    argument?: A,
  ): Promise<Awaited<R>>;
  innerText(): Promise<string>;
  textContent(): Promise<string | null>;
  getAttribute(name: string): Promise<string | null>;
  isDisabled(): Promise<boolean>;
  isVisible(): Promise<boolean>;
  count(): Promise<number>;
  focus(): Promise<void>;
  click(): Promise<void>;
  first(): Locator;
  evaluateHandle<T>(callback: (element: HTMLElement) => T): Promise<Handle<T>>;
}
export interface Page {
  evaluate<R, A = undefined>(
    callback: (argument: A) => R | Promise<R>,
    argument?: A,
  ): Promise<Awaited<R>>;
  locator(selector: string): Locator;
  goto(url: string): Promise<unknown>;
  close(): Promise<void>;
  setDefaultTimeout(timeout: number): void;
  waitForSelector(selector: string): Promise<unknown>;
  waitForFunction(callback: () => unknown): Promise<unknown>;
  addStyleTag(options: { content: string }): Promise<Handle<HTMLStyleElement>>;
  keyboard: { press(key: string): Promise<void> };
}
export interface Session {
  send(method: "Page.getLayoutMetrics"): Promise<{
    visualViewport: { zoom?: number };
    contentSize: { width: number; height: number };
    layoutViewport: { clientWidth: number; clientHeight: number };
  }>;
  send(
    method: "Page.captureScreenshot",
    options: {
      format: "png";
      fromSurface: boolean;
      captureBeyondViewport: boolean;
      clip?: {
        x: number;
        y: number;
        width: number;
        height: number;
        scale: number;
      };
    },
  ): Promise<{ data: string }>;
}
export interface Context {
  newPage(): Promise<Page>;
  pages(): Page[];
  close(): Promise<void>;
  newCDPSession(page: Page): Promise<Session>;
  browser(): { version(): string } | null;
  route(
    pattern: string,
    handler: (route: {
      request(): { url(): string };
      continue(): Promise<void>;
      abort(): Promise<void>;
    }) => Promise<void>,
  ): Promise<void>;
}
export interface Chromium {
  launchPersistentContext(
    profile: string,
    options: {
      executablePath: string;
      chromiumSandbox: boolean;
      headless: boolean;
      viewport: null;
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
export interface Effects {
  subscriptions: number;
  closes: number;
  snapshots: number;
  passive: number;
  control: number;
}
export interface Pixels {
  size: number[];
  rgb_sha256: string;
  color_count_lower_bound: number;
}
export interface Metrics {
  cssZoom: string;
  visualViewportScale: number;
  outerWidth: number;
  innerWidth: number;
  dpr: number;
}
export interface Actual extends Metrics {
  innerHeight: number;
  outerHeight: number;
  overflow: string[];
  actions: { disabled: boolean; reason: string | null }[];
  contrast: { tag: string; ratio: number; minimum: number }[];
}
export interface Capture {
  mode: string;
  zoom: number;
  expected: { width: number; height: number };
  coordinate_space: string;
}
export interface Interactions {
  focus?: { file: string; pixels: Pixels; capture: Capture };
  dialog?: string;
  late_response?: string;
  history?: string;
  effects?: Effects;
}
export interface Shot {
  actual: Actual;
  file: string;
  pixels: Pixels;
  capture: Capture;
  png_sha256: string;
  interactions?: Interactions;
}
export interface Case {
  requested_window_width: number;
  zoom_percent: number;
  repeat: number;
  actual: Actual;
  captures: Record<string, Shot>;
  browser_version: string | undefined;
  preferences_sha256: string;
  native_preferences: { partition: { default_zoom_level: { x: number } } };
  actual_browser_argv: string;
  sandbox_disable_flags_absent: boolean;
  clipping_mutant?: string;
  removed_note_mutant?: string;
  label_mutant?: string;
  action_mutant?: string;
  reason_mutant?: string;
  pixel_mutant?: string;
  component_assertions?: {
    projection: number;
    navigation: number;
    keyboard: string;
  };
}
declare global {
  var runAssertions: () => Promise<{ projection: number; navigation: number }>;
  var keyboardReceipt: {
    subscriptions: number;
    closes: number;
    passive: number;
    trusted: boolean[];
  };
  var keyboardNavigator: ReturnType<
    typeof import("../src/navigation.js").createTaskNavigator
  >;
  var createStreamProjection: typeof import("../src/stream.js").createStreamProjection;
  var createTaskNavigator: typeof import("../src/navigation.js").createTaskNavigator;
  var createBrowserTaskHistory: typeof import("../src/navigation.js").createBrowserTaskHistory;
  const consoleScenarios: typeof import("../fixtures/console-ui/scenarios.js").consoleScenarios;
  const consoleTaskCatalog: typeof import("../fixtures/console-ui/scenarios.js").consoleTaskCatalog;
  var consoleVisual: {
    select(id: string): Promise<boolean>;
    state(): { effects: Effects; projection: { identity: { task: string } } };
  };
}
