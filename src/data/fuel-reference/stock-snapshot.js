import {initialReferenceTons} from './initial-stock.js';
// Recovered verbatim from the previous local photo-stock.json. Not live telemetry.
// Spans are photo-relative, heights below are illustrative, not measured volumes.
export const StockSnapshot = {
  "label": "참고 재고 · 시연",
  "asOf": "2026-11-04",
  "items": [
    {
      "yard": "P2",
      "stockTons": 106566,
      "highTons": 51925,
      "lowTons": 54641,
      "capacityTons": 470000,
      "operatingCapacityTons": 200000
    },
    {
      "yard": "P3",
      "stockTons": 146955,
      "highTons": 98516,
      "lowTons": 48439,
      "capacityTons": 600000,
      "operatingCapacityTons": 460000
    }
  ],
  "lots": [
    {
      "id": "p5-a",
      "yard": "P2",
      "pile": 5,
      "coal": "KCH(Arutmin)",
      "voyage": "26-3-034",
      "grade": "저",
      "span": [
        0.15,
        0.22
      ],
      "days": 18
    },
    {
      "id": "p5-b",
      "yard": "P2",
      "pile": 5,
      "coal": "Centennial",
      "voyage": "26-3-036",
      "grade": "고",
      "span": [
        0.3,
        0.36
      ],
      "days": 3
    },
    {
      "id": "p5-c",
      "yard": "P2",
      "pile": 5,
      "coal": "AVRA",
      "voyage": "26-3-033",
      "grade": "고",
      "span": [
        0.42,
        0.49
      ],
      "days": 33
    },
    {
      "id": "p5-d",
      "yard": "P2",
      "pile": 5,
      "coal": "LXI",
      "voyage": "26-1-040",
      "grade": "고",
      "span": [
        0.74,
        0.84
      ],
      "days": 10
    },
    {
      "id": "p6-a",
      "yard": "P2",
      "pile": 6,
      "coal": "Jera",
      "voyage": "26-1-037",
      "grade": "고",
      "span": [
        0.2,
        0.26
      ],
      "days": 27
    },
    {
      "id": "p6-b",
      "yard": "P2",
      "pile": 6,
      "coal": "LXI",
      "voyage": "26-3-035",
      "grade": "고",
      "span": [
        0.27,
        0.33
      ],
      "days": 14
    },
    {
      "id": "p6-c",
      "yard": "P2",
      "pile": 6,
      "coal": "AVRA",
      "voyage": "26-1-038",
      "grade": "저",
      "span": [
        0.55,
        0.68
      ],
      "days": null
    },
    {
      "id": "p6-d",
      "yard": "P2",
      "pile": 6,
      "coal": "Flame",
      "voyage": "26-2-022",
      "grade": "고",
      "span": [
        0.74,
        0.85
      ],
      "days": null
    },
    {
      "id": "p7-a",
      "yard": "P2",
      "pile": 7,
      "coal": "Centennial",
      "voyage": "26-3-036",
      "grade": "고",
      "span": [
        0.17,
        0.47
      ],
      "days": 3
    },
    {
      "id": "p7-b",
      "yard": "P2",
      "pile": 7,
      "coal": "KCH(adaro)",
      "voyage": "26-2-021",
      "grade": "저",
      "span": [
        0.56,
        0.83
      ],
      "days": 24
    },
    {
      "id": "p8-a",
      "yard": "P2",
      "pile": 8,
      "coal": "KCH(Arutmin)",
      "voyage": "26-3-034",
      "grade": "저",
      "span": [
        0.23,
        0.37
      ],
      "days": 18
    },
    {
      "id": "p8-b",
      "yard": "P2",
      "pile": 8,
      "coal": "Flame",
      "voyage": "26-2-020",
      "grade": "고",
      "span": [
        0.42,
        0.49
      ],
      "days": 35
    },
    {
      "id": "p8-c",
      "yard": "P2",
      "pile": 8,
      "coal": "Flame",
      "voyage": "26-2-022",
      "grade": "고",
      "span": [
        0.51,
        0.59
      ],
      "days": null
    },
    {
      "id": "p8-d",
      "yard": "P2",
      "pile": 8,
      "coal": "Centennial",
      "voyage": "26-3-036",
      "grade": "고",
      "span": [
        0.66,
        0.73
      ],
      "days": 3
    },
    {
      "id": "p8-e",
      "yard": "P2",
      "pile": 8,
      "coal": "AVRA",
      "voyage": "26-3-037",
      "grade": "저",
      "span": [
        0.81,
        0.94
      ],
      "days": null
    },
    {
      "id": "a8",
      "yard": "P3",
      "shed": "A",
      "cell": 8,
      "coal": "AVRA",
      "voyage": "1-38",
      "grade": "저",
      "days": 25
    },
    {
      "id": "a7",
      "yard": "P3",
      "shed": "A",
      "cell": 7,
      "coal": "Glencore(무연탄)",
      "voyage": "3-06",
      "grade": "고",
      "days": 256
    },
    {
      "id": "a5",
      "yard": "P3",
      "shed": "A",
      "cell": 5,
      "coal": "Flame",
      "voyage": "2-22",
      "grade": "고",
      "days": null
    },
    {
      "id": "a4",
      "yard": "P3",
      "shed": "A",
      "cell": 4,
      "coal": "Centennial",
      "voyage": "3-36",
      "grade": "고",
      "days": 3
    },
    {
      "id": "a2",
      "yard": "P3",
      "shed": "A",
      "cell": 2,
      "coal": "KCH(Kaltim)",
      "voyage": "1-39",
      "grade": "저",
      "days": 14
    },
    {
      "id": "b10",
      "yard": "P3",
      "shed": "B",
      "cell": 10,
      "coal": "AVRA",
      "voyage": "1-38",
      "grade": "저",
      "days": 33
    },
    {
      "id": "b7",
      "yard": "P3",
      "shed": "B",
      "cell": 7,
      "coal": "Centennial",
      "voyage": "3-36",
      "grade": "고",
      "days": 10
    },
    {
      "id": "b6",
      "yard": "P3",
      "shed": "B",
      "cell": 6,
      "coal": "LXI",
      "voyage": "3-35",
      "grade": "고",
      "days": 14
    },
    {
      "id": "b5",
      "yard": "P3",
      "shed": "B",
      "cell": 5,
      "coal": "Flame",
      "voyage": "2-22",
      "grade": "고",
      "days": 4
    },
    {
      "id": "b4",
      "yard": "P3",
      "shed": "B",
      "cell": 4,
      "coal": "Glencore",
      "voyage": "1-41",
      "grade": "고",
      "days": null
    },
    {
      "id": "b3",
      "yard": "P3",
      "shed": "B",
      "cell": 3,
      "coal": "AVRA",
      "voyage": "3-37",
      "grade": "저",
      "days": null
    }
  ]
};

StockSnapshot.lots = StockSnapshot.lots.map(lot => ({...lot, tons: initialReferenceTons(lot.id)}));
