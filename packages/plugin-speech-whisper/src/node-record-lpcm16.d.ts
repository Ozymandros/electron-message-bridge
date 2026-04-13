declare module 'node-record-lpcm16' {
  export function record(options?: Record<string, unknown>): {
    stream(): NodeJS.ReadableStream;
    stop(): void;
    pause(): void;
    resume(): void;
  };
}
