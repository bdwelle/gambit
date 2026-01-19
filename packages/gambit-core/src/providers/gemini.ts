// @ts-ignore: Deno read-only file system
import {
  GoogleGenerativeAI,
  GenerativeModel,
  Content,
  Part,
  FunctionDeclaration,
  FunctionDeclarationSchema,
  FunctionDeclarationSchemaProperty,
  FunctionCallingMode,
  Schema,
  SchemaType,
} from "@google/generative-ai";

const CODE_ASSIST_ENDPOINT = "https://cloudcode-pa.googleapis.com";
const CODE_ASSIST_HEADERS = {
  "User-Agent": "google-api-nodejs-client/9.15.1",
  "X-Goog-Api-Client": "gl-node/22.17.0",
  "Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
} as const;
import type {
  ModelMessage,
  ModelProvider,
} from "../types.ts";

const logger = console;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

type CodeAssistRequest = {
  project: string;
  model: string;
  request: Record<string, unknown>;
};

function logCodeAssistRequest(_body: CodeAssistRequest) {}

type CodeAssistResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<Record<string, unknown>>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
};

function buildCodeAssistRequest(args: {
  projectId: string;
  model: string;
  request: Record<string, unknown>;
}): CodeAssistRequest {
  return {
    project: args.projectId,
    model: args.model,
    request: args.request,
  };
}

function ensureThoughtSignatures(contents: Array<Content>) {
  for (const content of contents) {
    for (const part of content.parts ?? []) {
      const partObj = part as unknown as Record<string, unknown>;
      if (partObj.functionCall && !partObj.thoughtSignature) {
        partObj.thoughtSignature = "skip_thought_signature_validator";
      }
    }
  }
}

function extractTextFromParts(parts: Array<Record<string, unknown>>): string {
  return parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("");
}

function buildCodeAssistChatRequest(args: {
  input: {
    model: string;
    messages: Array<ModelMessage>;
    tools?: Array<import("../types.ts").ToolDefinition>;
    params?: Record<string, unknown>;
  };
  history: Array<Content>;
  userMessage: Content;
  tools?: Array<{ functionDeclarations: FunctionDeclaration[] }>;
  toolConfig: Record<string, unknown> | undefined;
  systemInstruction?: string;
}): Record<string, unknown> {
  const contents = [...args.history, args.userMessage];
  ensureThoughtSignatures(contents);

  const requestPayload: Record<string, unknown> = {
    contents,
  };

  if (args.systemInstruction) {
    requestPayload.systemInstruction = {
      parts: [{ text: args.systemInstruction }],
    };
  }

  if (args.tools) {
    requestPayload.tools = args.tools;
  }

  if (args.toolConfig) {
    requestPayload.toolConfig = args.toolConfig;
  }

  if (args.input.params && Object.keys(args.input.params).length > 0) {
    requestPayload.generationConfig = args.input.params;
  }

  return requestPayload;
}

function extractToolCallsFromParts(parts: Array<Record<string, unknown>>) {
  const toolCalls: ModelMessage["tool_calls"] = [];
  for (const part of parts) {
    const fn = part.functionCall as { name?: string; args?: unknown } | undefined;
    if (!fn?.name) continue;
    toolCalls.push({
      id: `call_${crypto.randomUUID()}`,
      type: "function",
      function: {
        name: fn.name,
        arguments: JSON.stringify(fn.args ?? {}),
      },
    });
  }
  return toolCalls.length > 0 ? toolCalls : undefined;
}

async function parseSseResponse(
  response: Response,
  onText?: (chunk: string) => void,
): Promise<{ text: string; toolCalls?: ModelMessage["tool_calls"]; finishReason?: string }>
{
  if (!response.body) {
    return { text: "" };
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let toolCalls: ModelMessage["tool_calls"] | undefined;
  let finishReason: string | undefined;

  const reader = response.body.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n");
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (line.startsWith("data:")) {
        const json = line.slice(5).trim();
        if (json) {
          try {
            const parsed = JSON.parse(json) as { response?: CodeAssistResponse };
            const payload = parsed.response ?? parsed as unknown as CodeAssistResponse;
            const parts = payload.candidates?.[0]?.content?.parts ?? [];
            const chunkText = extractTextFromParts(parts);
            if (chunkText) {
              fullText += chunkText;
              onText?.(chunkText);
            }
            toolCalls = extractToolCallsFromParts(parts) ?? toolCalls;
            finishReason = payload.candidates?.[0]?.finishReason ?? finishReason;
          } catch {
            // ignore parse errors
          }
        }
      }
      idx = buffer.indexOf("\n");
    }
  }

  return { text: fullText, toolCalls, finishReason };
}

