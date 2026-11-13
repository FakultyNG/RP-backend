const request = require("supertest");
const app = require("../src/app");

describe("service health", () => {
     it("reports the process as healthy without contacting external services", async () => {
          const response = await request(app).get("/health");

          expect(response.status).toBe(200);
          expect(response.body).toEqual({
               status: "ok",
               service: "reeplay-backend",
          });
     });

     it("reports not ready when MongoDB is disconnected", async () => {
          const response = await request(app).get("/ready");

          expect(response.status).toBe(503);
          expect(response.body.database).toBe("disconnected");
     });
});
