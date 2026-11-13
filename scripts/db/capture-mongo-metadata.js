const fs = require("fs");
const path = require("path");
const mongoose = require("mongoose");

const args = Object.fromEntries(
     process.argv.slice(2).map((item) => {
          const [key, ...value] = item.replace(/^--/, "").split("=");
          return [key, value.join("=")];
     })
);

const uriVariable = args["uri-env"];
const output = args.out;

if (!uriVariable || !output) {
     throw new Error(
          "Usage: node capture-mongo-metadata.js --uri-env=VARIABLE_NAME --out=path.json"
     );
}
if (uriVariable.toUpperCase().includes("PRODUCTION") && process.env.ALLOW_PRODUCTION_METADATA_READ !== "true") {
     throw new Error(
          "Production metadata capture requires ALLOW_PRODUCTION_METADATA_READ=true and a read-only MongoDB account"
     );
}

const uri = process.env[uriVariable];
if (!uri) throw new Error(`${uriVariable} is not set`);

const capture = async () => {
     const connection = await mongoose.createConnection(uri).asPromise();
     try {
          const database = connection.db;
          const buildInfo = await database.admin().command({ buildInfo: 1 });
          const collections = await database.listCollections().toArray();
          const metadata = {
               capturedAt: new Date().toISOString(),
               mongoVersion: buildInfo.version,
               database: database.databaseName,
               collections: [],
          };

          for (const collection of collections.sort((a, b) => a.name.localeCompare(b.name))) {
               const indexes = await database.collection(collection.name).indexes();
               metadata.collections.push({
                    name: collection.name,
                    type: collection.type,
                    options: collection.options || {},
                    indexes: indexes.sort((a, b) => a.name.localeCompare(b.name)),
               });
          }

          const target = path.resolve(output);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, `${JSON.stringify(metadata, null, 2)}\n`);
          console.log(`MongoDB metadata written to ${target}`);
     } finally {
          await connection.close();
     }
};

capture().catch((error) => {
     console.error(error.message);
     process.exit(1);
});
