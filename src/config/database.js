const mongoose = require("mongoose");

const connectDatabase = async () => {
     if (!process.env.MONGO_URL) {
          throw new Error("MONGO_URL is required");
     }

     await mongoose.connect(process.env.MONGO_URL, {
          dbName: process.env.MONGO_DB_NAME || "reeplayDB",
     });
     console.log("DB connected");
};

const disconnectDatabase = () => mongoose.disconnect();

module.exports = { connectDatabase, disconnectDatabase };
