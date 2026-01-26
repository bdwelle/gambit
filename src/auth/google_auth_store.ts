import * as path from "@std/path";
import { ensureDir } from "@std/fs";

export type OAuthAuthDetails = {
  type: "oauth";
  refresh: string;
  access?: string;
  expires?: number;
  email?: string;
  projectId?: string;
};

export type AuthState = {
  google?: OAuthAuthDetails;
};

function resolveHomeDir(): string {
  const fromHome = Deno.env.get("HOME");
  if (fromHome && fromHome.length > 0) return fromHome;

  const fromProfile = Deno.env.get("USERPROFILE");
  if (fromProfile && fromProfile.length > 0) return fromProfile;

  const drive = Deno.env.get("HOMEDRIVE");
  const pathPart = Deno.env.get("HOMEPATH");
  if (drive && pathPart) return `${drive}${pathPart}`;

  return "";
}

const AUTH_DIR = path.join(resolveHomeDir() || ".", ".config", "gambit");
const AUTH_PATH = path.join(AUTH_DIR, "auth.json");

export async function readAuthState(): Promise<AuthState> {
  try {
    const text = await Deno.readTextFile(AUTH_PATH);
    const data = JSON.parse(text) as AuthState;
    return data ?? {};
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return {};
    throw err;
  }
}

export async function writeAuthState(state: AuthState): Promise<void> {
  await ensureDir(AUTH_DIR);
  const payload = JSON.stringify(state, null, 2);
  await Deno.writeTextFile(AUTH_PATH, `${payload}\n`);
}

export function getAuthPath(): string {
  return AUTH_PATH;
}
