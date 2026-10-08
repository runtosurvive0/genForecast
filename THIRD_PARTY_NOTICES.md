# Third-party components

This project uses the following upstream projects. Installed dependency versions and their complete license files are retained in `package-lock.json` and each package under `node_modules`.

| Project | Use | Source |
|---|---|---|
| shadcn/ui | Locally owned Button, Card, Badge, Select, Dialog, Slider, Sheet, Tabs, Tooltip components | https://github.com/shadcn-ui/ui |
| React / React DOM | Application rendering | https://github.com/facebook/react |
| Radix UI | Accessible component primitives | https://github.com/radix-ui/primitives |
| Thinking Orbs | Pending-calculation indicator, original author Jakub Antalik | https://github.com/Jakubantalik/Libraries.dev/tree/main/packages/thinking-orbs |
| React Simple Maps | Shared geographic projection, SVG markers and zoom/pan | https://github.com/zcreativelabs/react-simple-maps |
| Aceternity UI World Map, Manu Arora | Adapted source: dotted background and animated route drawing | https://ui.aceternity.com/components/world-map |
| dotted-map | Precomputed SVG land-dot coordinates; MIT | https://github.com/NTag/dotted-map |
| Motion | Selected-route reveal with reduced-motion support | https://github.com/motiondivision/motion |
| Lucide | Interface icons | https://github.com/lucide-icons/lucide |
| Tailwind CSS | Component utility styles | https://github.com/tailwindlabs/tailwindcss |

The adapted Aceternity component lives in `src/components/ui/world-map.tsx`; its upstream source is https://ui.aceternity.com/registry/world-map.json and licensing page is https://ui.aceternity.com/licence. Adaptations include local precomputed geography, shared projection with vessel markers, ocean waypoints, keyboard selection in the surrounding map, and reduced-motion handling. The component is incorporated into this end product. It is not offered as a standalone component library or template.

Map point generation uses dotted-map and its bundled country geometry; see its upstream acknowledgments for the world.geo.json data source. Source credits are also visible in the map. Upstream license texts included with dependencies take precedence over this index.

Linear's design article is a visual reference only; no Linear code or brand assets are included: https://linear.app/now/behind-the-latest-design-refresh.
