"use strict";
import dotenv from "dotenv";
import throttle from "lodash.throttle";
import { GoogleSpreadsheet } from "google-spreadsheet";
import { google } from "googleapis";
import { SPREADSHEET_SCOPES } from "../constants/index.js";
import {
  extractHeaderToken,
  cleanUpInputText,
  authorize,
  retrieveHighestScore,
  generateOAuthClient,
  truncateText,
} from "../utils/helpers.js";

dotenv.config();

/**
 *
 */

const throttleAction = async ({ interval, callback }) => {
  let intervalId;

  intervalId = setTimeout(async () => await callback(), interval);
};

export default async function (fastify, opts) {
  fastify.get("/", async function (request, reply) {
    return reply.send({ data: "Index Route" });
  });

  fastify.get("/status", async function (request, reply) {
    return reply.send({ data: "Application is running!" });
  });

  fastify.post("/authenticate", async function ({ body }, reply) {
    try {
      if (!body?.email || !body?.password) {
        return reply.code(400).send({
          error: "Email and password are required",
        });
      }
      const { email, password } = body;

      return reply.send({ message: "Authentication successful" });
    } catch (error) {
      console.log("ERROR AUTHENTICATING =>", error);
    }
  });

  fastify.get("/auth-redirect", async function (request, reply) {
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
        .doc(authState?.userId)
        .set({
          googleTokens: tokens,
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

  // TODO: handle the google auth token flow here!
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

  fastify.post("/integrate", async function ({ body, headers }, reply) {
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

      const service = google.sheets({ version: "v4", auth });

      // TODO: Figure out how to create a default sheet with the desired fields without creating a seperate document.
      const documentName = body?.name || "Tracker Sheet";
      const sheetHeaderValues = body?.columns || [
        "name",
        "link",
        "date",
        "status",
      ];

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
          tracking: sheetHeaderValues,
          lastSync: new Date().toISOString(),
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

  fastify.post("/sync", async function ({ headers, body }, reply) {
    try {
      const token = extractHeaderToken(headers?.authorization);
      const userAuthInfo = await fastify.firebase.auth().verifyIdToken(token);

      if (!userAuthInfo) {
        return reply.code(404).send({
          message: `User for ${token} not found.`,
        });
      }

      const userRef = fastify.firebase
        .firestore()
        .collection("user")
        .doc(userAuthInfo?.user_id);

      const userData = (await userRef.get()).data();
      const auth = await authorizeWithToken(userData?.googleTokens);

      if (!auth) {
        return reply
          .code(500)
          .send({ message: "Error authenticating with Google 0Auth client" });
      }

      const gmail = google.gmail({ version: "v1", auth });

      const { data } = await gmail.users.messages.list({
        userId: "me",
      });

      for (const item of data.messages) {
        const { data: messageData } = await gmail.users.messages.get({
          id: item?.id,
          userId: "me",
        });

        const parts = messageData.payload.parts;
        let emailBody = "";

        if (parts && parts.length) {
          parts.forEach((part) => {
            if (part.mimeType === "text/plain") {
              emailBody = Buffer.from(part.body.data, "base64").toString(
                "utf8"
              );
            }
          });
        }

        if (emailBody.length >= 10) {
          const cleanedText = cleanUpInputText(emailBody);
          const processedText = truncateText(cleanedText, 50);

          // throttleAction({
          //   callback: async () => {

          const externalRequest = await fetch(process.env.CLASSIFIER_ENDPOINT, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: processedText }),
          });

          const data = await externalRequest.json();

          // console.log("DATA =>", data);

          // if (Object.hasOwn(data, "Score")) {
          const highestScore = retrieveHighestScore(data);

          const document = new GoogleSpreadsheet(body?.documentId, auth);
          await document.loadInfo();

          const defaultSheet = document.sheetsByIndex[0];

          // const headers = defaultSheet.headerValues

          await defaultSheet.addRow({
            Status: highestScore?.Name,
            "Date Applied": new Date().toLocaleDateString(),
            Name: "",
          });

          console.log("\n HIGHEST SCORE =>", highestScore, " \n");

          // store result in google sheet
          // }

          // console.log(
          //   " \n\n\n START \n\n\n",
          //   processedText,
          //   " \n\n\n END \n\n\n"
          // );
          //   },
          //   interval: 30000,
          // });
        }
      }

      reply.send({ message: "Data Synced" });
    } catch (error) {
      console.log("Syncing data", error);

      reply.code(400).send({ message: "Error syncing data" });
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
