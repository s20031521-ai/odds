---
name: Obsidian Neon
colors:
  surface: '#131313'
  surface-dim: '#131313'
  surface-bright: '#393939'
  surface-container-lowest: '#0e0e0e'
  surface-container-low: '#1b1b1b'
  surface-container: '#1f1f1f'
  surface-container-high: '#2a2a2a'
  surface-container-highest: '#353535'
  on-surface: '#e2e2e2'
  on-surface-variant: '#e5bcc3'
  inverse-surface: '#e2e2e2'
  inverse-on-surface: '#303030'
  outline: '#ac888d'
  outline-variant: '#5c3f44'
  surface-tint: '#ffb1c0'
  primary: '#ffb1c0'
  on-primary: '#660028'
  primary-container: '#ff4d82'
  on-primary-container: '#5a0023'
  inverse-primary: '#bc0051'
  secondary: '#c8c6c5'
  on-secondary: '#313030'
  secondary-container: '#474746'
  on-secondary-container: '#b7b5b4'
  tertiary: '#c8c6c6'
  on-tertiary: '#303030'
  tertiary-container: '#929090'
  on-tertiary-container: '#292a2a'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#ffd9df'
  primary-fixed-dim: '#ffb1c0'
  on-primary-fixed: '#3f0016'
  on-primary-fixed-variant: '#90003c'
  secondary-fixed: '#e5e2e1'
  secondary-fixed-dim: '#c8c6c5'
  on-secondary-fixed: '#1c1b1b'
  on-secondary-fixed-variant: '#474746'
  tertiary-fixed: '#e4e2e1'
  tertiary-fixed-dim: '#c8c6c6'
  on-tertiary-fixed: '#1b1c1c'
  on-tertiary-fixed-variant: '#474747'
  background: '#131313'
  on-background: '#e2e2e2'
  surface-variant: '#353535'
  neon-pink: '#FF2174'
  surface-charcoal: '#121212'
  surface-elevated: '#1E1E1E'
  text-muted: '#A0A0A0'
  border-dim: '#222222'
typography:
  headline-lg:
    fontFamily: Hanken Grotesk
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-lg-mobile:
    fontFamily: Hanken Grotesk
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Hanken Grotesk
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-md:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: JetBrains Mono
    fontSize: 10px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.03em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  page-margin: 32px
  gutter: 16px
  component-gap: 12px
  container-padding: 20px
  8pt-unit: 8px
---

## Brand & Style

This design system evolves the "Obsidian" aesthetic into a high-energy, technical environment. It moves away from pure monochrome into **Neon Minimalism**, a style that leverages the deep immersion of an absolute black backdrop to make vibrant, high-saturation accents feel luminous and electrified. The system targets power users, developers, and data analysts who require a UI that feels like a high-performance instrument.

The visual narrative is defined by:
- **Kinetic Energy:** The use of #FF2174 (Neon Pink) against pure black creates a visual "vibration" that draws immediate focus to critical data and primary actions.
- **Obsidian Foundation:** A base of pure black and deep charcols ensures the hardware disappears, providing a "void" where only the most important information glows.
- **Cyber-Sleek:** A marriage of professional geometric typography and "wireframe-inspired" thin strokes, evoking the precision of modern terminal interfaces.
- **Aggressive Hierarchy:** By stripping away all white/neutral accents, the UI becomes hyper-efficient; if it isn't pink or muted charcoal, it isn't interactive.

## Colors

The color strategy is binary: everything is either part of the structural "void" or an electrified "signal."

- **Background:** Solid `#000000` (Pure Black). Used as the canvas for all layouts to maximize contrast for the neon accents.
- **Primary (The Signal):** `#FF2174` (Neon Pink). This color replaces all traditional white accents. It is the exclusive color for primary buttons, progress indicators, active navigation states, and high-priority metrics.
- **Structural Greys:** `#121212` and `#1A1A1A` are used for container surfaces to provide depth without distracting from the neon signals.
- **Typography:** Headlines and primary body text use a high-contrast off-white (`#E2E2E2`) to maintain legibility without competing with the vibrancy of the primary neon pink.

## Typography

The typography system balances the approachable geometry of **Hanken Grotesk** with the technical, monospaced rigor of **JetBrains Mono**.

- **Display Hierarchy:** Large headlines use Hanken Grotesk with tight letter spacing to feel impactful and structural.
- **Technical Metadata:** All labels, status indicators, and small data points use JetBrains Mono. This reinforces the "system-level" feel of the design.
- **Actionable Text:** Use JetBrains Mono for button labels to differentiate interactive "commands" from static "content."

## Layout & Spacing

The design system utilizes a **Fixed Grid** on desktop and a high-density **Fluid Grid** on mobile.

- **Desktop:** A 12-column grid with a 1440px max-width. Spacing is governed by a strict 8px rhythm. 
- **Mobile:** A 4-column grid with 16px margins. Padding is reduced to maximize the screen real estate for data.
- **Negative Space:** Large 32px+ margins are used to frame content, making the dark UI feel intentional and "curated" rather than cluttered.

## Elevation & Depth

In a pure black environment, traditional soft shadows are invisible. Depth is created through **Tonal Layering** and **Neon Glows**.

- **Surface Tiers:**
  - Base: `#000000`
  - Container: `#121212`
  - Overlay/Popup: `#1E1E1E`
- **Outlines:** Instead of shadows, use 1px borders (`#222222`) to define edges. 
- **Neon Accents:** High-priority elements use a subtle `0px 0px 8px` outer glow in Neon Pink (#FF2174) at 30% opacity to simulate light emission.

## Shapes

The shape language is **Soft**, leaning toward a "technical-sharp" aesthetic. This avoids the friendliness of large radii in favor of a precision-engineered look.

- **Standard Radius:** 4px (`rounded-sm`) for most cards, inputs, and buttons.
- **Geometric Accents:** Dividers and progress bar ends remain completely sharp (0px) to maintain the "grid-aligned" feel.

## Components

### Buttons
- **Primary:** Background of Neon Pink (#FF2174) with Pure Black text. 4px rounded corners.
- **Secondary:** Transparent background with a 1px Neon Pink border. Neon Pink text.
- **Ghost:** No background/border. Text-muted color, transitioning to Neon Pink on hover.

### Inputs & Fields
- **Default:** Background of `#121212` with a `#222222` border.
- **Focus:** Border shifts to Neon Pink. The cursor and selection highlight also use Neon Pink.

### Navigation
- **Active State:** Navigation links use Neon Pink text. A 2px vertical neon pink line is used to the left of active sidebar items.
- **Progress Bars:** Background of `#1A1A1A` with a Neon Pink fill. For high-priority metrics, add a subtle outer glow to the fill.

### Chips & Metrics
- **Status Indicators:** Use 6px squares (not circles) in Neon Pink for "active" or "online" states.
- **Metrics:** High-priority numbers (e.g., balance, speed, errors) should be rendered in Neon Pink using JetBrains Mono.