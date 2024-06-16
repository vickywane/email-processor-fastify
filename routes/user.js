"use strict";
import dotenv from "dotenv";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { google } from "googleapis";
import {
  extractHeaderToken,
  authorize,
  authorizeWithToken,
} from "../utils/helpers.js";

dotenv.config();

export default async function (fastify, opts) {
  fastify.get("/v1/user/integrate", async function (request, reply) {
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

  fastify.post("/v1/user/installation", async function (request, reply) {
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

  fastify.post("/v1/user/integrate", async function ({ body, headers }, reply) {
    try {
      const token = extractHeaderToken(headers?.authorization);
      const userAuthInfo = await fastify.firebase.auth().verifyIdToken(token);

      if (!userAuthInfo) {
        return reply.code(404).send({
          message: `User for ${token} not found.`,
        });
      }

      const userSheetRef = fastify.firebase
        .firestore()
        .collection("user")
        .doc(userAuthInfo?.user_id);

      const userData = (await userSheetRef.get()).data();

      const auth = await authorizeWithToken(userData?.googleTokens);

      if (!auth) {
        return reply
          .code(500)
          .send({ message: "Error authenticating with Google 0Auth client" });
      }

      if (body?.columns.length <= 1) {
        return reply.code(400).send({
          message: "Columns are required to create a new sheet",
        });
      } else if (!body?.name) {
        return reply.code(400).send({ message: "Document name is required" });
      }

      const service = google.sheets({ version: "v4", auth });

      const documentName = body?.name;
      const sheetHeaderValues = body?.columns;

      const { data } = await service.spreadsheets.create({
        resource: {
          properties: {
            title: documentName,
          },
        },
      });

      const document = new GoogleSpreadsheet(data.spreadsheetId, auth);

      await document.loadInfo();
      const defaultSheet = document.sheetsByIndex[0];

      await defaultSheet.setHeaderRow(sheetHeaderValues);

      await fastify.firebase
        .firestore()
        .collection("application-sheets")
        .add({
          documentId: data?.spreadsheetId,
          activeSheetId: defaultSheet?.sheetId,
          userId: userAuthInfo?.user_id,
          integrationType: ["google-spreadsheet"],
          documentName,
          documentLink: `https://docs.google.com/spreadsheets/d/${data?.spreadsheetId}`,
          slug: documentName.toLowerCase().replace(/\s/g, "-"),
          tracking: sheetHeaderValues,
          lastSync: null,
          dateCreated: new Date().toISOString(),
        });

      reply.send({ message: "Integration created successfully" });
    } catch (error) {
      console.log("ERROR CREATING SHEET =>", error);

      return reply
        .code(500)
        .send({ message: "Error creating sheet documents" });
    }
  });

  fastify.get("/v1/user", async function (request, reply) {
    try {
      const token = extractHeaderToken(request.headers?.authorization);
      const userAuthInfo = await fastify.firebase.auth().verifyIdToken(token);

      if (!userAuthInfo) {
        return reply.code(404).send({
          message: `User for ${token} not found.`,
        });
      }

      const userSheetRef = fastify.firebase
        .firestore()
        .collection("user")
        .doc(userAuthInfo?.user_id);

      const userData = (await userSheetRef.get()).data();

      reply.send({ data: userData });
    } catch (error) {
      console.log("ERROR GETTING USER =>", error);

      reply.code(400).send({ message: "Error getting user data" });
    }
  });
}
