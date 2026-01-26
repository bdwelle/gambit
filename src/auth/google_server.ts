import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { GEMINI_REDIRECT_URI } from "./google_constants.ts";

export interface OAuthListener {
  waitForCallback(): Promise<URL>;
  close(): Promise<void>;
}

const redirectUrl = new URL(GEMINI_REDIRECT_URI);
const LISTEN_PORT = Number(redirectUrl.port) || 8085;
const LISTEN_HOST = redirectUrl.hostname || "localhost";

export async function startOAuthListener(): Promise<OAuthListener> {
  const controller = new AbortController();
  let resolveCallback: ((url: URL) => void) | null = null;

  const callbackPromise = new Promise<URL>((resolve) => {
    resolveCallback = resolve;
  });

  const handler = (_req: Request) => {
    const url = new URL(_req.url);
    if (url.pathname !== redirectUrl.pathname) {
      return new Response("Not Found", { status: 404 });
    }
    resolveCallback?.(url);
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>You're connected to Gambit</title>
    <style>
      body { font-family: "Google Sans", "Noto Sans", Arial, sans-serif; background:#0f1015; color:#fff; margin:0; display:flex; height:100vh; align-items:center; justify-content:center; }
      .card { background:#12131a; border-radius:20px; padding:32px; max-width:440px; box-shadow:0 20px 45px rgba(0,0,0,.35); }
      .logo { height:42px; }
      h1 { font-size:2rem; margin:16px 0 8px; }
      p { line-height:1.5; color:#d0d2db; }
      .button { margin-top:20px; display:inline-flex; align-items:center; justify-content:center; padding:10px 24px; border-radius:999px; background:#60a5ff; color:#0b0d14; font-weight:600; text-decoration:none; }
      .note { margin-top:24px; font-size:.9rem; color:#8b8ea3; }
    </style>
  </head>
  <body>
    <div class="card">
      <img class="logo" src="https://www.gstatic.com/images/branding/product/1x/googleg_32dp.png" alt="Google logo" />
      <h1>You're connected to Gambit</h1>
      <p>Your Google account is now linked to Gambit. Return to the CLI to continue.</p>
      <a class="button" href="#" onclick="window.close(); return false;">Close window</a>
      <p class="note">Need to reconnect later? Run <code>gambit auth google</code> again.</p>
    </div>
  </body>
</html>`;
    return new Response(html, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  };

  const serverPromise = serve(handler, {
    hostname: LISTEN_HOST,
    port: LISTEN_PORT,
    signal: controller.signal,
  });

  return {
    waitForCallback: () => callbackPromise,
    close: async () => {
      controller.abort();
      await serverPromise.catch(() => {});
    },
  };
}
