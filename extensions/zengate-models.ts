/**
 * ZenGate (opencode2api) model discovery for Pi.
 *
 * The gateway's /v1/models catalog is the authority for which free models
 * exist and what they accept, cost and support. This extension registers the
 * provider, reads that catalog at startup, and caches it, so every OS gets
 * current models and metadata with no scheduled job and no generated
 * models.json.
 *
 * The mapping mirrors scripts/sync-client-models.py in the gateway repository:
 * `metadata` carries the models.dev values, non-free or non-text models are
 * skipped, and Pi keeps only text and image inputs.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const PROVIDER_ID = "opencode2api";
export const PROVIDER_NAME = "ZenGate";
export const KEY_ENV = "OPENCODE2API_API_KEY";
export const BASE_URL_ENV = "OPENCODE2API_BASE_URL";

const FETCH_TIMEOUT_MS = 5000;
const LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

type Inputs = ("text" | "image")[];
export type PiModel = {
  id: string;
  name: string;
  api: "openai-completions" | "openai-responses";
  reasoning: boolean;
  input: Inputs;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  thinkingLevelMap?: Record<string, string | null>;
  compat: {
    supportsStore: boolean;
    supportsDeveloperRole: boolean;
    supportsReasoningEffort: boolean;
    supportsUsageInStreaming: boolean;
  };
};

type Meta = {
  name?: unknown;
  limit?: { context?: unknown; output?: unknown };
  modalities?: { input?: unknown; output?: unknown };
  reasoning?: unknown;
  cost?: { input?: unknown; output?: unknown; cache_read?: unknown; cache_write?: unknown };
  reasoning_options?: unknown;
};
type CatalogRecord = { id?: unknown; endpoint?: unknown; metadata?: Meta };

/**
 * Pi sends reasoning_effort only when this is true. Every model in the current
 * free catalog accepts the field, and the thinking level map decides which
 * values Pi may send.
 */
const COMPAT = {
  supportsStore: false,
  supportsDeveloperRole: false,
  supportsReasoningEffort: true,
  supportsUsageInStreaming: true,
};

const isText = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;
const isFree = (value: unknown): value is number => typeof value === "number" && value === 0;

/** Upstream effort levels for one model; empty when it has no graded control. */
export function effortValues(meta: Meta): string[] {
  if (!Array.isArray(meta.reasoning_options)) return [];
  for (const option of meta.reasoning_options) {
    if (!option || typeof option !== "object") continue;
    const { type, values } = option as { type?: unknown; values?: unknown };
    if (type === "effort" && Array.isArray(values) && values.length > 0 && values.every(isText)) {
      return [...values];
    }
  }
  return [];
}

/**
 * A supported level sends its own name. A level the model does not declare maps
 * to null, so Pi hides it and never sends it.
 */
export function thinkingLevelMap(values: string[]): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const level of LEVELS) {
    if (level === "off") map[level] = values.includes("none") ? "none" : null;
    else map[level] = values.includes(level) ? level : null;
  }
  return map;
}

/** Map one gateway catalog payload to Pi model configs. */
export function toPiModels(payload: unknown): PiModel[] {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("gateway catalog has no data array");

  const models: PiModel[] = [];
  for (const record of data as CatalogRecord[]) {
    const meta = record?.metadata;
    if (!meta || !isText(record.id) || !isText(meta.name)) continue;
    const contextWindow = meta.limit?.context;
    const maxTokens = meta.limit?.output;
    if (!isCount(contextWindow) || !isCount(maxTokens)) continue;
    const outputs = meta.modalities?.output;
    if (!Array.isArray(outputs) || !outputs.includes("text")) continue;
    const cost = meta.cost;
    if (!cost || !isFree(cost.input) || !isFree(cost.output)) continue;
    if (!isFree(cost.cache_read ?? 0) || !isFree(cost.cache_write ?? 0)) continue;
    const declared = Array.isArray(meta.modalities?.input) ? meta.modalities.input : [];
    const input = ["text", "image"].filter((mode) => declared.includes(mode)) as Inputs;
    if (input.length === 0) continue;
    const efforts = effortValues(meta);
    models.push({
      id: record.id,
      name: meta.name,
      api: record.endpoint === "responses" ? "openai-responses" : "openai-completions",
      reasoning: meta.reasoning === true,
      input,
      contextWindow,
      maxTokens,
      cost: {
        input: cost.input,
        output: cost.output,
        cacheRead: cost.cache_read ?? 0,
        cacheWrite: cost.cache_write ?? 0,
      },
      ...(efforts.length > 0 ? { thinkingLevelMap: thinkingLevelMap(efforts) } : {}),
      compat: COMPAT,
    });
  }
  if (models.length === 0) throw new Error("gateway catalog has no usable free models");
  return models;
}

/** Pi config directory, honouring PI_CODING_AGENT_DIR. */
export function agentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

export function configPath(): string {
  return join(agentDir(), "zengate.json");
}

export function modelsConfigPath(): string {
  return join(agentDir(), "models.json");
}

export function cachePath(): string {
  return join(agentDir(), "cache", "zengate-models.json");
}

