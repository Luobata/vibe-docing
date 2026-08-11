# Database location

The canonical local development database for this project is:

- Repository-relative path: `./vibe-local.db`
- Current absolute path: `/Users/bytedance/luobata/vibe-docing/vibe-local.db`

This is the database that contains the long-lived document history. At the time it
was recovered on 2026-08-11, it contained 15 trees and 38 nodes. The backend uses
this file by default, regardless of the directory from which the server is started.

Do not use these files as the development database:

- `packages/server/vibe.db`
- `.data/vibe.db`
- Any `vibe.db` under `.multi-agent/worktrees/`

They are incomplete or temporary databases and can make existing document links
appear broken.

## Runtime override

`DB_PATH` may override the default. Relative values are always resolved from the
repository root; absolute values are preserved. Unless a different database is
deliberately required, leave `DB_PATH` unset or set it to:

```sh
DB_PATH=vibe-local.db
```

On startup, the server prints the resolved absolute path. The expected log is:

```text
server on :4000; db=/Users/bytedance/luobata/vibe-docing/vibe-local.db
```

## Data safety

The database and its `vibe-local.db-wal` and `vibe-local.db-shm` sidecar files are
gitignored local data. Do not delete or copy only the main file while the server is
running. Use SQLite's backup command when making a snapshot so committed WAL data
is included.

A verified pre-switch backup is stored locally at:

```text
.data/vibe-local-2026-08-11-pre-switch.db
```
