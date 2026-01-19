import {
  GEMINI_CLIENT_ID,
  GEMINI_CLIENT_SECRET,
} from "./google_constants.ts";
import type { OAuthAuthDetails } from "./google_auth_store.ts";

const ACCESS_TOKEN_EXPIRY_BUFFER_MS = 60_000;

export function accessTokenExpired(auth: OAuthAuthDetails): boolean {
  if (!auth.access || typeof auth.expires !== "number") {
    return true;
  }
  return auth.expires <= Date.now() + ACCESS_TOKEN_EXPIRY_BUFFER_MS;
}

export async function refreshAccessToken(
  auth: OAuthAuthDetails,
): Promise<OAuthAuthDetails | null> {
  if (!auth.refresh) return null;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: GEMINI_CLIENT_ID,
      client_secret: GEMINI_CLIENT_SECRET,
      refresh_token: auth.refresh,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = await response.json() as {
    access_token?: string;
    expires_in?: number;
  };

  if (!payload.access_token) {
    return null;
  }

  return {
    ...auth,
    access: payload.access_token,
    expires: Date.now() + (payload.expires_in ?? 3600) * 1000,
  };
}
