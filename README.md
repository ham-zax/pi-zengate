# pi-zengate-models

Pi provider extension for a ZenGate / opencode2api gateway. It reads the
gateway's `/v1/models` catalog, registers the free models as a Pi provider, and
keeps the metadata current on every start. No scheduler, no generated
`models.json`, no Python, and the same file on Linux, macOS and Windows.

This package ships no endpoint and no key. Each machine supplies both.

## What you get

- Model list, context and output limits, input modes, zero cost and reasoning
  levels come from the gateway catalog, which reads models.dev.
- Only free models reach Pi. The gateway marks paid models excluded, and this
  extension also skips any model whose input, output, cache read or cache write
  cost is not exactly `0`.
- The thinking level map follows the levels each model declares. Pi shows only
  those levels in `/thinking` and sends only those values.
- A cached catalog keeps `pi --list-models` honest when the gateway is offline or
  slow. A startup fetch has a 5 second cap.

## Install

```bash
pi install npm:pi-zengate-models
```

From git, or from a local checkout:

```bash
pi install git:github.com/ham-zax/pi-zengate
pi install /path/to/pi-zengate
```

Install without a tag. A tag in the install command, such as `@v1.0.2`, freezes
that machine on one version, and `pi update --extensions` then re-fetches the same
tag forever. Without a tag, updates follow the newest release.

## Configure

Every machine needs its own gateway URL and key. Set them in the environment:

```bash
export OPENCODE2API_BASE_URL="https://your-gateway.example/v1"
export OPENCODE2API_API_KEY="..."          # Linux, macOS, WSL
setx OPENCODE2API_BASE_URL "https://your-gateway.example/v1"   # Windows
setx OPENCODE2API_API_KEY "..."                                 # Windows
```

or in `<agent-dir>/zengate.json`, which avoids environment variables:

```json
{
  "baseUrl": "https://your-gateway.example/v1",
  "apiKey": "..."
}
```

`<agent-dir>` is `~/.pi/agent` by default, or `PI_CODING_AGENT_DIR` when set.
The extension also reads `providers.opencode2api.baseUrl` and `.apiKey` from
`<agent-dir>/models.json`, so a machine the gateway sync prepared needs no second
copy. Precedence is environment, then `zengate.json`, then `models.json`. Without
any URL the extension registers no provider and warns once per session.

## Setup helpers

The fastest manual way is a text editor. On Windows:

```powershell
notepad "$env:USERPROFILE\.pi\agent\zengate.json"
```

Paste the two fields, save, restart Pi. On Linux, macOS or WSL create
`~/.pi/agent/zengate.json` the same way.

Two scripts ask for the URL and the key and then write the file, so neither
script contains a secret:

```powershell
iex (irm "<raw URL of scripts/setup.ps1>")          # Windows
```

```bash
curl -fsSL "<raw URL of scripts/setup.sh>" | bash    # Linux, macOS, WSL
```

Both scripts write the file with mode `0600` and print the model count. A
`models.json` that holds only `opencode2api` moves to `models.json.disabled`.

## Verify

```bash
pi --list-models            # opencode2api rows with limits and thinking=yes
pi
/zengate                    # count, base URL, key source, last catalog check
/zengate refresh            # fetch the catalog now
```

Then set the default model in `<agent-dir>/settings.json`:

```json
{
  "defaultProvider": "opencode2api",
  "defaultModel": "deepseek-v4.1-flash-free"
}
```

## Remove the old generated provider

If `models.json` also defines `providers.opencode2api`, those static entries win
over the extension by model ID, so stale limits and a stale compat block return.
Delete that provider block, or leave `models.json` as:

```json
{ "providers": {} }
```

## Choosing a thinking level

Run `/thinking`, or pass `--thinking <level>` on the command line. Pi clamps a
level the model does not declare, which means `max` on a model without `max`
sends the highest level that model does declare. A model that declares no levels
sends nothing beyond `high`.

The compat flag `supportsReasoningEffort` is `true` for every model this provider
registers. When it is `false`, Pi drops the selected level before the request and
the model always runs at its own default.

## Files it writes

- Cache: `<agent-dir>/cache/zengate-models.json`
- Nothing else. The extension never edits `models.json` or `settings.json`.

## Develop

```bash
npm test                                     # mapping and settings tests, no network
pi -e ./extensions/zengate-models.ts         # load from source
```

## License

MIT
