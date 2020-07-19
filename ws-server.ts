// Copyright 2018-2020 the Deno authors. All rights reserved. MIT license.
import { serve } from 'https://deno.land/std/http/server.ts';
import {
  acceptWebSocket,
  isWebSocketCloseEvent,
  isWebSocketPingEvent,
  WebSocket,
} from 'https://deno.land/std/ws/mod.ts';

class User {
  public id: number;
  public name: string;

  constructor(name = '') {
    this.id = id++;
    this.name = name;
  }
}

const socks = new Map<number, WebSocket>();

let id = 0;
const users = new Map<number, User>();

async function handleWs(sock: WebSocket) {
  try {
    for await (const ev of sock) {
      if (typeof ev === 'string') {
        const req = parseJSON(ev);
        switch (req.type) {
          case 'register': {
            const user = new User(req.name);
            socks.set(user.id, sock);
            users.set(user.id, user);
            response(sock, req, { id: user.id, users: [...users.values()] });
            broadcast({ type: 'online', user });
            break;
          }

          case 'unregister': {
            users.delete(req.id);
            response(sock, req, { code: 200 });
            broadcast({ type: 'offline', id: req.id });
            break;
          }

          case 'update': {
            const user = users.get(req.id);
            if (user) {
              user.name = req.name;
              response(sock, req, { code: 200 });
              broadcast({ type: 'update', user });
            } else {
              response(sock, req, { code: 404 });
            }
            break;
          }

          // 通信中转
          case 'offer':
          case 'answer':
          case 'candidate': {
            const targetSock = socks.get(req.toId);
            response(sock, req, { code: targetSock ? 200 : 404 });
            if (targetSock) {
              delete req._t;
              response(targetSock, null, req);
            }
            break;
          }
        }
      } else if (isWebSocketCloseEvent(ev)) {
        const { code, reason } = ev;
        console.log('ws:Close', code, reason);
        for (let id of socks.keys()) {
          if (socks.get(id) === sock) {
            socks.delete(id);
          }
        }
      }
    }
  } catch (err) {
    console.error(`failed to receive frame: ${err}`);

    if (!sock.isClosed) {
      await sock.close(1000).catch(console.error);
    }
  }
}

if (import.meta.main) {
  /** websocket echo server */
  const port = Deno.args[0] || '8081';
  console.log(`websocket server is running on :${port}`);
  for await (const req of serve(`:${port}`)) {
    const { conn, r: bufReader, w: bufWriter, headers } = req;
    acceptWebSocket({
      conn,
      bufReader,
      bufWriter,
      headers,
    })
      .then(handleWs)
      .catch(async (err: any) => {
        console.error(`failed to accept websocket: ${err}`);
        await req.respond({ status: 400 });
      });
  }
}

function parseJSON(str: string) {
  try {
    return JSON.parse(str);
  } catch (error) {
    return {};
  }
}

function broadcast(msg: Object) {
  console.log('broadcast', msg);
  socks.forEach(sock => response(sock, null, msg));
}

function response(sock: WebSocket, req: Object | null, msg: Object) {
  try {
    // @ts-ignore
    if (req) msg._t = req._t;
    sock.send(JSON.stringify(msg));
  } catch (error) {
    console.log('TCL: response -> error', error);
  }
}
