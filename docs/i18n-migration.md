# i18n migration

Status: **in progress**. The runtime, the English catalogue and the shell (sign-in,
sidebar, rail, tabs, pane bar, crash screen) are migrated. 320 strings in 46 files are
still inline Spanish.

## How it works

`src/i18n/index.ts` is the runtime, `src/i18n/en.ts` is the catalogue. No dependency.

```ts
import { t } from './i18n/index.ts'       // non-React code
const t = useT()                          // components: subscribes to locale changes

t('sidebar.newNote')                      // 'New note'
t('tabs.close', { title: 'Recipes' })     // 'Close Recipes'
plural(n, { one: '{count} note', other: '{count} notes' })
```

- Keys are a dot path into the catalogue and **typed**: an unknown key is a compile
  error, so a typo can never reach a user as `[missing]`.
- Placeholders are `{name}` and come from the params object. A missing param leaves
  the placeholder visible instead of printing `undefined`.
- In development a missing key throws (`i18n: missing key "…"`).
- `tests/i18n.test.ts` also asserts no catalogue value is blank.

## Adding a language

1. Copy `src/i18n/en.ts` to `xx.ts`, translate the values, keep every key.
2. Type it as `Messages` — a missing key fails `tsc`.
3. In `src/i18n/index.ts`: add the loader to `LOADERS` and the tag to `LOCALE_TAGS`.
4. `await setLocale('xx')`. It loads lazily, switches `Intl` formatting through
   `localeTag()`, and re-renders every component that used `useT()`.

## Rules for the remaining files

- Never build a sentence by concatenation; add a key with placeholders instead.
- Counts go through `plural()`, not `+ 's'`.
- Keep markup out of the catalogue: `{t('auth.subtitleBefore')}<code>.md</code>`.
- `aria-label` and `title` are user-visible: they take `t()` too.
- Comments stay in Spanish; only string literals and JSX text are user-facing.

## Remaining, by file

| File | Strings |
|---|---|
| `src/AppTree.tsx` | 49 |
| `src/components/UsageDialog.tsx` | 35 |
| `src/components/CanvasSurface.tsx` | 26 |
| `src/components/ShareDialog.tsx` | 21 |
| `src/lib/theme.ts` | 14 |
| `src/components/ThemeDialog.tsx` | 14 |
| `src/components/AgentsDialog.tsx` | 14 |
| `src/lib/notes.ts` | 10 |
| `src/components/NotePane.tsx` | 10 |
| `src/components/NotePanels.tsx` | 9 |
| `src/components/CanvasCard.tsx` | 9 |
| `src/lib/acl.ts` | 7 |
| `src/lib/errors.ts` | 6 |
| `src/firebase.ts` | 6 |
| `src/lib/vault.ts` | 5 |
| `src/lib/sorting.ts` | 5 |
| `src/lib/credits.ts` | 5 |
| `src/lib/collab/provider.ts` | 5 |
| `src/lib/canvas/model.ts` | 5 |
| `src/components/SortDialog.tsx` | 5 |
| `src/DesktopLink.tsx` | 5 |
| `src/lib/unzip.ts` | 4 |
| `src/lib/properties.ts` | 4 |
| `src/lib/export.ts` | 4 |
| `src/i18n/en.ts` | 4 |
| `src/lib/syncStatus.ts` | 3 |
| `src/lib/browser.ts` | 3 |
| `src/lib/agents.ts` | 3 |
| `src/components/PaneDropTarget.tsx` | 3 |
| `src/components/EditorToolbar.tsx` | 3 |
| `src/components/ColorField.tsx` | 3 |
| `src/lib/folders.ts` | 2 |
| `src/lib/editor/extensions.ts` | 2 |
| `src/lib/canvas/markdownCard.ts` | 2 |
| `src/hooks/useFirebase.ts` | 2 |
| `src/components/MoveDialog.tsx` | 2 |
| `src/components/ErrorBoundary.tsx` | 2 |
| `src/lib/markdown.ts` | 1 |
| `src/lib/entitlements.ts` | 1 |
| `src/lib/collab/transportError.ts` | 1 |
| `src/lib/canvas/files.ts` | 1 |
| `src/components/UpgradeDialog.tsx` | 1 |
| `src/components/RenameTagDialog.tsx` | 1 |
| `src/components/Modal.tsx` | 1 |
| `src/components/InputDialog.tsx` | 1 |
| `src/components/DocCrumbs.tsx` | 1 |

## Guard on the boot chunk

`tests/bundle-budget.test.ts` allows one nested hop in the static boot graph, and
`src/i18n/` is the only exemption (runtime + catalogue, max 2 modules), so the
catalogue can never grow into a dependency tree behind the login screen.
