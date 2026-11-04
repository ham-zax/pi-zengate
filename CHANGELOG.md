# Changelog

## [1.0.1] - 2026-11-04

- Remove the built-in gateway URL. Every machine sets `OPENCODE2API_BASE_URL`
  or `baseUrl` in `<agent-dir>/zengate.json`.
- Warn once per session when no endpoint is configured, instead of guessing.
- Add a test that fails if the extension source gains a URL or a host.

## [1.0.0] - 2026-11-04

- First release. Reads the ZenGate `/v1/models` catalog at startup and
  registers the free models as Pi provider `opencode2api`.
- Keeps limits, input modes, zero cost, reasoning flag and thinking level map
  from the gateway metadata.
- Sends `reasoning_effort` for every registered model, so the level you pick
  reaches the gateway.
- Caches the catalog in `<agent-dir>/cache/zengate-models.json` and falls back
  to it when the gateway is unreachable.
- Adds `/zengate` and `/zengate refresh`.
- Reads settings from the environment or `<agent-dir>/zengate.json`.
