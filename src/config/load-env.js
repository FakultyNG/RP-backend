const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const environment = process.env.NODE_ENV || "production";
const requestedFile = process.env.ENV_FILE;
const defaultFile = environment === "production" ? ".env" : `.env.${environment}`;
const envPath = path.resolve(process.cwd(), requestedFile || defaultFile);

if (fs.existsSync(envPath)) {
     dotenv.config({ path: envPath });
}

module.exports = { environment, envPath };
