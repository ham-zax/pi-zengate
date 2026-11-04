import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  effortValues,
  readSettings,
  thinkingLevelMap,
  toPiModels,
} from "../extensions/zengate-models.ts";

const free = { input: 0, output: 0, cache_read: 0, cache_write: 0 };

function record(id, metadata = {}, extra = {}) {
  return {
    id,
    endpoint: "chat",
    metadata: {
      name: `${id} display`,
      limit: { context: 200000, output: 32000 },
      modalities: { input: ["text"], output: ["text"] },
      reasoning: true,
      cost: { ...free },
      ...metadata,
    },
    ...extra,
  };
}

test("maps a free text model with the fields Pi needs", () => {
  const [model] = toPiModels({ data: [record("deepseek-v4.1-flash-free")] });
  assert.equal(model.id, "deepseek-v4.1-flash-free");
  assert.equal(model.name, "deepseek-v4.1-flash-free display");
  assert.equal(model.api, "openai-completions");
  assert.equal(model.reasoning, true);
  assert.deepEqual(model.input, ["text"]);
  assert.equal(model.contextWindow, 200000);
  assert.equal(model.maxTokens, 32000);
  assert.deepEqual(model.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(model.compat.supportsReasoningEffort, true);
  assert.equal(model.compat.supportsStore, false);
});

test("keeps image input when the model declares it", () => {
  const [model] = toPiModels({
    data: [record("vision", { modalities: { input: ["text", "image", "audio"], output: ["text"] } })],
  });
  assert.deepEqual(model.input, ["text", "image"]);
});

test("uses the responses API for a responses endpoint", () => {
  const [model] = toPiModels({ data: [record("coder", {}, { endpoint: "responses" })] });
  assert.equal(model.api, "openai-responses");
});

test("skips models that are not free", () => {
  const data = [
    record("paid-input", { cost: { ...free, input: 0.3 } }),
    record("paid-output", { cost: { ...free, output: 1 } }),
    record("paid-cache-read", { cost: { ...free, cache_read: 0.1 } }),
    record("paid-cache-write", { cost: { ...free, cache_write: 0.1 } }),
    record("still-free"),
  ];
  assert.deepEqual(
    toPiModels({ data }).map((model) => model.id),
    ["still-free"],
  );
});

test("skips models without text output or without limits", () => {
  const data = [
    record("image-only", { modalities: { input: ["text"], output: ["image"] } }),
    record("no-limits", { limit: {} }),
    record("no-output-limit", { limit: { context: 200000 } }),
    record("no-cost", { cost: undefined }),
    record("good"),
  ];
  assert.deepEqual(
    toPiModels({ data }).map((model) => model.id),
    ["good"],
  );
});

test("skips a model whose name is missing", () => {
  const data = [{ id: "nameless", metadata: { limit: { context: 1000, output: 100 }, cost: free } }, record("good")];
  assert.deepEqual(
    toPiModels({ data }).map((model) => model.id),
    ["good"],
  );
});

test("maps declared effort levels and hides the rest", () => {
  const [model] = toPiModels({
    data: [record("graded", { reasoning_options: [{ type: "effort", values: ["low", "high", "max"] }] })],
  });
  assert.deepEqual(model.thinkingLevelMap, {
    off: null,
    minimal: null,
    low: "low",
    medium: null,
    high: "high",
    xhigh: null,
    max: "max",
  });
});

test("maps a declared none level to off", () => {
  const [model] = toPiModels({
    data: [
      record("graded", {
        reasoning_options: [{ type: "effort", values: ["none", "minimal", "low", "medium", "high", "xhigh"] }],
      }),
    ],
  });
  assert.equal(model.thinkingLevelMap.off, "none");
  assert.equal(model.thinkingLevelMap.max, null);
});

test("omits the thinking map when the model declares no effort levels", () => {
  const [model] = toPiModels({ data: [record("flat")] });
  assert.equal("thinkingLevelMap" in model, false);
});

test("ignores non-effort reasoning options", () => {
  assert.deepEqual(effortValues({ reasoning_options: [{ type: "budget", values: ["1024"] }] }), []);
  assert.deepEqual(effortValues({ reasoning_options: [{ type: "effort", values: [] }] }), []);
  assert.deepEqual(effortValues({ reasoning_options: [{ type: "effort", values: ["low", 2] }] }), []);
  assert.deepEqual(effortValues({}), []);
});

test("thinkingLevelMap marks every undeclared level unsupported", () => {
  assert.deepEqual(thinkingLevelMap([]), {
    off: null,
    minimal: null,
    low: null,
    medium: null,
    high: null,
    xhigh: null,
    max: null,
  });
});

test("throws when the catalog has no usable model", () => {
  assert.throws(() => toPiModels({ data: [] }), /no usable free models/);
  assert.throws(() => toPiModels({}), /no data array/);
  assert.throws(() => toPiModels(null), /no data array/);
});

test("settings come from the environment first", () => {
  const dir = mkdtempSync(join(tmpdir(), "zengate-"));
  writeFileSync(
    join(dir, "zengate.json"),
    JSON.stringify({ baseUrl: "https://file.example/v1/", apiKey: "file-key" }),
  );
  const previous = { ...process.env };
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    delete process.env.OPENCODE2API_API_KEY;
    delete process.env.OPENCODE2API_BASE_URL;

    const fromFile = readSettings();
    assert.equal(fromFile.baseUrl, "https://file.example/v1");
    assert.equal(fromFile.apiKey, "file-key");
    assert.equal(fromFile.keySource, "zengate.json");

    process.env.OPENCODE2API_API_KEY = "env-key";
    process.env.OPENCODE2API_BASE_URL = "https://env.example/v1/";
    const fromEnv = readSettings();
    assert.equal(fromEnv.baseUrl, "https://env.example/v1");
    assert.equal(fromEnv.apiKey, "env-key");
    assert.equal(fromEnv.keySource, "OPENCODE2API_API_KEY");
  } finally {
    process.env = previous;
  }
});

