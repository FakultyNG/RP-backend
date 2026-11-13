const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "mongodb"]);

const enabled = (name, fallback = false) => {
     const value = process.env[name];
     if (value === undefined) return fallback;
     return value.toLowerCase() === "true";
};

const assertSafeEnvironment = () => {
     const environment = process.env.NODE_ENV || "production";
     if (!['development', 'test'].includes(environment)) return;

     if (!process.env.MONGO_URL) {
          throw new Error("MONGO_URL is required for local development and tests");
     }

     let mongoUrl;
     try {
          mongoUrl = new URL(process.env.MONGO_URL);
     } catch {
          throw new Error("MONGO_URL is not a valid MongoDB connection URL");
     }

     if (
          !LOCAL_HOSTS.has(mongoUrl.hostname) &&
          !enabled("ALLOW_REMOTE_DEV_DATABASE")
     ) {
          throw new Error(
               `Refusing remote MongoDB host '${mongoUrl.hostname}' in ${environment}. ` +
                    "Use a local database or explicitly set ALLOW_REMOTE_DEV_DATABASE=true."
          );
     }

     const hasAwsCredentials = Boolean(
          process.env.S3ACCESS_KEY ||
               process.env.S3SECRET_KEY ||
               process.env.IAM_ROLE_ARN
     );
     if (hasAwsCredentials && !enabled("ALLOW_AWS_IN_DEVELOPMENT")) {
          throw new Error(
               "AWS credentials are configured in local/test mode but ALLOW_AWS_IN_DEVELOPMENT is not true"
          );
     }
     if (enabled("ALLOW_AWS_IN_DEVELOPMENT")) {
          if (!process.env.S3_BUCKET) {
               throw new Error("S3_BUCKET is required when local AWS access is enabled");
          }
          if (
               process.env.S3_BUCKET === "reeplay" &&
               !enabled("ALLOW_PRODUCTION_RESOURCES_IN_DEVELOPMENT")
          ) {
               throw new Error(
                    "Refusing the known production S3 bucket in local/test mode"
               );
          }
     }

     const paymentKey = process.env.PAYSTACK_SECRET_KEY || "";
     if (
          paymentKey &&
          !paymentKey.startsWith("sk_test_") &&
          !enabled("ALLOW_EXTERNAL_PAYMENTS")
     ) {
          throw new Error("Refusing a non-test Paystack key in local/test mode");
     }
};

module.exports = { assertSafeEnvironment, enabled };
