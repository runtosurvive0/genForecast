"use strict";
// Derived once from the shared reference scene, preserving source IDs and physical paths.
const catalog = require("../../src/data/fuel-reference/demo-catalog.json");
module.exports = { loadCatalog: () => structuredClone(catalog) };
