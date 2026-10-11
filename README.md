# claude-x

**Merge your Claude Desktop Code sessions across every account you sign into — with previews, explicit decisions, backups and undo.**

macOS · Node.js 22+ · local only · unofficial (not affiliated with Anthropic)

```
┌  claude-x  status
│
│  Claude Desktop   ● closed
│  Backups          3 of 5 kept · 412 MiB · latest 2 hours ago
│
│    account               org       sessions
│  ○ work@company.com ──── 5c2e8f13  128 sessions         ─┐
│    (1f3a9c2e)                                            │    ╭─ Shared ───────────╮
│  ● you@gmail.com    ──── 7d41b0aa  131 sessions · 3 new ─┼──▶ │ 128 sessions       │
│    (9b07d5e4)                                            │    │ 7 groups           │
│  ○ 3e8d61f0         ──── 2a6f4c81  128 sessions         ─┘    │ synced 2 hours ago │
│                                                               ╰────────────────────╯
│  ● current account (signed in)   ○ other local accounts
│  Show an email instead of an ID: claude-x --name 3e8d61f0 you@example.com
│  New sessions were created after the last sync; the next merge copies them to every folder.
│
└  claude-x --sync to merge · claude-x --help for all options
```

## Why

Claude Desktop keeps a separate **Code** sidebar for every account (and every organization an account works in). Sign in with another account and your sessions and custom groups are gone from view, even though the conversations are still on your Mac.

claude-x merges those sidebars so every account shows the same sessions and groups. It never invents or rewrites conversations, never touches your sign-in, and asks before anything it can't merge on its own.

## Features

- **Three-way merge.** Every folder is compared against the last synced state, so independent edits merge automatically and only real conflicts reach you.
- **No silent permission changes.** Saved access settings (permission modes, allowed tools, connectors) always need your explicit confirmation.
- **Backups before every change.** The latest five snapshots are kept, compressed and deduplicated. Any of them can be restored, and a restore is backed up too.
- **Crash-safe apply.** Changes are staged, verified and swapped in with a journal; `claude-x --recover` rolls back or finishes an interrupted run.
- **A clear terminal UI.** A live diagram of accounts and folders, previews of what each folder will receive, arrow-key decisions, and a scrollback that reads as a record of what was decided.
- **Accounts by email.** Learned from Claude Code's config, or named by you once.
- **Local only.** No credentials are read, no account is signed in, and claude-x itself makes no network requests.

## Requirements

- macOS with Claude Desktop and its Code tab
- Node.js 22 or newer, with `npm` on your `PATH`

## Install

```sh
git clone git@github.com:cuongnv126/claude-x.git ~/workspace/claude-x
cd ~/workspace/claude-x
npm run setup
npm test
npm run install:global
```

