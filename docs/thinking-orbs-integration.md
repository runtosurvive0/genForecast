# Thinking Orbs integration

The dashboard uses Jakub Antalik's original `thinking-orbs` package, installed at version `0.3.2` and recorded in the application lockfile. Install with `npm install thinking-orbs@0.3.2`; import `ThinkingOrb` from `thinking-orbs`. Its current [upstream source](https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/thinking-orbs) is the author's Libraries.dev monorepo; the earlier [standalone repository](https://github.com/Jakubantalik/thinking-orbs) documents version `0.3.1`. The [official demo](https://libraries.dev/orbs) is linked by the author's previous demo at [orbs.jakubantalik.com](https://orbs.jakubantalik.com/).

`src/components/ProcessingOrb.tsx` wraps that upstream React component. It accepts a resolved `light` or `dark` theme, `solving`, `searching`, or `connecting` state, a Korean visible label, an optional `20` or `64` size, and an optional class name. The status container announces the text politely; the redundant canvas is hidden from assistive technology. Mount the wrapper only while its operation is pending.

```tsx
{
  pending && (
    <ProcessingOrb
      theme={theme}
      state="solving"
      label="발전량 시뮬레이션 계산 중"
    />
  );
}
```

Use `solving` for generation simulation, `searching` for operation data retrieval, and `connecting` for data synchronization. Prefer the separately tuned 20px inline preset; reserve 64px for a panel loading state. Keep visible labels accurate to the current operation.

Upstream provides a static frame for reduced motion, hidden-tab and offscreen pausing, effect cleanup, and canvas pixel density capped at 2. No custom animation is implemented here. Each visible instance has its own animation loop synchronized by `performance.now`. The package has no runtime dependencies and requires React 18 or newer. The actual API uses `theme`; the demo's generated prompt mentioning a `dark` boolean does not match the repository's typed React API.

Source references: [component](https://github.com/Jakubantalik/Libraries.dev/blob/main/packages/thinking-orbs/src/ThinkingOrb.tsx), [props](https://github.com/Jakubantalik/Libraries.dev/blob/main/packages/thinking-orbs/src/types.ts), [theme and reduced motion](https://github.com/Jakubantalik/Libraries.dev/blob/main/packages/thinking-orbs/src/theme.ts), [tuned presets](https://github.com/Jakubantalik/Libraries.dev/blob/main/packages/thinking-orbs/src/presets.ts), [package metadata](https://github.com/Jakubantalik/Libraries.dev/blob/main/packages/thinking-orbs/package.json). The original animation engine lives under `packages/thinking-orbs/src/engine/`. Installed `node_modules/thinking-orbs/dist/types.d.ts` confirms all props used by the wrapper. Version 0.3.2 additionally offers an interpolated 32px size and optional tint, density, geometry, and pointer gravity controls; this wrapper uses the original 20px/64px monochrome presets.

React + shadcn/ui was selected for the existing custom topbar/sidebar layout, editable component source, and [CSS theme tokens](https://ui.shadcn.com/docs/theming). Its [light/dark classes](https://ui.shadcn.com/docs/dark-mode/vite) also match upstream automatic theme detection, although this wrapper passes the resolved theme explicitly. Spectrum 2 is compatible with this React component, but its Provider color scheme must be mapped to the Orb's explicit theme because Orb does not read Spectrum context.

Thinking Orbs is [MIT licensed, copyright 2026 Jakub Antalik](https://github.com/Jakubantalik/Libraries.dev/blob/main/packages/thinking-orbs/LICENSE). Preserve its copyright and permission notice when distributing copied or bundled source. The application consumes the original package rather than a similarly named fork or visual imitation.

## World map and vessel status

`src/components/VesselMap.tsx` uses the actual [React Simple Maps](https://github.com/zcreativelabs/react-simple-maps) kit (`ComposableMap`, `Geographies`, `Geography`, `Marker`, `Line`, and `ZoomableGroup`) alongside shadcn buttons and the dashboard's shared theme variables. Version 5.0.5 explicitly supports React 19 and is MIT licensed. Its D3 Equal Earth projection is centered on the Pacific; dragging and zoom controls allow a complete world view.

The map imports `world-atlas/countries-110m.json` locally, so geography is bundled in the offline HTML rather than fetched from a URL. [World Atlas](https://github.com/topojson/world-atlas) redistributes Natural Earth's public-domain geographic data as TopoJSON under ISC; its archived dataset is intended here for geographic context. It is not current navigational data.

Vessel positions and ocean waypoints are explicitly illustrative and keyed to the four shipment IDs. Ship selection links the SVG markers, keyboard-operable shadcn selectors, and shipment details. A visible sample label and map credit distinguish the overview from live AIS data and actual navigational routes. React Simple Maps renders geography; live ship tracking would require a separate AIS data provider.

[MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/) and [Leaflet](https://leafletjs.com/) were considered for deeper pan/zoom or tile-based mapping. Both can use local vector data, but React Simple Maps suits this small offline world overview and exposes SVG elements that use the existing design tokens directly.