test("settings fall back to the provider the sync wrote into models.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "zengate-"));
  writeFileSync(
    join(dir, "models.json"),
    JSON.stringify({
      providers: { opencode2api: { baseUrl: "https://synced.example/v1/", apiKey: "synced-key" } },
    }),
  );
  const previous = { ...process.env };
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    delete process.env.OPENCODE2API_API_KEY;
    delete process.env.OPENCODE2API_BASE_URL;

    const fromModels = readSettings();
    assert.equal(fromModels.baseUrl, "https://synced.example/v1");
    assert.equal(fromModels.apiKey, "synced-key");
    assert.equal(fromModels.keySource, "models.json");

    writeFileSync(
      join(dir, "zengate.json"),
      JSON.stringify({ baseUrl: "https://file.example/v1", apiKey: "file-key" }),
    );
    const fromFile = readSettings();
    assert.equal(fromFile.baseUrl, "https://file.example/v1");
    assert.equal(fromFile.keySource, "zengate.json");
  } finally {
    process.env = previous;
  }
});

test("no endpoint is baked in", () => {
  const dir = mkdtempSync(join(tmpdir(), "zengate-"));
  const previous = { ...process.env };
  try {
    process.env.PI_CODING_AGENT_DIR = dir;
    delete process.env.OPENCODE2API_API_KEY;
    delete process.env.OPENCODE2API_BASE_URL;
    const settings = readSettings();
    assert.equal(settings.baseUrl, undefined);
    assert.equal(settings.apiKey, undefined);
    assert.equal(settings.keySource, "none");
  } finally {
    process.env = previous;
  }
});

test("the shipped extension contains no endpoint or key", () => {
  const source = readFileSync(new URL("../extensions/zengate-models.ts", import.meta.url), "utf8");
  assert.equal(/https?:\/\//u.test(source), false, "extension source must not contain a URL");
  assert.equal(/\b\d{1,3}(?:\.\d{1,3}){3}\b/u.test(source), false, "extension source must not contain an IP");
});
