const admin = require("firebase-admin");
const { enabled } = require("../config/environment");

const getCredential = () => {
     const encodedServiceAccount =
          process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

     if (!encodedServiceAccount) {
          return admin.credential.applicationDefault();
     }

     try {
          const serviceAccount = JSON.parse(
               Buffer.from(encodedServiceAccount, "base64").toString("utf8")
          );
          return admin.credential.cert(serviceAccount);
     } catch (error) {
          throw new Error(
               `Invalid FIREBASE_SERVICE_ACCOUNT_BASE64: ${error.message}`
          );
     }
};

const getFirebaseAdmin = () => {
     if (!enabled("ENABLE_FIREBASE", process.env.NODE_ENV === "production")) {
          throw new Error("Firebase is disabled in this environment");
     }

     if (admin.apps.length === 0) {
          admin.initializeApp({
               credential: getCredential(),
          });
     }

     return admin;
};

module.exports = { getFirebaseAdmin };
