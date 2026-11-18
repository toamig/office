# Office modules

A module adds a notification channel, an agent provider or a vault source without changing Office.
Put a folder with an `index.mjs` in `<Office data folder>/modules/<name>/`, then enable it in Setup.
Modules are off by default, and Office does not run a line of one until you enable it. A module
runs with full access to your files and accounts, so only enable code you wrote or trust.

`index.mjs` is an ES module whose default export is `{ kind, create(ctx) }`:

| kind       | `create(ctx)` returns                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| `channel`  | `{ id, send(notification) }`: called for every urgent notification                                              |
| `provider` | an object with the provider interface (see `src/main/modules/providers/types.ts`)                               |
| `source`   | `{ id, items() }`: `items()` returns quick switcher entries `{ kind, label, detail?, link: { view, params? } }` |

`ctx` is `{ name, dataDir, log(message), workspace() }`: the module's own data folder, a logger, and the
current workspace config.

An optional `module.json` next to it (`{ "kind": "channel", "description": "..." }`) is what Setup shows
before the module is enabled. `sample-channel/` here is a working channel module.
