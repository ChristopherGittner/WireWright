// MCP live mode: an MCP server (Streamable HTTP, 127.0.0.1 only, bearer token) whose tools work on
// the project open in the editor window. Each tool call gets the window's current state, runs on
// a copy, and hands the changes back as one undo step ("AI (MCP)"), so the drawing updates at
// once and Ctrl+Z undoes what the assistant did. See docs/mcp.md, "Live mode".
import { MapLibrary, ProjectDocument, type Library, type LibraryContent, type ProjectState } from '@wirewright/core';
import { standardLibraryContent } from '@wirewright/library';
import { createWirewrightServer, ToolError, type ProjectSessionLike } from '@wirewright/mcp-server';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';

export const DEFAULT_MCP_PORT = 3920;

/** What the editor window offers to the live session. */
export interface LiveBridge {
  /** The open project, or null when none is open. */
  state(): Promise<{ state: ProjectState; folder?: string } | null>;
  /** Applies changes (Immer patches of the state) as one undo step. */
  apply(label: string, patches: unknown[], inverse: unknown[]): Promise<void>;
  /** The shared library folder's content, if one is set. */
  sharedLibrary(): Promise<LibraryContent | null>;
}

export class LiveSession implements ProjectSessionLike {
  #queue: Promise<unknown> = Promise.resolve();
  #root: string | undefined;

  constructor(private readonly bridge: LiveBridge) {}

  get root(): string | undefined {
    return this.#root;
  }

  async library(): Promise<Library> {
    const shared = await this.bridge.sharedLibrary().catch(() => null);
    return new MapLibrary(standardLibraryContent(), ...(shared ? [shared] : []));
  }

  run<T>(fn: (doc: ProjectDocument) => T): Promise<T> {
    // One tool call at a time, each on the state the previous one left.
    const next = this.#queue.then(async () => {
      const open = await this.bridge.state();
      if (!open) throw new ToolError('No project is open in the Wirewright desktop app. Open one there first.');
      this.#root = open.folder;
      const doc = new ProjectDocument(open.state, await this.library());
      const before = doc.historyLength;
      const result = fn(doc);
      const { patches, inverse } = doc.stepsSince(before);
      if (patches.length > 0) await this.bridge.apply('AI (MCP)', patches, inverse);
      return result;
    });
    this.#queue = next.catch(() => undefined);
    return next;
  }
}

export interface LiveServerStatus {
  running: boolean;
  url: string;
  error?: string;
}

/** The HTTP server; started and stopped from the machine settings. */
export class LiveMcpServer {
  #server: Server | undefined;
  #status: LiveServerStatus = { running: false, url: '' };

  constructor(
    private readonly session: LiveSession,
    private readonly token: string,
  ) {}

  get status(): LiveServerStatus {
    return this.#status;
  }

  async start(port: number): Promise<LiveServerStatus> {
    await this.stop();
    const url = `http://127.0.0.1:${port}/mcp`;
    const server = createServer((req, res) => {
      void this.#handle(req).then(
        async (handler) => {
          if (typeof handler === 'number') {
            res.writeHead(handler, { 'content-type': 'text/plain' }).end(httpText(handler));
            return;
          }
          await handler(res);
        },
        (error: unknown) => {
          if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' }).end((error as Error).message);
        },
      );
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '127.0.0.1', () => resolve());
      });
    } catch (error) {
      this.#status = { running: false, url, error: (error as Error).message };
      return this.#status;
    }
    this.#server = server;
    this.#status = { running: true, url };
    return this.#status;
  }

  async stop(): Promise<void> {
    const server = this.#server;
    this.#server = undefined;
    this.#status = { running: false, url: this.#status.url };
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  /** A status code for refused requests, or the handler of an MCP request. */
  async #handle(req: IncomingMessage): Promise<number | ((res: import('node:http').ServerResponse) => Promise<void>)> {
    if ((req.url ?? '').split('?')[0] !== '/mcp') return 404;
    // Only local clients that name a local host (no DNS rebinding) and know the token.
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) return 403;
    if (!this.#authorized(req.headers.authorization)) return 401;
    if (req.method !== 'POST') return 405;
    const body = await readJson(req);
    return async (res) => {
      // Stateless: a fresh server and transport per request, all on the same live session.
      const mcp = createWirewrightServer({ session: this.session, library: await this.session.library() });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        void transport.close();
        void mcp.close();
      });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body);
    };
  }

  #authorized(header: string | undefined): boolean {
    const expected = Buffer.from(`Bearer ${this.token}`);
    const given = Buffer.from(header ?? '');
    return given.length === expected.length && timingSafeEqual(given, expected);
  }
}

function httpText(status: number): string {
  return { 401: 'Unauthorized: send "Authorization: Bearer <token>" (see Machine settings)', 403: 'Forbidden', 404: 'Not found: the MCP endpoint is /mcp', 405: 'Method not allowed' }[status] ?? String(status);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 10 * 1024 * 1024) throw new Error('Request too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}
