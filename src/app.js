require("./config/load-env");
const express = require("express");
const fileUpload = require("express-fileupload");
const mongoose = require("mongoose");
const cors = require("cors");
const path = require("path");

const routes = require("./routes/index");

const app = express();

app.use(
     express.json({
          limit: "10gb",
     })
);
app.use(
     express.urlencoded({
          extended: true,
     })
);
app.use(
     cors({
          origin: "*",
     })
);
app.use(
     fileUpload({
          limits: { fileSize: 10 * 1024 * 1024 * 1024 },
          useTempFiles: false,
          // tempFileDir: "/tmp/",
     })
);

app.use(
     "/static/images",
     express.static(path.join(__dirname, "public/static"))
);

app.get("/", (req, res) => {
     res.json({
          status: 200,
          message: "REEPLAY API BASE_URL",
     });
});

app.get("/health", (req, res) => {
     res.json({ status: "ok", service: "reeplay-backend" });
});

app.get("/ready", (req, res) => {
     const ready = mongoose.connection.readyState === 1;
     res.status(ready ? 200 : 503).json({
          status: ready ? "ready" : "not_ready",
          database: ready ? "connected" : "disconnected",
     });
});

app.use("/api/v1", routes);

module.exports = app;
