declare module "cloudflare:workers" {
  export const env: {
    DB: D1Database;
    ASSETS?: Fetcher;
    FILES?: R2Bucket;
    [key: string]: unknown;
  };
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

interface R2ObjectBody {
  body: ReadableStream;
  httpMetadata?: { contentType?: string };
  size: number;
}

interface R2Bucket {
  put(key: string, value: ArrayBuffer | ReadableStream, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  delete(key: string): Promise<void>;
}

interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: Record<string, unknown>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
  dump(): Promise<ArrayBuffer>;
}
