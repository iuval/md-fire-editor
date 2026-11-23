# i18n migration

Status: **done**. The runtime and the English catalogue cover the whole app: sign-in,
sidebar, rail, tabs, pane bar, crash screen, the menus and every dialog (usage, move,
share, agents, sort, rename tag, theme, guest draft), the editor chrome, the desktop
link page and the canvas. No user-facing string is left inline in Spanish.

What stays in Spanish on purpose: code comments and developer-only invariant messages
(they never reach the UI).

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

## Where the strings live

- `src/i18n/en.ts` is the only catalogue. Menus, dialogs and the shell read from it
  through `t()`/`useT()`; `aria-label`, `title` and `placeholder` go through it too.
- `src/DesktopLink.tsx` (the desktop handshake page) is fully migrated and lazy-loads
  its own copy, so it never drags Firebase into the boot chunk.
- Canvas colours, connection labels and property fields all use catalogue keys.

## Menu copy

Menus are read while the pointer is already moving, so they carry no prose:

- One word per item wherever the icon and the menu title make it unambiguous
  (`Share`, `Rename`, `Order`, `Delete`). Two words only when the pair is needed
  (`New note`, `New folder`, `Move up`, `Sign out`).
- No second line under an item and no subtitle under the menu title: a menu that
  needs a sentence is a menu with a bad label.
- No section headers. Groups are separated by a divider (`separatorBefore`), which
  costs 9px instead of a heading row.
- A disabled item may carry a hover `title` for the reason; nothing else is hidden
  in a tooltip.
- The one exception is the canvas: it is a spatial surface, so its menu keeps the
  object name as its title (`Card`, `Connection`, `Canvas`).

## Guard on the boot chunk

`tests/bundle-budget.test.ts` allows one nested hop in the static boot graph, and
`src/i18n/` is the only exemption (runtime + catalogue, max 2 modules), so the
catalogue can never grow into a dependency tree behind the login screen.
