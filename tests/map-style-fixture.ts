// Deliberately synthetic geography; exercises the real WebGL renderer without a tile service.
export const mapStyleFixture = {
  version: 8,
  sources: {
    land: {
      type: "geojson",
      attribution:
        '<a href="https://openmaptiles.org/">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a>',
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [110, -40],
                  [155, -40],
                  [155, 55],
                  [110, 55],
                  [110, -40],
                ],
              ],
            },
          },
        ],
      },
    },
  },
  layers: [
    {
      id: "background",
      type: "background",
      paint: { "background-color": "#eee" },
    },
    {
      id: "land",
      type: "fill",
      source: "land",
      paint: { "fill-color": "#ddd" },
    },
  ],
};
