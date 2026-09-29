# UI

[Index](README.md)

`@botanical/ui` is the design system: theme tokens and shadcn (`base-nova`) primitives. `packages/web` consumes it. The package ships TypeScript source with no build step. `packages/web/next.config.ts` lists it in `transpilePackages`.

- Package: `@botanical/ui` (`packages/ui/package.json`)
- Tokens and base styles: `packages/ui/src/styles.css`
- Primitives: `packages/ui/src/components`
- Helpers: `packages/ui/src/lib/utils.ts` (`cn`), `packages/ui/src/hooks/use-mobile.ts`
- shadcn CLI config: `packages/ui/components.json`

## Exports

| Import | File |
|--------|------|
| `@botanical/ui/styles.css` | `packages/ui/src/styles.css` |
| `@botanical/ui/components/<name>` | `packages/ui/src/components/<name>.tsx` |
| `@botanical/ui/hooks/<name>` | `packages/ui/src/hooks/<name>.ts` |
| `@botanical/ui/lib/<name>` | `packages/ui/src/lib/<name>.ts` |

Components import each other through these package paths (for example `@botanical/ui/components/button`), which is also what the shadcn CLI writes. `packages/ui/tsconfig.json` maps them to `src` for the package's own typecheck.

Primitives: alert-dialog, avatar, badge, breadcrumb, button, card, checkbox, command, dialog, dropdown-menu, form, input, input-group, label, popover, scroll-area, select, separator, sheet, sidebar, skeleton, sonner, switch, table, tabs, textarea, tooltip.

Blocks built on them:

| Component | Use |
|-----------|-----|
| `packages/ui/src/components/page-container.tsx` | `PageContainer` / `pageContainerVariants`: page width and gutters. `default` (`max-w-5xl`), `narrow` (`max-w-2xl`, forms), `wide` (`max-w-7xl`, grids). All sizes are left-aligned so the content edge stays put between pages |
| `packages/ui/src/components/page-header.tsx` | Page title, one-line description, actions |
| `packages/ui/src/components/empty-state.tsx` | Icon tile, title, sentence, optional action; `bordered` for a dashed frame |
| `packages/ui/src/components/status-badge.tsx` | Badge with a dot. `tone` picks the color: `neutral`, `success`, `warning`, `danger`, `info`, `progress` (pulsing) |
| `packages/ui/src/components/alert-dialog.tsx` | `AlertDialog` parts plus `ConfirmDialog` for delete-style confirmations |

`Badge` has `success`, `warning`, and `info` variants next to shadcn's. `SidebarMenuButton` draws a `--sidebar-primary` mark when active. `CommandDialog` expects a `Command` child (base-nova style).

## Styles

`packages/ui/src/styles.css` imports `tw-animate-css` and `shadcn/tailwind.css`, and declares `@source "./"` so Tailwind generates classes used inside the package. It defines the `dark` custom variant, the `@theme inline` mapping, the OKLCH tokens for `:root` and `.dark`, the `[data-accent]` overrides, and the base layer.

| Tokens | Notes |
|--------|-------|
| `--background`, `--foreground`, `--card`, `--muted`, `--border`, … | Neutral base. Never tinted |
| `--primary`, `--ring`, `--sidebar-primary` | Neutral by default. A non-neutral accent sets them from `--swatch-<accent>` |
| `--destructive`, `--success`, `--warning`, `--info` (+ `-foreground`) | Status colors. Fixed whatever the accent |
| `--chart-1` … `--chart-5` | Chart ramp |
| `--swatch-blue`, `--swatch-red`, `--swatch-green`, `--swatch-orange`, `--swatch-violet` | Accent hues, light and dark. The settings picker paints with them |
| `--agent-<color>`, `--agent-<color>-ink` | Agent identity marks (`packages/web/src/lib/agent-colors.ts`), light and dark |
| `--bubble`, `--bubble-user` | Chat bubble fills: an agent's reply and the viewer's own message (`bg-bubble`, `bg-bubble-user`). The composer uses `--bubble` too |
| `--text-2xs` | 11px step below `text-xs` for timestamps and counts |

Text selection is tinted with `--primary`.

The app stylesheet must import Tailwind first:

```css
@import "tailwindcss";
@import "@botanical/ui/styles.css";
```

## Dependencies

Runtime: `@base-ui/react`, `class-variance-authority`, `cmdk`, `cn`, `lucide-react`, `react-hook-form`, `shadcn` (for `shadcn/tailwind.css`), `sonner`, `tw-animate-css`. Peers: `react`, `react-dom`, `next-themes` (used by the toaster), `tailwindcss`.

## Tests

No unit tests yet. `typecheck` is `tsc --noEmit`, and it runs in the CI typecheck loop (`.github/workflows/ci.yml`).

## Where to change X

- **Add a shadcn primitive.** From `packages/ui`, run `bunx shadcn@latest add <component>`. The file lands in `packages/ui/src/components`. Import it in the web app as `@botanical/ui/components/<component>`.
- **Change a color, radius, or font token.** `packages/ui/src/styles.css`. Keep `:root`, `.dark`, and each `[data-accent]` block in step.
- **Add an accent.** Add `--swatch-<name>` to `:root` and `.dark` and `[data-accent]` blocks in `packages/ui/src/styles.css`, then the name in `@botanical/core` and the label in `packages/web/src/lib/accent.ts`.
- **Show a status.** Use `StatusBadge` with a `tone`, not a hand-picked `Badge` variant.
- **Add a page.** Wrap it in `pageContainerVariants()` and start with `PageHeader`.
