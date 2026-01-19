import { authorizeGemini, exchangeGemini, exchangeGeminiWithVerifier } from "../auth/google_oauth.ts";
import { startOAuthListener } from "../auth/google_server.ts";
import { readAuthState, writeAuthState } from "../auth/google_auth_store.ts";
import { accessTokenExpired, refreshAccessToken } from "../auth/google_token.ts";

const logger = console;

function parseOAuthCallbackInput(input: string): { code?: string; state?: string } {
  const trimmed = input.trim();
  if (!trimmed) return {};

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return {
        code: url.searchParams.get("code") ?? undefined,
        state: url.searchParams.get("state") ?? undefined,
      };
    } catch {
      return {};
    }
  }

  const candidate = trimmed.startsWith("?") ? trimmed.slice(1) : trimmed;
  if (candidate.includes("=")) {
    const params = new URLSearchParams(candidate);
    const code = params.get("code") ?? undefined;
    const state = params.get("state") ?? undefined;
    if (code || state) return { code, state };
  }

  return { code: trimmed };
}

async function promptInput(message: string): Promise<string> {
  const input = prompt(message);
  return input ? input.trim() : "";
}

export async function handleAuthCommand(provider: string | undefined) {
  if (!provider || provider !== "google") {
    logger.error("Usage: gambit auth google");
    return;
  }

  const authorization = await authorizeGemini();
  logger.log("Open this URL in your browser to authenticate:");
  logger.log(authorization.url);

  let listener = null;
  try {
    listener = await startOAuthListener();
    logger.log("Waiting for OAuth callback on http://localhost:8085/oauth2callback ...");
  } catch {
    listener = null;
    logger.log("Could not start local callback listener; paste the callback URL or code manually.");
  }

  let exchangeResult;

  if (listener) {
    try {
      const callbackUrl = await listener.waitForCallback();
      const code = callbackUrl.searchParams.get("code");
      const state = callbackUrl.searchParams.get("state");
      if (!code || !state) {
        logger.error("Missing code or state in callback URL.");
        return;
      }
      exchangeResult = await exchangeGemini(code, state);
    } finally {
      await listener.close();
    }
  } else {
    const manual = await promptInput("> Paste the full redirect URL or authorization code: ");
    const { code, state } = parseOAuthCallbackInput(manual);
    if (!code) {
      logger.error("Missing authorization code.");
      return;
    }
    exchangeResult = state
      ? await exchangeGemini(code, state)
      : await exchangeGeminiWithVerifier(code, authorization.verifier);
  }

  if (exchangeResult.type === "failed") {
    logger.error(`OAuth failed: ${exchangeResult.error}`);
    return;
  }

  const authState = await readAuthState();
  let projectId = await promptInput(
    "> Project ID (required for Gemini Code Assist runs): ",
  );

  if (!projectId) {
    projectId = Deno.env.get("GEMINI_PROJECT_ID") ??
      Deno.env.get("GOOGLE_CLOUD_PROJECT") ??
      Deno.env.get("GOOGLE_PROJECT_ID") ??
      "";
  }

  if (!projectId) {
    logger.error(
      "A Google Cloud project ID is required to call Gemini Code Assist. " +
        "Set GEMINI_PROJECT_ID or enter it during login.",
    );
    await writeAuthState(authState);
    return;
  }

  authState.google = {
    type: "oauth",
    refresh: exchangeResult.refresh,
    access: exchangeResult.access,
    expires: exchangeResult.expires,
    email: exchangeResult.email,
    projectId,
  };
  await writeAuthState(authState);

  logger.log("Google OAuth login saved.");
}

export async function loadGoogleAuthFromStore() {
  const authState = await readAuthState();
  const stored = authState.google;
  if (!stored || stored.type !== "oauth") return null;

  if (accessTokenExpired(stored)) {
    const refreshed = await refreshAccessToken(stored);
    if (!refreshed) {
      return null;
    }
    authState.google = refreshed;
    await writeAuthState(authState);
    return refreshed;
  }

  return stored;
}

