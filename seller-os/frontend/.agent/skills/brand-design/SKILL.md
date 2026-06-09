# Premium Angular SSR UI Design Skill

name: angular-premium-design
description: Custom skill to build high-end, asymmetric, modern marketing landing pages optimized strictly for Angular SSR projects using standalone components and Tailwind CSS.

## Goal
To completely avoid generic, template-like AI layouts and build a bespoke, premium landing page that doesn't break server-side hydration.

## Core Technical Instructions
1. **SSR Safety**: Absolutely NO direct reference to `window`, `document`, or `localStorage` at the top level or inside `ngOnInit()`. Wrap all browser-specific interactions inside `isPlatformBrowser(this.platformId)` blocks or handle them via CSS/Tailwind animations.
2. **Modern Architecture**: Generate components using Angular standalone architecture (`standalone: true, imports: [CommonModule, ... ]`).
3. **No Vanilla Layout Loops**: Ban typical 3-column feature grids. Force the layout to use modern aesthetic patterns: an asymmetric hero block with a premium mock-UI container on one side, and uneven Bento Grids (`md:col-span-2`, `md:col-span-1`) for features.

## Aesthetic Constraints
- Enforce massive negative space (Tailwind `py-28` to `py-36` blocks).
- Use a highly professional typography scale. Pair a distinct, elegant headline font with an ultra-clean sans-serif body text.
- Navigation header must use `backdrop-blur-md` and glassmorphism styling, but handle state safely for SSR.