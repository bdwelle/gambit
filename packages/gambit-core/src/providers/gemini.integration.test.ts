import { assert, assertEquals } from "@std/assert";
import { createGeminiProvider } from "./gemini.ts";

const apiKey = Deno.env.get("GOOGLE_API_KEY");
const oauthToken = Deno.env.get("GOOGLE_ACCESS_TOKEN");
const projectId = Deno.env.get("GEMINI_PROJECT_ID") ??
  Deno.env.get("GOOGLE_CLOUD_PROJECT");

const useApiKey = Boolean(apiKey && !oauthToken);
const useOAuth = Boolean(oauthToken && projectId);

// Only run these tests if the required creds are present
const test = (useApiKey || useOAuth) ? Deno.test : Deno.test.ignore;

test("Gemini integration: basic chat", async () => {
  if (useOAuth) {
    Deno.env.set("GEMINI_PROJECT_ID", projectId ?? "");
  }
  const provider = createGeminiProvider({ apiKey: apiKey ?? "unused" });
  const result = await provider.chat({
    model: "gemini-2.5-flash",
    messages: [{ role: "user", content: "Say 'hello world' and nothing else." }],
  });

  assertEquals(result.message.role, "assistant");
  assert(result.message.content !== null, "Content should not be null");
  assert(result.message.content!.toLowerCase().includes("hello"));
  assertEquals(result.finishReason, "stop");
});

test("Gemini integration: streaming chat", async () => {
  if (useOAuth) {
    Deno.env.set("GEMINI_PROJECT_ID", projectId ?? "");
  }
  const provider = createGeminiProvider({ apiKey: apiKey ?? "unused" });
  const chunks: string[] = [];
  
  const result = await provider.chat({
    model: "gemini-2.5-flash",
    messages: [{ role: "user", content: "Count to 5." }],
    stream: true,
    onStreamText: (chunk) => chunks.push(chunk),
  });

  assertEquals(result.message.role, "assistant");
  assert(result.message.content !== null, "Content should not be null");
  assert(chunks.length > 0, "Should have received stream chunks");
  assertEquals(chunks.join(""), result.message.content);
});
