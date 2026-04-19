import { type WebSocket, WebSocketServer } from 'ws';
import type { Orchestrator, OrchestratorEvent } from './orchestrator.js';

export interface DemoServerOptions {
  orchestrator: Orchestrator;
  port?: number;
}

export interface DemoServer {
  readonly port: number;
  close(): Promise<void>;
}

interface WireEvent {
  type: string;
  payload: unknown;
  at: string;
}

function serialize(event: OrchestratorEvent): WireEvent {
  if (event.type === 'entangle') {
    return {
      type: event.payload.type,
      payload: event.payload,
      at: event.at.toISOString(),
    };
  }
  return {
    type: event.payload.type,
    payload: event.payload,
    at: event.at.toISOString(),
  };
}

export function createDemoServer(options: DemoServerOptions): DemoServer {
  const port = options.port ?? 8787;
  const wss = new WebSocketServer({ port });
  const clients = new Set<WebSocket>();

  const broadcast = (event: OrchestratorEvent): void => {
    const payload = JSON.stringify(serialize(event));
    for (const client of clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  };

  const unsubscribe = options.orchestrator.onEvent(broadcast);

  wss.on('connection', (ws: WebSocket) => {
    clients.add(ws);
    const snapshot = options.orchestrator.snapshot();
    for (const event of snapshot) {
      ws.send(JSON.stringify(serialize(event)));
    }
    ws.on('close', () => {
      clients.delete(ws);
    });
    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  const close = (): Promise<void> => {
    unsubscribe();
    return new Promise((resolve, reject) => {
      for (const client of clients) {
        try {
          client.close();
        } catch {
          // ignore
        }
      }
      clients.clear();
      wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  };

  return { port, close };
}
