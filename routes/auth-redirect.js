"use strict";
import dotenv from "dotenv";
import { generateOAuthClient } from "../utils/helpers.js";

dotenv.config();

export default async function (fastify, opts) {
  fastify.get("/v1/user/auth-redirect", async function (request, reply) {
    try {
      if (!request?.query?.code && !request?.query?.state) {
        return reply.code(400).send({
          error: "Request missing auth code and state",
        });
      }

      const authCode = request.query.code;
      const authClient = await generateOAuthClient();

      const authState = JSON.parse(request.query.state);
      const { tokens } = await authClient.getToken(authCode);

      await fastify.firebase
        .firestore()
        .collection("user")
        .add({
          integrations: [
            {
              provider: "google",
              dateInstalled: new Date().toISOString(),
              tokens,
            },
          ],
          userId: authState?.userId,
          updatedAt: new Date().toISOString(),
          dateCreated: new Date().toISOString(),
        });

      return reply.send({
        message: "Accounts have been successfully connected!",
      });
    } catch (error) {
      console.log("ERROR GETTING REDIRECT =>", error);

      return reply.code(500).send({
        message: "Error connecting accouts. Please try again later.",
      });
    }
  });
}