function readJson(path: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

/**
 * A machine prepared by the gateway sync already holds the endpoint and the key
 * in models.json. Read them so the client needs no second copy of either.
 */
function gatewayFromModelsConfig(): { baseUrl?: string; apiKey?: string } {
  const file = readJson(modelsConfigPath()) ?? {};
  const providers = file.providers;
  const provider =
    providers && typeof providers === "object"
      ? (providers as Record<string, unknown>)[PROVIDER_ID]
      : undefined;
  if (!provider || typeof provider !== "object") return {};
  const record = provider as Record<string, unknown>;
  const baseUrl =
    typeof record.baseUrl === "string" && record.baseUrl.trim() ? record.baseUrl : undefined;
  const apiKey =
    typeof record.apiKey === "string" && record.apiKey.trim() ? record.apiKey.trim() : undefined;
  return { baseUrl, apiKey };
}

/**
 * Settings precedence: environment, then <agent-dir>/zengate.json, then the
 * `opencode2api` provider in <agent-dir>/models.json. The last source means a
 * machine the gateway sync already prepared needs no extra file. This package
 * ships no endpoint: every machine supplies its own.
 */
export function readSettings(): { baseUrl?: string; apiKey?: string; keySource: string } {
  const file = readJson(configPath()) ?? {};
  const fileBase = typeof file.baseUrl === "string" && file.baseUrl.trim() ? file.baseUrl : undefined;
  const fileKey = typeof file.apiKey === "string" && file.apiKey.trim() ? file.apiKey.trim() : undefined;
  const synced = gatewayFromModelsConfig();
  const envBase = process.env[BASE_URL_ENV];
  const envKey = process.env[KEY_ENV]?.trim();
  const base = envBase || fileBase || synced.baseUrl;
  return {
    baseUrl: base ? normalizeBaseUrl(base) : undefined,
    apiKey: envKey || fileKey || synced.apiKey,
    keySource: envKey ? KEY_ENV : fileKey ? "zengate.json" : synced.apiKey ? "models.json" : "none",
  };
}

const configureHint = (): string =>
  `No gateway endpoint found. Set ${BASE_URL_ENV}, baseUrl in ${configPath()}, ` +
  `or providers.${PROVIDER_ID}.baseUrl in ${modelsConfigPath()}.`;

export default async function (pi: ExtensionAPI) {
  const settings = readSettings();
  const key = settings.apiKey;
  const cacheFile = cachePath();

  // Without an endpoint there is nothing to discover. Say so once per session
  // and leave the model list untouched.
  if (!settings.baseUrl) {
    pi.on("session_start", async (_event, ctx) => {
      ctx.ui.notify(`${PROVIDER_NAME}: ${configureHint()}`, "warning");
    });
    return;
  }
  const baseUrl = settings.baseUrl;

  const readCache = (): PiModel[] => {
    const saved = readJson(cacheFile);
    return Array.isArray(saved?.models) ? (saved.models as PiModel[]) : [];
  };
  const writeCache = (models: PiModel[]) => {
    try {
      mkdirSync(dirname(cacheFile), { recursive: true });
      writeFileSync(
        cacheFile,
        `${JSON.stringify({ baseUrl, checkedAt: Date.now(), models }, null, 2)}\n`,
      );
    } catch {
      // A read-only agent directory must not break model loading.
    }
  };

  let latest = readCache();
  let checkedAt = readJson(cacheFile)?.checkedAt as number | undefined;

  const refresh = async (signal?: AbortSignal): Promise<PiModel[]> => {
    const deadline = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    const combined = signal && "any" in AbortSignal ? AbortSignal.any([signal, deadline]) : deadline;
    const response = await fetch(`${baseUrl}/models`, {
      headers: { accept: "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
      signal: combined,
    });
    if (!response.ok) throw new Error(`gateway catalog returned HTTP ${response.status}`);
    latest = toPiModels(await response.json());
    checkedAt = Date.now();
    writeCache(latest);
    return latest;
  };

  // Fetch before registering, so `pi --list-models` and every startup see the
  // current catalog. `--list-models` runs offline-only, so it never refreshes.
  if (key) {
    try {
      await refresh();
    } catch {
      // Offline or a gateway fault: the cached catalog above is still usable.
    }
  }

  pi.registerProvider(PROVIDER_ID, {
    name: PROVIDER_NAME,
    baseUrl,
    apiKey: key ?? `\${${KEY_ENV}}`,
    api: "openai-completions",
    models: latest,
    async refreshModels(context) {
      if (!context.allowNetwork) return latest;
      const credential = context.credential?.type === "api_key" ? context.credential.key : undefined;
      if (!credential && !key) return latest;
      try {
        return await refresh(context.signal);
      } catch {
        return latest;
      }
    },
  });

  pi.registerCommand("zengate", {
    description: "Show or refresh the ZenGate model catalog",
    handler: async (args, ctx) => {
      if ((args ?? "").trim() === "refresh") {
        try {
          const models = await refresh();
          ctx.ui.notify(`ZenGate: refreshed ${models.length} models from ${baseUrl}`, "info");
        } catch (error) {
          ctx.ui.notify(`ZenGate refresh failed: ${(error as Error).message}`, "error");
        }
        return;
      }
      const stamp = checkedAt ? new Date(checkedAt).toISOString() : "never";
      const line = `${PROVIDER_NAME}: ${latest.length} models, ${baseUrl}, key ${settings.keySource}, catalog ${stamp}`;
      ctx.ui.notify(line, "info");
    },
  });
}