// Maps Gambit's ModelMessage to Google's Content format
export function toGoogleContent(
  messages: ModelMessage[],
  opts: { allowFunctionCalls?: boolean } = {},
): Content[] {
  const allowFunctionCalls = opts.allowFunctionCalls ?? true;
  const history: Content[] = [];
  for (const msg of messages) {
    if (msg.role === "system") continue; // Handled via systemInstruction

    if (msg.role === "tool") {
      if (!allowFunctionCalls) {
        continue;
      }
      history.push({
        role: "user",
        parts: [{
          functionResponse: {
            name: msg.name ?? "tool",
            response: {
              name: msg.name ?? "tool",
              content: msg.content,
            },
          },
        }],
      });
      continue;
    }

    const parts: Part[] = [];
    if (msg.content) {
      parts.push({ text: msg.content });
    }

    if (allowFunctionCalls && msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        parts.push({
          functionCall: {
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          },
        });
      }
    }

    if (parts.length === 0) {
      continue;
    }

    const role = msg.role === "assistant" ? "model" : "user";
    history.push({ role, parts });
  }
  if (history.length > 0 && history[0].role === "model") {
    history.unshift({ role: "user", parts: [{ text: "" }] });
  }
  ensureThoughtSignatures(history);
  return history;
}

export function toGambitToolCalls(
  result: any,
): ModelMessage["tool_calls"] | undefined {
  const functionCalls = typeof result?.response?.functionCalls === "function"
    ? result.response.functionCalls()
    : undefined;

  if (functionCalls && functionCalls.length > 0) {
    return functionCalls.map((fc: { name: string; args: object }) => ({
      id: `call_${crypto.randomUUID()}`,
      type: "function" as const,
      function: {
        name: fc.name,
        arguments: JSON.stringify(fc.args ?? {}),
      },
    }));
  }

  const calls = result?.response?.candidates?.[0]?.content?.parts
    ?.filter((part: Part) => part.functionCall)
    .map((part: Part) => {
      const fc = part.functionCall!;
      return {
        id: `call_${crypto.randomUUID()}`,
        type: "function" as const,
        function: {
          name: fc.name,
          arguments: JSON.stringify(fc.args),
        },
      };
    });

  return calls && calls.length > 0 ? calls : undefined;
}

