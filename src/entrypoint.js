const serviceMode = process.env.SERVICE_MODE || "api";

if (serviceMode === "media") {
     require("./media-server");
} else {
     require("./index");
}
