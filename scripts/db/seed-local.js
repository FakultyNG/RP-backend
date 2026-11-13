require("../../src/config/load-env");

const { assertSafeEnvironment } = require("../../src/config/environment");
const {
     connectDatabase,
     disconnectDatabase,
} = require("../../src/config/database");
const { EncryptPass } = require("../../src/utils/bcrypt");
const Users = require("../../src/models/users.model");
const Wallet = require("../../src/models/wallet.model");
const Settings = require("../../src/models/userSettings.model");
const Videos = require("../../src/models/videos.model");

const seed = async () => {
     assertSafeEnvironment();
     await connectDatabase();

     const password = await EncryptPass("ReeplayTest123!");
     const user = await Users.findOneAndUpdate(
          { email: "customer@local.reeplay.test" },
          {
               first_name: "test",
               last_name: "customer",
               email: "customer@local.reeplay.test",
               country_code: "+234",
               mobile: "0000000000",
               password,
               role: "customer",
               verified: true,
               approved: true,
               suspended: false,
               gender: "nil",
               country: "nigeria",
          },
          { upsert: true, new: true, runValidators: true }
     );

     const admin = await Users.findOneAndUpdate(
          { email: "admin@local.reeplay.test" },
          {
               first_name: "test",
               last_name: "admin",
               email: "admin@local.reeplay.test",
               country_code: "+234",
               mobile: "0000000001",
               password,
               role: "superadmin",
               verified: true,
               approved: true,
               suspended: false,
               gender: "nil",
               country: "nigeria",
          },
          { upsert: true, new: true, runValidators: true }
     );

     await Wallet.findOneAndUpdate(
          { user_id: user._id },
          { user_id: user._id, balance: 10000 },
          { upsert: true, new: true }
     );
     await Settings.findOneAndUpdate(
          { user_id: user._id },
          {
               user_id: user._id,
               interest: ["test drama"],
               watchlist: [],
               video_quality: "720p",
               allow_notifications: false,
          },
          { upsert: true, new: true }
     );
     await Videos.findOneAndUpdate(
          { title: "The BackWay — Local Test Fixture" },
          {
               admin_id: admin._id,
               title: "The BackWay — Local Test Fixture",
               sub_title: "Synthetic development data",
               type: "movie",
               description: "Fictional metadata for isolated local testing only.",
               vid_class: "free",
               pg: "PG-13",
               genre: ["test drama"],
               category: ["test content"],
               released_date: new Date("2025-01-01T00:00:00.000Z"),
               runtime: "90m",
               is_series: false,
               key: "local-fixtures/the-backway-test.mp4",
          },
          { upsert: true, new: true, runValidators: true }
     );

     console.log("Synthetic local data seeded successfully");
};

seed()
     .catch((error) => {
          console.error(`Seed failed: ${error.message}`);
          process.exitCode = 1;
     })
     .finally(disconnectDatabase);
