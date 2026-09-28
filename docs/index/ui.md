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

Primitives: avatar, badge, button, card, command, dialog, dropdown-menu, form, input, input-group, label, popover, scroll-area, select, separator, sheet, sidebar, skeleton, sonner, switch, tabs, textarea, tooltip.

## Styles

`packages/ui/src/styles.css` imports `tw-animate-css` and `shadcn/tailwind.css`, and declares `@source "./"` so Tailwind generates classes used inside the package. It defines the `dark` custom variant, the `@theme inline` mapping, the neutral OKLCH tokens for `:root` and `.dark`, the `[data-accent]` overrides (accent recolors `--primary` and `--ring` only), and the base layer.

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
- **Add an accent.** Add `[data-accent]` blocks in `packages/ui/src/styles.css`, then the name in `@botanical/core` and the label and swatch in `packages/web/src/lib/accent.ts`.
