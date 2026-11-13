require("./config/load-env");
const http = require("http");
const app = require("./app");
const { Server } = require("socket.io");
const socketChat = require("./socket/socketEvents");
const { assertSafeEnvironment, enabled } = require("./config/environment");
const { connectDatabase, disconnectDatabase } = require("./config/database");

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || "0.0.0.0";

const server = http.createServer(app);

const io = new Server(server, {
     cors: "*",
     methods: ["GET", "POST", "PUT", "DELETE"],
});

global.io = io;

socketChat(io);

const start = async () => {
     assertSafeEnvironment();
     await connectDatabase();

     if (enabled("ENABLE_MEDIA_SERVER", process.env.NODE_ENV === "production")) {
          const { connect } = require("./livestream/nms");
          await connect.register();
     }

     if (enabled("ENABLE_CRON_JOBS", process.env.NODE_ENV === "production")) {
          require("./cron");
     }

     server.listen(PORT, HOST, () => {
          console.log(`Node Server listening at http://${HOST}:${PORT}`);
     });
};

const shutdown = async (signal) => {
     console.log(`${signal} received; shutting down`);
     server.close(async () => {
          await disconnectDatabase();
          process.exit(0);
     });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

start().catch((error) => {
     console.error(`Startup failed: ${error.message}`);
     process.exit(1);
});
