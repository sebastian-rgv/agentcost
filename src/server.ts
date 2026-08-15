import { createServer } from "node:http";
import type { Command } from "commander";
import { appendStore, loadStore } from "./store";
import { sessionStatus, listSessions } from "./session";
import { buildReport } from "./report";
import { loadPolicies, loadAlertConfig } from "./store";
import type { StoreEntry } from "./types";

function json(response: import("node:http").ServerResponse, value: unknown, status = 200): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(body);
}

function readBody(request: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => resolvePromise(body));
    request.on("error", reject);
  });
}

export function dashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>agentcost dashboard</title>
<style>
  body{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#0d1117;color:#e6edf3;margin:0;padding:24px}
  h1{font-size:20px} h2{font-size:15px;margin-top:28px;color:#79c0ff}
  table{border-collapse:collapse;margin-top:8px;font-size:13px}
  th,td{text-align:left;padding:6px 14px 6px 0;border-bottom:1px solid #21262d}
  th{color:#8b949e;font-weight:600}
  .cost{color:#3fb950}.warn{color:#d29922}.over{color:#f85149}
  .cards{display:flex;gap:16px;margin-top:12px}
  .card{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:14px 18px}
  .card b{font-size:22px;display:block}
</style>
</head>
<body>
<h1>agentcost dashboard</h1>
<div class="cards" id="cards"></div>
<h2>Spending by model (month)</h2>
<table id="models"></table>
<h2>Active sessions</h2>
<table id="sessions"></table>
<h2>Trend (last 7 days)</h2>
<table id="trend"></table>
<script>
const money=(v)=>v===null?'n/a':'$'+Number(v).toFixed(4);
const table=(el,headers,rows,colorFn)=>{el.innerHTML='<tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr>'+rows.map((r,i)=>'<tr>'+r.map((c,j)=>{const cls=colorFn?colorFn(i,j):'';return '<td class="'+cls+'">'+c+'</td>';}).join('')).join('')+'<tr>';};
async function load(){
  const report=await (await fetch('/api/report')).json();
  const sessions=await (await fetch('/api/sessions')).json();
  const cards=document.getElementById('cards');
  cards.innerHTML='<div class="card"><span>Total calls</span><b>'+report.total.calls.toLocaleString()+'</b></div>'
    +'<div class="card"><span>Cost</span><b class="cost">'+money(report.total.cost)+'</b></div>'
    +'<div class="card"><span>Active sessions</span><b>'+sessions.filter(s=>s.active).length+'</b></div>';
  table(document.getElementById('models'),['Model','Calls','Cost'],[
    ['Total',report.total.calls.toLocaleString(),money(report.total.cost)],
    ...report.byModel.map(m=>[m.key,m.calls.toLocaleString(),money(m.cost)])
  ],(_i,j)=>j===2?'cost':'');
  table(document.getElementById('sessions'),['ID','Project','Spent','Limit','Percent','State'],
    sessions.map(s=>[s.id,s.project,money(s.spent),money(s.limit),Number.isFinite(s.percent)?s.percent.toFixed(1)+'%':'over',
      (s.active?'active':'ended')+(s.blocked?', blocked':'')]),
    (i,j)=>j===4?(sessions[i].level==='over'?'over':sessions[i].level==='warning'?'warn':''):'');
  table(document.getElementById('trend'),['Date','Calls','Cost'],
    report.trend.map(t=>[t.date,t.calls.toLocaleString(),money(t.cost)]),(_i,j)=>j===2?'cost':'');
}
load();
setInterval(load,5000);
</script>
</body>
</html>`;
}

export interface ServerOptions {
  host: string;
  port: number;
  peers?: string[];
}

export interface ServerHandle {
  close: () => Promise<void>;
  url: string;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${url}`);
  return response.json() as Promise<unknown>;
}

export async function startServer(options: ServerOptions): Promise<ServerHandle> {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    try {
      if (url.pathname === "/" || url.pathname === "/dashboard") {
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        response.end(dashboardHtml());
        return;
      }
      if (url.pathname === "/api/store") {
        json(response, loadStore());
        return;
      }
      if (url.pathname === "/api/sessions") {
        json(response, sessionStatus(listSessions(), loadStore()));
        return;
      }
      if (url.pathname === "/api/report") {
        json(response, buildReport(loadStore(), { period: "month" }));
        return;
      }
      if (url.pathname === "/api/policies") {
        json(response, loadPolicies());
        return;
      }
      if (url.pathname === "/api/alerts") {
        json(response, loadAlertConfig());
        return;
      }
      if (url.pathname === "/api/peers") {
        const results: { url: string; report?: unknown; error?: string }[] = [];
        for (const peer of options.peers ?? []) {
          try {
            results.push({ url: peer, report: await fetchJson(`${peer}/api/report`) });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            results.push({ url: peer, error: message });
          }
        }
        json(response, results);
        return;
      }
      if (url.pathname === "/health") {
        json(response, { ok: true, time: new Date().toISOString() });
        return;
      }
      if (url.pathname === "/api/store/push" && (request.method === "POST" || request.method === "PUT")) {
        const body = await readBody(request);
        const entry = JSON.parse(body) as Partial<StoreEntry>;
        if (typeof entry.model !== "string" || typeof entry.inputTokens !== "number" || typeof entry.outputTokens !== "number") {
          json(response, { error: "entry must include model, inputTokens and outputTokens" }, 400);
          return;
        }
        appendStore({
          ts: entry.ts ?? new Date().toISOString(),
          model: entry.model,
          provider: entry.provider ?? "unknown",
          inputTokens: entry.inputTokens,
          outputTokens: entry.outputTokens,
          cost: entry.cost ?? null,
          project: entry.project,
          agent: entry.agent,
          sessionId: entry.sessionId,
          task: entry.task,
          kind: entry.kind,
          toolCalls: entry.toolCalls,
          latencyMs: entry.latencyMs,
          contextWindow: entry.contextWindow,
        });
        json(response, { ok: true });
        return;
      }
      json(response, { error: "not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(response, { error: message }, 500);
    }
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolvePromise());
  });

  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : options.port;
  return {
    url: `http://${options.host}:${port}`,
    close: () =>
      new Promise<void>((resolvePromise) => server.close(() => resolvePromise())),
  };
}

export function attachServerCommand(program: Command): void {
  program
    .command("server")
    .description("Serve the local store over HTTP with a web dashboard")
    .option("--host <host>", "bind host", "0.0.0.0")
    .option("--port <port>", "bind port", "8080")
    .option("--peers <urls>", "comma-separated peer server URLs to aggregate reports from")
    .action(async (options: { host?: string; port?: string; peers?: string }) => {
      const port = parseInt(options.port ?? "8080", 10);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        process.stderr.write(`Invalid --port value: '${options.port}'.\n`);
        process.exitCode = 1;
        return;
      }
      const peers = options.peers
        ?.split(",")
        .map((peer) => peer.trim())
        .filter((peer) => peer.length > 0);
      const handle = await startServer({
        host: options.host ?? "0.0.0.0",
        port,
        peers,
      });
      process.stdout.write(`agentcost server running at ${handle.url}\n`);
      process.stdout.write("Dashboard: open /dashboard in a browser.\n");
      process.stdout.write("API: /api/store, /api/sessions, /api/report, /api/policies, /api/alerts, /api/peers\n");
      if (peers && peers.length > 0) {
        process.stdout.write(`Peers: ${peers.join(", ")}\n`);
      }
      process.stdout.write("Ctrl+C to stop.\n");
      const stop = async (): Promise<void> => {
        await handle.close();
        process.exit(0);
      };
      process.on("SIGINT", () => void stop());
      process.on("SIGTERM", () => void stop());
    });
}