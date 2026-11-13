const { assertSafeEnvironment } = require("../src/config/environment");

describe("local environment safety", () => {
     const original = { ...process.env };

     beforeEach(() => {
          process.env.NODE_ENV = "test";
          process.env.MONGO_URL = "mongodb://127.0.0.1:27017/reeplay_test";
          process.env.ALLOW_REMOTE_DEV_DATABASE = "false";
          process.env.ALLOW_AWS_IN_DEVELOPMENT = "false";
          process.env.ALLOW_PRODUCTION_RESOURCES_IN_DEVELOPMENT = "false";
          process.env.S3ACCESS_KEY = "";
          process.env.S3SECRET_KEY = "";
          process.env.IAM_ROLE_ARN = "";
          process.env.S3_BUCKET = "";
          process.env.PAYSTACK_SECRET_KEY = "";
          process.env.ALLOW_EXTERNAL_PAYMENTS = "false";
     });

     afterAll(() => {
          for (const key of Object.keys(process.env)) {
               if (!(key in original)) delete process.env[key];
          }
          Object.assign(process.env, original);
     });

     it("accepts an isolated local configuration", () => {
          expect(() => assertSafeEnvironment()).not.toThrow();
     });

     it("rejects an unapproved remote database", () => {
          process.env.MONGO_URL =
               "mongodb+srv://example.invalid/reeplay-production";

          expect(() => assertSafeEnvironment()).toThrow(
               /Refusing remote MongoDB host/
          );
     });

     it("rejects the known production bucket in local mode", () => {
          process.env.ALLOW_AWS_IN_DEVELOPMENT = "true";
          process.env.S3_BUCKET = "reeplay";

          expect(() => assertSafeEnvironment()).toThrow(
               /Refusing the known production S3 bucket/
          );
     });

     it("rejects a live payment key", () => {
          process.env.PAYSTACK_SECRET_KEY = "sk_live_example";

          expect(() => assertSafeEnvironment()).toThrow(
               /Refusing a non-test Paystack key/
          );
     });
});