`setup` installs the pinned runtime dependency (`classic-level`, for reading Claude's local storage) from the lockfile. `install:global` copies the app into `~/.local/share/claude-x/app` and creates the `~/.local/bin/claude-x` command; add `~/.local/bin` to your `PATH` if needed.

Reinstalling keeps your storage paths, data and any legacy configuration, and keeps the previous app as `app-previous`. Installation can run while Claude is open. If an older double-click launcher from the previous helper is found, it is redirected to `claude-x` and its original contents are kept beside it.

## Quick start

1. Run `claude-x` in any terminal.
2. Choose **Merge all local accounts**. If Claude Desktop is open, claude-x asks you to quit it (⌘Q) and continues on its own once it has closed.
3. Review the preview and answer any decisions. Press `q` at any prompt to cancel without changing anything.
4. Reopen Claude while online. After switching to another account, run `claude-x` again so that account saves the merged groups too.

Prompts use ↑/↓ (or j/k) to move, 1–9 to jump, Enter to select, and q or Esc to cancel. When input or output is not a terminal, prompts fall back to numbered choices and output is never hard-wrapped. Set `NO_COLOR=1` for plain output.

A finished merge ends with a summary of what changed where:

```
◇  Backed up current state and applied the merge                            2.4s
│
│    account               org       updated
│  ○ work@company.com ──── 5c2e8f13  ✔ 3 sessions + sidebar ─┐
│    (1f3a9c2e)                                              │    ╭─ Merged ─────╮
│  ● you@gmail.com    ──── 7d41b0aa  no changes             ─┼──▶ │ 131 sessions │
│    (9b07d5e4)                                              │    │ 7 groups     │
│  ○ 3e8d61f0         ──── 2a6f4c81  ✔ 3 sessions + sidebar ─┘    ╰──────────────╯
│
│  Backup   2026-10-11T09-12-44-120Z-3f9a1c07 · 4 of 5 kept
│
│  Next
│  › Reopen Claude while online to save the merged groups in the signed-in account
│    (you@gmail.com).
│  › Rerun claude-x after each account switch.
│
└  ✔ Merge complete
```

## Commands

| Command | What it does |
|---|---|
| `claude-x` | Interactive menu with status and diagram |
| `claude-x --sync` | Merge now; asks about every conflict first |
| `claude-x --preview` | Read-only preview; no live changes and no retained backup |
| `claude-x --status` | Claude state, backups, and the account diagram |
| `claude-x --backups` | List the latest five snapshots |
| `claude-x --restore ID` | Restore managed sessions and groups from a snapshot |
| `claude-x --recover` | Recover an interrupted run |
| `claude-x --name ID NAME` | Show an email or name for an account; omit `NAME` to clear |
| `claude-x --help` · `--version` | Help and version |

## How it works

**Folders.** Claude Desktop stores Code sessions in `~/Library/Application Support/Claude/claude-code-sessions/<account>/<organization>/`, one folder per account + organization pair. Each folder holds small JSON records (title, settings, which conversation they point to). The conversations themselves live once in `~/.claude/projects` and are shared by every account, so claude-x only merges the records and the sidebar groups.

**Merging.** claude-x remembers the last merged state. On each run it compares every folder with that state:

- New sessions without saved access settings, and independent metadata changes, merge automatically.
- Conflicting edits, deletions, stale account copies and incompatible conversation histories need your choice before anything is applied.
- A new session with saved access settings shows one confirmation listing all its protected fields. Preserve them exactly, or remove the listed fields from every merged copy, including the source session (removal does not choose a specific permission mode). Structured settings are summarized by counts, never by contents. Access changes to existing sessions need separate confirmations.
- When two accounts continued the same conversation differently and both conversation files are retrievable, you can keep both as separate sidebar sessions. claude-x never invents a combined transcript.
- Unattended runs (no terminal) stop when any confirmation is required.

**Applying.** claude-x backs up the current state, stages the merged folders and sidebar storage, verifies them, then swaps them in under a journal. If the sidebar storage changed after the preview, it stops before replacing live data; rerun and review the fresh choices. An interrupted run is never left half-applied silently: `claude-x --recover` rolls back to the verified pre-sync state or finishes a run whose replacements all completed.

**Groups.** Custom groups are written to Claude's local sidebar storage for every account folder. Claude uploads them only for the account that is signed in when it reopens online, which is why you run claude-x again after switching accounts. Additions use Claude's own migration merge so groups that exist only in the cloud are kept.

## Backups and restore

Every merge or restore first backs up current session records, sidebar state and reachable conversation files. The latest **five** snapshots are kept. Conversation files are stored as compressed, deduplicated chunks, so unchanged history is stored once across snapshots. A backup that belongs to an unfinished run is protected until recovery completes, so a temporary sixth snapshot can exist.

- `claude-x --backups` lists snapshots; **Browse backups and restore** in the menu, or `claude-x --restore BACKUP_ID`, restores one.
- Restore keeps your current sign-in, unrelated preferences, schedules and backlogs, and account folders added since the snapshot. It asks before overwriting a shared conversation that changed since.
- Today's state is backed up first, so a restore can be undone.
- Do not remove locks, journals or blob files by hand; use `claude-x --recover`.

The five-snapshot retention never deletes recovery backups made by the older helper.

## Account names

Folders are named by account ID, so claude-x shows emails where it can:

- **Automatically** for the account Claude Code is signed into: claude-x reads only `oauthAccount.accountUuid` and `oauthAccount.emailAddress` from `~/.claude.json` (never tokens) and remembers the email in its data folder.
- **Manually** for the rest: `claude-x --name 1f3a9c2e work@company.com`, or **Name accounts** in the menu. A name you set is never replaced automatically; `claude-x --name 1f3a9c2e` clears it.

Names also appear in conflict choices, so you can see which account each version came from.

## Privacy and safety

| | |
|---|---|
| **Reads** | Code session folders, Claude's local sidebar storage, conversation files (for backups and history checks), and the account ID and email in `~/.claude.json` |
| **Writes** | Code session folders and sidebar storage (only after a backup), and its own data in `~/.local/share/claude-x` |
| **Never** | Reads or copies credentials, signs in or out, changes unrelated preferences, sends anything over the network |

Claude must stay closed while claude-x scans and applies. Claude's internal storage format can change between releases; if claude-x meets a format it doesn't support, it stops before applying anything.

## FAQ

**Why does one account show two organization IDs?**
Each account + organization pair gets its own folder. An account that belongs to two organizations has two folders. Claude Desktop can also leave a stray folder that pairs an account with *another* account's organization (it appears to happen when switching accounts). A stray folder contains only Claude's default files plus copies claude-x put there, and it isn't the folder Claude shows for that account. If you're sure a folder is stray, rename it with a `.bak` suffix: claude-x skips non-ID folder names, and the next sync asks once to ignore the missing folder.

**A folder says "3 new". Is something wrong?**
No. Those sessions were created in that account after the last sync. The next merge copies them to every folder.

**claude-x says Claude Desktop is running.**
Quit it normally (⌘Q). claude-x notices and continues by itself; press `q` to cancel instead.

**A run was interrupted.**
Run `claude-x --recover`. It verifies the journal and either rolls back or finishes the run.

## Scope

claude-x covers local Claude Desktop **Code** sessions and custom groups. Chat, Cowork and cloud-only conversations are outside its scope. Original conversation files are never rewritten during an ordinary merge.

## Development

```sh
npm run setup   # pinned runtime dependency
npm test        # node --test tests.cjs
npm start       # run from the checkout
```

| File | Role |
|---|---|
| `cli.cjs` | Commands, menu and operation flow |
| `tui.cjs` | Terminal UI: timeline, prompts, spinners, diagrams |
| `storage.cjs` | Claude storage, snapshots, backups, transactions and recovery |
| `core.cjs` | Merge logic for sessions, groups and sidebar sections |
| `install.cjs` | Installer for `~/.local/bin/claude-x` |
| `tests.cjs`, `fixtures.cjs` | Test suite and temporary Claude storage fixtures |

Account records, transcripts, sign-ins, backups, local configuration and `node_modules` are never part of the repository.

## Disclaimer

claude-x is an independent project, not affiliated with or endorsed by Anthropic. "Claude" is a trademark of Anthropic. It works with Claude Desktop's internal local storage, which can change without notice; keep the built-in backups and review previews before applying.
