require("./config/load-env");

const http = require("http");
const { assertSafeEnvironment } = require("./config/environment");
const { connectDatabase, disconnectDatabase } = require("./config/database");

const healthPort = process.env.PORT || 8080;
const healthServer = http.createServer((request, response) => {
     if (request.url === "/health" || request.url === "/ready") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(
               JSON.stringify({ status: "ok", service: "reeplay-media" })
          );
          return;
     }

     response.writeHead(404);
     response.end();
});

const start = async () => {
     assertSafeEnvironment();
     await connectDatabase();

     const { connect } = require("./livestream/nms");
     await connect.register();

     healthServer.listen(healthPort, "0.0.0.0", () => {
          console.log(`Media health server listening on port ${healthPort}`);
     });

     console.log("Reeplay RTMP/HLS media server started");
};

const shutdown = async (signal) => {
     console.log(`${signal} received; shutting down media server`);
     healthServer.close();
     await disconnectDatabase();
     process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch((error) => {
     console.error(`Media server startup failed: ${error.message}`);
     process.exit(1);
});
