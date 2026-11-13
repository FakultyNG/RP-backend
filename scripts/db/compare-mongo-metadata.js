const fs = require("fs");

const [, , expectedPath, actualPath] = process.argv;
if (!expectedPath || !actualPath) {
     throw new Error(
          "Usage: node compare-mongo-metadata.js expected.json actual.json"
     );
}

const load = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const expected = load(expectedPath);
const actual = load(actualPath);
const canonicalize = (value) => {
     if (Array.isArray(value)) return value.map(canonicalize);
     if (value && typeof value === "object") {
          return Object.fromEntries(
               Object.keys(value)
                    .sort()
                    .map((key) => [key, canonicalize(value[key])])
          );
     }
     return value;
};
const normalize = (value) => JSON.stringify(canonicalize(value));
const byName = (items) => new Map(items.map((item) => [item.name, item]));

const expectedCollections = byName(expected.collections);
const actualCollections = byName(actual.collections);
const differences = [];

for (const [name, collection] of expectedCollections) {
     if (!actualCollections.has(name)) {
          differences.push({ collection: name, issue: "missing locally" });
          continue;
     }
     const local = actualCollections.get(name);
     if (normalize(collection.options) !== normalize(local.options)) {
          differences.push({ collection: name, issue: "collection options differ" });
     }
     if (normalize(collection.indexes) !== normalize(local.indexes)) {
          differences.push({ collection: name, issue: "indexes differ" });
     }
}
for (const name of actualCollections.keys()) {
     if (!expectedCollections.has(name)) {
          differences.push({ collection: name, issue: "extra locally" });
     }
}

console.log(JSON.stringify({ match: differences.length === 0, differences }, null, 2));
process.exitCode = differences.length === 0 ? 0 : 1;
