# claude-x

## Install from Git

Requires macOS and Node.js 22 or newer, with npm available on your `PATH`.

```sh
git clone git@gitlab.com:cuongnv96/claude-x.git ~/workspace/claude-x
cd ~/workspace/claude-x
npm run setup
npm test
npm run install:global
```

`setup` installs the pinned runtime dependencies from the lockfile. Installation copies the app into `~/.local/share/claude-x/app` and creates `~/.local/bin/claude-x`. Add `~/.local/bin` to your shell's `PATH` if needed. Reinstalling preserves the current storage paths and any legacy recovery baseline configuration. Installation can run while Claude is open; syncing waits for Claude to close normally.

The Git repository contains source, tests and dependency manifests. Account records, transcripts, sign-ins, backups, local configuration and `node_modules` are excluded.

## Use

Run `claude-x` from any terminal directory. Choose **Merge all local accounts**, or use `claude-x --sync` to start directly. If Claude Desktop is open, the command waits for you to quit it normally.

New sessions without saved access settings and independent metadata changes merge automatically. Conflicting edits, deletions, stale account copies and incompatible conversation histories require your choice before anything is applied.

A new session with saved access settings shows one confirmation listing all its protected fields together. Preserve them exactly, or explicitly remove the listed fields from every merged local copy, including the source session; removal does not select a specific permission mode. Structured settings are summarized by counts without displaying their contents. Existing-session access changes still require separate field confirmations. Unattended runs stop when any confirmation is required.

You can cancel while reviewing choices without changing live data or retained backups. Distinct retrievable conversations can be retained as separate sidebar sessions; the command does not invent a combined transcript. Each resulting new session needs its own access confirmation.

Keep Claude closed throughout review and applying. If the command reports that sidebar storage changed after preview, it stops before replacing live data. Rerun `claude-x` and review the fresh choices. This stop does not require recovery unless the command reports an interrupted transaction.

After syncing, reopen Claude while online. All discovered local account folders are updated together. Claude saves cloud group preferences only for the signed-in account; run the command again after switching accounts to finish that account's queued group update. Additions use Claude's native migration merge to retain remote-only groups; reviewed replacements use an ordinary pending upload. No credentials are extracted and no account is logged in automatically.

## Backups and restore

Every merge or restore first backs up current session records, sidebar state and reachable conversation files. The latest **five** snapshots are retained. Conversation files use compressed, deduplicated chunks, so unchanged history is stored once across snapshots. An unfinished transaction's backup is protected until recovery completes; a temporary sixth snapshot can exist during an operation.

Use `claude-x --backups` to list snapshots. Choose **Browse backups and restore** in the menu, or run `claude-x --restore BACKUP_ID`. Restore preserves your current sign-in, unrelated preferences, schedules/backlogs and newer account folders absent from the snapshot. It asks before overwriting a changed shared conversation. Today's state is backed up first, so you can undo a restore too.

Use `claude-x --recover` after an interrupted installation. Recovery can roll back or finish verified replacements. Do not remove locks, journals or blob files manually.

The new command's five-snapshot retention does not delete earlier recovery backups created by the old helper. If an older double-click launcher is found, installation redirects it to `claude-x` and preserves its previous contents.

## Commands

```sh
claude-x                 # terminal menu
claude-x --sync          # compatible merges; confirm conflicts
claude-x --preview       # read-only preview
claude-x --status        # local account folders and last sync
claude-x --backups       # latest five snapshots
claude-x --restore ID    # interactive restore
claude-x --recover       # interrupted transaction recovery
claude-x --help
```

Installation lives in `~/.local/share/claude-x/app`; state, compressed history and snapshots are beside it. The command is `~/.local/bin/claude-x`. `--status` also shows backup disk usage. Keep the data directory intact. Use `NO_COLOR=1 claude-x` for plain terminal output.

This utility covers local Claude Desktop **Code** sessions and custom groups. Chat, Cowork and cloud-only conversations are outside its scope. Claude's internal storage format can change; unsupported formats stop before applying. Original conversation files are not rewritten during an ordinary merge.
