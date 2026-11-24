import { initSentry, Sentry } from './sentry.js';
initSentry();

import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import cors from 'cors';
import express from 'express';
import { createShopMcpServer, loadShopById } from './puls-mcp.js';
import { getDb } from './db.js';
import { recordShopMcpInit } from './redis-stats.js';
import { logger, serializeError } from './logger.js';
import {
  extractBearer,
  getAuthServerMetadata,
  getProtectedResourceMetadata,
  parseDisabledTools,
  send401WithChallenge,
  validateBearer,
} from './oauth/index.js';

type Session = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
};

const shopSessions: Record<string, Session> = {};

const app = express();

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'Mcp-Session-Id',
      'mcp-protocol-version',
      'Last-Event-ID',
    ],
    exposedHeaders: ['Mcp-Session-Id', 'WWW-Authenticate'],
  })
);

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/version', (_req, res) => {
  res.json({
    name: 'puls-mcp-server',
    version: process.env.APP_VERSION || 'development',
    buildTime: process.env.BUILD_TIME || null,
  });
});

app.get('/.well-known/oauth-protected-resource', getProtectedResourceMetadata);
app.get(
  '/.well-known/oauth-protected-resource/*',
  getProtectedResourceMetadata
);
app.get('/.well-known/oauth-authorization-server', getAuthServerMetadata);

function jsonRpcError(
  res: express.Response,
  status: number,
  code: number,
  message: string
): void {
  res.status(status).json({
    jsonrpc: '2.0',
    error: { code, message },
    id: null,
  });
}

async function streamableMcpRequest(
  req: express.Request,
  res: express.Response,
  sessionsRecord: Record<string, Session>,
  createServer: () => Promise<McpServer>
): Promise<void> {
  try {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && sessionsRecord[sessionId]) {
      await sessionsRecord[sessionId].transport.handleRequest(
        req,
        res,
        req.body
      );
      return;
    }

    if (sessionId && !sessionsRecord[sessionId]) {
      jsonRpcError(
        res,
        404,
        -32002,
        'Session not found. The server may have restarted. Please reconnect.'
      );
      return;
    }

    if (req.method === 'POST' && isInitializeRequest(req.body)) {
      const mcpServer = await createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessionsRecord[id] = { transport, server: mcpServer };
        },
        onsessionclosed: (id) => {
          delete sessionsRecord[id];
        },
      });
      transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) delete sessionsRecord[sid];
      };
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    jsonRpcError(
      res,
      400,
      -32002,
      'Invalid or missing session. Send an initialize request first.'
    );
  } catch (err) {
    logger.error(
      {
        err: serializeError(err),
        url: req.originalUrl,
        method: req.method,
        sessionId: req.headers['mcp-session-id'],
      },
      'streamableMcpRequest failed'
    );
    Sentry.captureException(err, {
      tags: { component: 'streamableMcpRequest' },
      extra: { url: req.originalUrl, method: req.method },
    });
    if (!res.headersSent) {
      jsonRpcError(res, 500, -32603, 'Internal server error');
    }
  }
}

/**
 * MCP endpoint: `/mcp`. Resolves shop and tool permissions from the Bearer
 * token issued by the OAuth flow. No shop id in the URL.
 */
async function handleMcp(req: express.Request, res: express.Response) {
  try {
    const db = getDb();

    const bearer = extractBearer(req);
    if (!bearer) {
      send401WithChallenge(req, res);
      return;
    }

    const authed = await validateBearer(db, bearer);
    if (!authed) {
      send401WithChallenge(
        req,
        res,
        'invalid_token',
        'Bearer token is invalid, expired, or revoked.'
      );
      return;
    }

    const shop = await loadShopById(db, authed.shopId);
    if (!shop) {
      jsonRpcError(res, 404, -32002, 'Shop bound to this token no longer exists');
      return;
    }

    if ((shop as unknown as { status?: string }).status === 'PAUSED') {
      jsonRpcError(
        res,
        402,
        -32002,
        'Shop je pozastaven (trial expired nebo neaktivní plán). Aktivujte plán na pulsmcp.com.'
      );
      return;
    }

    if (req.method === 'POST' && req.body && isInitializeRequest(req.body)) {
      void recordShopMcpInit(shop.id);
    }

    const disabled = parseDisabledTools(authed.disabledTools);
    await streamableMcpRequest(req, res, shopSessions, async () =>
      createShopMcpServer(shop, db, disabled)
    );
  } catch (err) {
    logger.error(
      {
        err: serializeError(err),
        url: req.originalUrl,
        method: req.method,
      },
      'handleMcp failed'
    );
    Sentry.captureException(err, {
      tags: { component: 'handleMcp' },
      extra: { url: req.originalUrl, method: req.method },
    });
    if (!res.headersSent) {
      jsonRpcError(res, 500, -32603, 'Internal server error');
    }
  }
}

app.post('/mcp', handleMcp);
app.get('/mcp', handleMcp);
app.delete('/mcp', handleMcp);

const port = Number(process.env.PORT ?? 3001);
const host = '0.0.0.0';

app.listen(port, host, () => {
  logger.info({ host, port }, 'puls mcp-server listening');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ err: serializeError(reason) }, 'unhandled promise rejection');
  Sentry.captureException(reason, { tags: { component: 'unhandledRejection' } });
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err: serializeError(err) }, 'uncaught exception');
  Sentry.captureException(err, { tags: { component: 'uncaughtException' } });
});
