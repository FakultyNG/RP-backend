const request = require("supertest");
// const expect = require("chai").expect
const app = require("../src/app");
const path = require("path");
const fs = require("fs");

const customerToken = process.env.TEST_CUSTOMER_TOKEN;

const timeOut = 2 * 60 * 1000;

const externalDescribe =
     process.env.RUN_EXTERNAL_TESTS === "true" ? describe : describe.skip;

externalDescribe("User Media Controller", () => {
     describe("GET /api/v1/customers/profile/fetch", () => {
          it(
               "should fetch customer profile successfully",
               async () => {
                    const res = await request(app)
                         .get("/api/v1/customers/profile/fetch")
                         .set("Accept", "application/json")
                         .set("Content-Type", "application/json")
                         .set("customer-auth", customerToken);

                    expect(res.status).toBe(200);
                    //  expect(res.body).toHaveProperty("fileUrl");
                    //  expect(res.body.fileUrl).not.toBeNull();
               },
               timeOut
          );
     });

     describe("POST /api/v1/customers/media/upload-photo", () => {
          it(
               "should upload an image successfully",
               async () => {
                    const filePath = path.resolve(
                         __dirname,
                         "test-upload.jpeg"
                    );
                    console.log(`Attempting to upload file from: ${filePath}`);

                    const res = await request(app)
                         .post("/api/v1/customers/media/upload-photo")
                         .set("customer-auth", customerToken)
                         .set("Content-Type", "multipart/form-data")
                         .field("fileName", "testing upload with unit-testing")
                         .attach(
                              "photo",
                              fs.readFileSync(`${__dirname}/test-upload.jpeg`),
                              "tests/test-upload.jpeg"
                         );

                    expect(res.status).toBe(200);
                    //  expect(res.body).toHaveProperty("fileUrl");
                    //  expect(res.body.fileUrl).not.toBeNull();
               },
               timeOut
          );
     });
});
