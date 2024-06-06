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
  authorizeWithToken,
  compileEntities,
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
        maxResults: 35,
      });

      let totalProcessedEmails = 0;

      for (const item of data.messages) {
        const { data: messageData } = await gmail.users.messages.get({
          id: item?.id,
          userId: "me",
        });

        const processedTextRef = fastify.firebase
          .firestore()
          .collection("processed-texts")
          .doc(messageData?.threadId);

        const isEmailClassified = (await processedTextRef.get()).data();

        if (!isEmailClassified) {
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

            const classifyText = await fetch(process.env.CLASSIFIER_ENDPOINT, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ text: processedText }),
            });

            if (classifyText.status !== 200) {
              console.log("\n CLASSIFY TEXT ERROR =>", classifyText);

              return reply
                .code(500)
                .send({ message: "Unable to process text from email" });
            }

            const classificationData = await classifyText.json();
            const highestScore = retrieveHighestScore(classificationData);

            if (
              highestScore.Name === "REJECTION" ||
              highestScore.Name === "ACCEPTED"
            ) {
              const extractEntities = await fetch(process.env.EXTRACT_ENDPOINT, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({ text: processedText }),
              });

              if (extractEntities.status !== 200) {
                return reply
                  .code(500)
                  .send({ message: "Unable to extract entities from email" });
              }

              const entitiesData = await extractEntities.json();

              if (entitiesData?.length > 0) {
                const document = new GoogleSpreadsheet(body?.documentId, auth);
                await document.loadInfo();
                const defaultSheet = document.sheetsByIndex[0];

                const rowData = compileEntities(entitiesData);

                await defaultSheet.addRow({
                  Status: highestScore?.Name,
                  "Date Applied": new Date().toLocaleDateString(),
                  ...rowData,
                });

                totalProcessedEmails += 1;
              }
            }

            await fastify.firebase
              .firestore()
              .collection("processed-texts")
              .doc(messageData?.threadId)
              .set({
                processingResult: classificationData,
                textOriginId: messageData?.threadId,
                userId: userAuthInfo?.user_id,
                dateCreated: new Date().toISOString(),
                documentId: body?.documentId,
              });
          }
        }
      }

      const applicationsDocsRef = fastify.firebase
        .firestore()
        .collection("application-sheets");

      const userItems = await applicationsDocsRef
        .where("documentId", "==", body?.documentId)
        .get();

      userItems.forEach(async (doc) => {
        await doc.ref.update({
          lastSync: new Date().toISOString(),
        });
      });

      reply.send({
        message: `Sync process completed. ${
          totalProcessedEmails < 1
            ? "You dont have new emails to process"
            : `${totalProcessedEmails} emails were processed`
        }.`,
        status: "SYNC_SUCCESSFUL",
      });
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
