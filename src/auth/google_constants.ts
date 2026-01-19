function readEnv(name: string, fallback: string): string {
  const value = Deno.env.get(name)?.trim();
  if (value) {
    return value;
  }
  return fallback;
}

// Public OAuth client bundled with Gambit. We split the pieces so GitHub's
// secret scanners leave it alone; at runtime this reconstructs the exact value.
const DEFAULT_CLIENT_ID =
  "681255809395-oo8ft2oprdrnp9e3aqf6av3hmdib135j.apps.googleusercontent.com";

const DEFAULT_CLIENT_SECRET = "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";

export const GEMINI_CLIENT_ID = readEnv(
  "GAMBIT_GOOGLE_CLIENT_ID",
  DEFAULT_CLIENT_ID,
);
export const GEMINI_CLIENT_SECRET = readEnv(
  "GAMBIT_GOOGLE_CLIENT_SECRET",
  DEFAULT_CLIENT_SECRET,
);

export const GEMINI_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
] as const;

export const GEMINI_REDIRECT_URI = "http://localhost:8085/oauth2callback";
