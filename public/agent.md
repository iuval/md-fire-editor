# FireMD for AI agents

This page is for you, the agent. It explains how to sign in to FireMD as the user, and how
to read or edit their notes without burning context.

FireMD is a Markdown notes app. Notes live in Firestore and the security rules apply to the
agent exactly as they do to a person: **there are no service keys and no bypass**. The CLI
talks to Firestore over REST using the token of the user who signed in.

Every command prints **plain text, never JSON**. The output is meant to be read as is: TSV
listings, one note per line, raw Markdown bodies.

---

## 1. Install

The CLI ships with FireMD (`agent/cli.mjs`). It is not published to a public registry yet,
and the source repository is private while the product is in beta, so there is no public
download command to copy here.

If you already have the CLI, it needs **Node 20 or newer**. To avoid typing the path, set an
alias:

```bash
alias firemd="node /path/to/firemd/agent/cli.mjs"
```

Every example on this page uses `firemd`.

Check that it responds:

```bash
firemd --help
```

---

## 2. Sign in (always the first step)

```bash
firemd login
```

This opens the system browser on the user's site. They authorise with their Google account
and the session comes back to the CLI. When it finishes it prints:

```
ok Ana's MacBook
ana@example.com
agent 3f9a1c2b
```

That session is registered as a **connected agent** of the account. The user sees it in the
app (account menu → Connected agents) and can rename it there or with
`firemd name "another name"`.

Credentials are stored in `~/.config/firemd/credentials.json` with 0600 permissions. The
access token refreshes itself; there is no need to sign in again unless the user disconnects
the session.

### When no browser is available

`firemd login` needs a browser. On a machine without a graphical environment, the user can
generate a token in the web app and pass it through an environment variable:

```bash
export FIREMD_ID_TOKEN="<token>"
```

An external token does not refresh: it expires in one hour. This is the last resort, for
tests and CI.

### Anonymous agent mode (optional)

If the user does not want to grant their whole account, they can create a separate identity:

```bash
firemd login --agent
```

It prints a uid and a linking code. The user pastes it into the app, under *Connected agents
→ Link an anonymous agent*, picks a folder and a role (Read only or Can edit). From then on
that identity only sees that folder. It is the older model and still works, but the normal
login is simpler.

---

## 3. Check who you are

```bash
firemd whoami
```

```
ana@example.com
agent Ana's MacBook 3f9a1c2b
```

To see every agent connected to the account:

```bash
firemd agents
```

```
3f9a1c2b *	Ana's MacBook	cli	2026-02-11
9d2e4f01	iPad	desktop	2026-02-09
```

The asterisk marks the current session. Four tab-separated columns: short id, name, kind and
last use.

`firemd name "New name"` renames the current session. The change shows up in the app.

---

## 4. Commands

| Command | What it does |
|---|---|
| `firemd login` | Sign in with the site account (opens the browser) |
| `firemd login --agent` | Create a separate anonymous identity |
| `firemd whoami` | Email and agent of the current session |
| `firemd agents` | Agents connected to the account |
| `firemd name "Name"` | Rename this session |
| `firemd logout` | Revoke the token and delete the credentials |
| `firemd ls [--folder <f\|root>] [--limit n]` | List notes: `id`, title, date, folder |
| `firemd folders` | List folders: `id`, name |
| `firemd tags` | Tags with their note count |
| `firemd cat <id> [--max-bytes n] [--etag]` | Raw Markdown of one note |
| `firemd find <text> [--tag t] [--limit n]` | Search and return `id:line: text` |
| `firemd patch <id> [--etag e] [--find a --replace b]... [--all]` | Replace text |
| `firemd append <id> [--text t]` | Append at the end (or from stdin) |
| `firemd new --folder f --title t [--body t]` | Create a note |
| `firemd rm <id>` | Delete a note |
| `firemd vault pull [--dir path] [--prune]` | Cloud → `.md` files |
| `firemd vault push [--dir path]` | `.md` files → cloud |

Ids are 8 characters: the unique prefix is enough. If the prefix is ambiguous the command
fails with `E_AMBIGUOUS` and changes nothing.

### Examples

```bash
firemd ls --limit 10
firemd find flour --limit 5
firemd cat 3f9a1c2b
firemd patch 3f9a1c2b --etag 3-a1b2c3d4e5f6 --find '- two' --replace '- two
- three'
firemd append 3f9a1c2b --text '- salt'
firemd new --folder recipes --title "Sourdough" --body "## Ingredients"
```

---

## 5. Edit without stepping on anyone

`cat` returns the Markdown and, with `--etag`, the etag too:

```bash
firemd cat 3f9a1c2b --etag
```

Pass it to `patch`:

```bash
firemd patch 3f9a1c2b --etag 3-a1b2c3d4e5f6 --find 'old' --replace 'new'
```

The patch is rejected when:

- the etag is stale (`E_ETAG`, code 2): someone edited the note while you were reading it;
- the text you are looking for does not exist (`E_NOT_FOUND`, code 3);
- the text appears more than once (`E_AMBIGUOUS`, code 4); use `--all` to replace every
  occurrence.

When a `patch` fails on the etag, **read the note again** and retry with the new etag. Never
retry with the same one.

---

## 6. Vault: notes as files

```bash
firemd vault pull --dir ~/notes
firemd vault push --dir ~/notes
```

`pull` downloads every visible note as a `.md` file (subfolders preserved). `push` uploads
local changes and never overwrites a note that changed in the cloud: on a conflict it writes
`<note>.conflict-YYYYMMDDhhmm.md` and tells you. `--prune` deletes local files that no longer
exist in the cloud.

This is the cheapest way to work with many notes: a local `grep` costs no reads per note.

---

## 7. Permissions

The session has exactly the permissions of the user who signed in. With the normal login you
see all of their folders. With `login --agent` you only see the folders where the owner added
that identity as a member.

If a command fails with `PERMISSION_DENIED`, it is not a bug: the account has no access to
that note. Ask the user to check the role in the app. Do not try to work around it.

---

## 8. MCP (optional)

If the agent speaks MCP, FireMD ships a server with seven text tools: `notes_list`,
`notes_read`, `notes_patch`, `notes_append`, `notes_search`, `notes_create`,
`folders_list`.

```jsonc
// .mcp.json
{
  "mcpServers": {
    "firemd": {
      "command": "node",
      "args": ["/path/to/firemd/agent/mcp.mjs"]
    }
  }
}
```

It shares credentials with the CLI: if `firemd login` already ran, the server starts
authenticated.

---

## 9. Exit codes

| Code | Meaning |
|---|---|
| 0 | Fine |
| 1 | Unexpected error |
| 2 | `E_ETAG`: the etag is stale |
| 3 | `E_NOT_FOUND`, or no session |
| 4 | `E_AMBIGUOUS`: the prefix or the text matches several |
| 64 | `E_USAGE`: bad arguments |

---

## 10. Golden rules

1. **Sign in first.** Without `firemd login` everything else fails with code 3.
2. **Read before writing.** `cat --etag` and then `patch --etag`.
3. **Do not invent ids.** They come from `ls`, `find` or `new`.
4. **One `patch` per semantic change.** Several `--find/--replace` in one command is cheaper
   than several calls.
5. **Never retry a stale etag.** Read again.
6. **If the user renamed the agent in the app, nothing to do:** the id does not change and
   the session stays valid.
