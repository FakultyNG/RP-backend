const { getFirebaseAdmin } = require("../firebase/firebase");
const NotificationsModel = require("../models/notifications.model");
const UserDeviceModel = require("../models/userDevice.model");

exports.sendPushNotification = async (title, body, notificationData = {}) => {
     try {
          const admin = getFirebaseAdmin();
          // Get all user devices
          const userDevices = await UserDeviceModel.find({
               user_id: notificationData.user_id,
          });

          // Send to all user devices
          const notifications = userDevices.map((device) => ({
               token: device.device_token,
               notification: {
                    title,
                    body,
               },
               data: {
                    ...notificationData,
                    click_action: "NOTIFICATION_CLICK",
                    // Add any additional data needed by the frontend
                    notification_id: notificationData._id?.toString(),
                    type: notificationData.type,
               },
               android: {
                    priority: "high",
                    notification: {
                         channelId: "default_channel",
                         sound: "default",
                    },
               },
               apns: {
                    payload: {
                         aps: {
                              sound: "default",
                         },
                    },
               },
          }));

          // Send notifications in parallel
          const results = await Promise.all(
               notifications.map((notification) =>
                    admin.messaging().send(notification)
               )
          );

          console.log("Push notifications sent:", results);
          return true;
     } catch (error) {
          console.error("Error sending push notification:", error);
          return false;
     }
};

exports.sendPush = async () => {
     const admin = getFirebaseAdmin();
     if (!process.env.FIREBASE_TEST_DEVICE_TOKEN) {
          throw new Error("FIREBASE_TEST_DEVICE_TOKEN is required");
     }
     const message = {
          token: process.env.FIREBASE_TEST_DEVICE_TOKEN,
          notification: {
               title: "Your Notification Title",
               body: "Your Notification Body",
          },
          data: {
               key1: "value1",
               key2: "value2",
          },
          android: {
               notification: {
                    channelId: "default_channel",
               },
          },
     };

     admin.messaging()
          .send(message)
          .then((response) => {
               console.log("Notification sent:", response);
          })
          .catch((error) => {
               console.error("Error sending notification:", error);
          });
};

exports.createNotification = async (data) => {
     return new Promise(async (resolve, reject) => {
          await new NotificationsModel(data).save();
          resolve(true);
     });
};