export function createGeminiProvider(opts: {
  apiKey?: string;
  accessToken?: string;
  client?: GoogleGenerativeAI;
} = {}): ModelProvider {
  const accessToken = opts.accessToken ?? Deno.env.get("GOOGLE_ACCESS_TOKEN") ??
    Deno.env.get("GEMINI_ACCESS_TOKEN");
  const apiKey = opts.apiKey ?? Deno.env.get("GOOGLE_API_KEY") ??
    Deno.env.get("GEMINI_API_KEY");
  if (!opts.client && !apiKey && !accessToken) {
    throw new Error("GOOGLE_API_KEY or GOOGLE_ACCESS_TOKEN is required for Gemini");
  }

  const usingOAuth = Boolean(accessToken);
  const requestOptions = accessToken
    ? { customHeaders: { Authorization: `Bearer ${accessToken}` } }
    : undefined;

  const genAI = opts.client ??
    new GoogleGenerativeAI(apiKey ?? "unused");
  const apiVersion = Deno.env.get("GOOGLE_API_VERSION") ?? "default";
  const resolvedApiVersion = apiVersion === "default" ? "v1beta" : apiVersion;
  const codeAssistProjectId = Deno.env.get("GEMINI_PROJECT_ID") ??
    Deno.env.get("GOOGLE_CLOUD_PROJECT") ??
    Deno.env.get("GOOGLE_PROJECT_ID") ??
    Deno.env.get("GEMINI_AUTH_PROJECT_ID");

  return {
    async chat(input) {
      if (Deno.env.get("GAMBIT_DEBUG")) {
        logger.log(
          `[GeminiProvider] Using native Google provider for model: ${input.model} (apiVersion=${apiVersion} [${resolvedApiVersion}])`,
        );
      }


      const systemInstruction = input.messages.find(
        (m) => m.role === "system",
      )?.content;

      // Map Gambit/OpenAI tools to Gemini tools
      const tools = input.tools && input.tools.length > 0
        ? [{
          functionDeclarations: input.tools.map((t): FunctionDeclaration => {
            const rawParams = t.function.parameters;
            const rawType = isRecord(rawParams) ? rawParams.type : undefined;
            const rawProps = isRecord(rawParams) ? rawParams.properties : undefined;
            const rawRequired = isRecord(rawParams) ? rawParams.required : undefined;

            const schemaType = typeof rawType === "string" && rawType.toLowerCase() === "object"
              ? SchemaType.OBJECT
              : SchemaType.OBJECT;

            const properties: Record<string, FunctionDeclarationSchemaProperty> = isRecord(rawProps)
              ? Object.fromEntries(
                Object.entries(rawProps).map(([key, value]) => {
                  const schemaValue: Schema = isRecord(value)
                    ? (value as unknown as Schema)
                    : { type: SchemaType.STRING };
                  return [key, schemaValue];
                }),
              )
              : {};

            const parameters: FunctionDeclarationSchema = {
              type: schemaType,
              properties,
              required: isStringArray(rawRequired) ? rawRequired : undefined,
            };

            return {
              name: t.function.name,
              description: t.function.description,
              parameters,
            };
          }),
        }]
        : undefined;


      const hasToolResponse = input.messages.some((msg) => msg.role === "tool");
      const baseModelParams = {
        model: input.model,
        systemInstruction: systemInstruction
          ? { role: "system", parts: [{ text: systemInstruction }] }
          : undefined,
        tools,
        toolConfig: tools
          ? {
            functionCallingConfig: {
              mode: hasToolResponse
                ? FunctionCallingMode.AUTO
                : FunctionCallingMode.ANY,
              ...(hasToolResponse
                ? {}
                : { allowedFunctionNames: tools[0]?.functionDeclarations?.map((fn) => fn.name) }),
            },
          }
          : undefined,
      };

      const history = toGoogleContent(
        input.messages.filter((msg) => msg.role !== "system"),
        { allowFunctionCalls: Boolean(tools && tools.length > 0) },
      );

      if (history.length === 0) {
        return {
          message: { role: "assistant", content: "" },
          finishReason: "stop",
        };
      }

      const lastMessage = history.pop();
      let userMessage: Content;
      if (!lastMessage) {
        return {
          message: { role: "assistant", content: "" },
          finishReason: "stop",
        };
      }

      if (lastMessage.role === "user") {
        userMessage = lastMessage;
      } else {
        history.push(lastMessage);
        userMessage = { role: "user", parts: [{ text: "" }] };
      }

      if (usingOAuth) {
        if (!codeAssistProjectId) {
          throw new Error(
            "GEMINI_PROJECT_ID or GOOGLE_CLOUD_PROJECT is required for Google OAuth",
          );
        }

        const requestPayload = buildCodeAssistChatRequest({
          input,
          history,
          userMessage,
          tools,
          toolConfig: baseModelParams.toolConfig ?? undefined,
          systemInstruction: systemInstruction ?? undefined,
        });

        const wrapped = buildCodeAssistRequest({
          projectId: codeAssistProjectId,
          model: input.model,
          request: requestPayload,
        });
        logCodeAssistRequest(wrapped);

        const headers = new Headers({
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          ...CODE_ASSIST_HEADERS,
          "X-Goog-Api-Key": "",
        });
        if (input.stream) {
          headers.set("Accept", "text/event-stream");
        }

        const endpoint = `${CODE_ASSIST_ENDPOINT}/v1internal:${input.stream ? "streamGenerateContent" : "generateContent"}?alt=sse`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify(wrapped),
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Gemini Code Assist error: ${errText}`);
        }

        const parsed = await parseSseResponse(response, input.onStreamText);
        return {
          message: {
            role: "assistant",
            content: parsed.text,
            tool_calls: parsed.toolCalls,
          },
          finishReason: "stop",
          toolCalls: parsed.toolCalls?.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          })),
        };
      }

      const model: GenerativeModel = genAI.getGenerativeModel(
        baseModelParams,
        requestOptions,
      );

      const chat = model.startChat({
        history,
        tools,
      });

      if (input.stream) {
        const streamResult = await chat.sendMessageStream(userMessage.parts);
        let fullText = "";
        for await (const chunk of streamResult.stream) {
          fullText += chunk.text();
          input.onStreamText?.(chunk.text());
        }
        const response = await streamResult.response;
        const toolCalls = toGambitToolCalls({ response });
        return {
          message: {
            role: "assistant",
            content: fullText,
            tool_calls: toolCalls,
          },
          finishReason: "stop",
          toolCalls: toolCalls?.map((tc) => ({
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments),
          })),
        };
      }

      const result = await chat.sendMessage(userMessage.parts);
      const toolCalls = toGambitToolCalls(result);
      return {
        message: {
          role: "assistant",
          content: result.response.text(),
          tool_calls: toolCalls,
        },
        finishReason: "stop",
        toolCalls: toolCalls?.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        })),
      };
    },
  };
}
