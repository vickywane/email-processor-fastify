"use strict";
import dotenv from "dotenv";
import {
  extractHeaderToken,
  authorize,
} from "../utils/helpers.js";

dotenv.config();

/**
 *
 */

export default async function (fastify, opts) {
  fastify.get("/", async function (request, reply) {
    return reply.send({ data: "Index Route" });
  });

  fastify.get("/status", async function (request, reply) {
    return reply.send({ data: "Application is running!" });
  });

  fastify.get("/integrate", async function (request, reply) {
    try {
      const token = extractHeaderToken(request.headers?.authorization);

      const userAuthInfo = await fastify.firebase.auth().verifyIdToken(token);
      const sheetsArr = [];

      if (!userAuthInfo) {
        return reply.code(404).send({
          message: `User for ${body?.accessToken} not found.`,
        });
      }

      const sheetRef = fastify.firebase
        .firestore()
        .collection("application-sheets");

      const sheetSnapShot = await sheetRef
        .where("userId", "==", userAuthInfo?.user_id)
        .get();

      const userSheetRef = fastify.firebase
        .firestore()
        .collection("user")
        .doc(userAuthInfo?.user_id);

      const userData = (await userSheetRef.get()).data();

      if (!sheetSnapShot.empty) {
        sheetSnapShot.forEach((doc) => sheetsArr.push?.(doc.data()));
      }

      return reply.send({
        integrations: sheetsArr,
      });
    } catch (error) {
      console.log("ERROR GETTING SHEETS =>", error);

      return reply
        .code(400)
        .send({ message: `Error getting user sheets data` });
    }
  });

  fastify.post("/installation", async function (request, reply) {
    try {
      const token = extractHeaderToken(request.headers?.authorization);
      const userAuthInfo = await fastify.firebase.auth().verifyIdToken(token);

      if (!userAuthInfo) {
        return reply.code(400).send({
          message: `User for ${token} not found.`,
        });
      }

      const googleAuthUrl = await authorize(userAuthInfo?.user_id);

      return reply.send({ data: googleAuthUrl });
    } catch (error) {
      console.log("ERROR INSTALLING =>", error);
    }
  });

  fastify.get("/user", async function (request, reply) {
    try {
      const token = extractHeaderToken(request.headers?.authorization);
      const userAuthInfo = await fastify.firebase.auth().verifyIdToken(token);

      if (!userAuthInfo) {
        return reply.code(404).send({
          message: `User for ${token} not found.`,
        });
      }

      let user = [];

      const userSheetRef = fastify.firebase.firestore().collection("user");

      const userData = await userSheetRef
        .where("userId", "==", userAuthInfo?.user_id)
        .get();

      if (userData.empty) {
        return reply.code(404).send({ message: "Error getting user data" });
      }

      userData.forEach((doc) => {
        const details = doc.data();

        details?.integrations?.forEach((integration) => {
          user.push({
            provider: integration?.provider,
            dateInstalled: integration?.dateInstalled,
          });
        });
      });

      return reply.send({ data: user });
    } catch (error) {
      console.log("ERROR GETTING USER =>", error);

      return reply.code(400).send({ message: "Error getting user data" });
    }
  });
}
