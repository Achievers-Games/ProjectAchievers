declare global {
  interface Window {
    __TAURI__: {
      invoke: <T = unknown>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
      [key: string]: unknown;
    };
    __TAURI_METADATA__?: unknown;
  }
}

export {};
