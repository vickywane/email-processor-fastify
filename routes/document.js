"use strict";
import dotenv from "dotenv";
import { GoogleSpreadsheet } from "google-spreadsheet";
import {
  extractHeaderToken,
  authorizeWithToken,
  cleanUpInputText,
  truncateText,
  compileEntities,
} from "../utils/helpers.js";
import { google } from "googleapis";
import { makeRequest } from "../utils/fetchHandler.js";

dotenv.config();

export default async function (fastify, opts) {
  fastify.get("/v1/document", async function ({ query, headers }, reply) {
    if (!query?.slug) {
      return reply.code(400).send({
        error: "slug missing from query parameters",
      });
    }

    const token = extractHeaderToken(headers?.authorization);

    if (!token) {
      return reply.code(400).send({
        message: `Token not specified in request headers.`,
      });
    }

    try {
      const userAuthInfo = await fastify.firebase.auth().verifyIdToken(token);

      if (!userAuthInfo) {
        return reply.code(400).send({
          message: `User for ${token} not found.`,
        });
      }

      const applicationSheetRef = fastify.firebase
        .firestore()
        .collection("application-sheets");

      let applicationDoc = null;
      const appDocQuery = await applicationSheetRef
        .where("slug", "==", query?.slug)
        .get();

      if (appDocQuery.empty) {
        return reply.code(404).send({
          message: `Document not found for ${query?.slug}`,
        });
      }

      appDocQuery.forEach((doc) => (applicationDoc = doc.data()));

      let user = null;
      const userSheetRef = fastify.firebase.firestore().collection("user");

      const userData = await userSheetRef
        .where("userId", "==", userAuthInfo?.user_id)
        .get();

      userData.forEach((doc) => (user = doc.data()));

      if (!userData || userData.empty) {
        return reply.code(404).send({
          message: `User not found.`,
        });
      }

      const googleAuth = await authorizeWithToken(user?.integrations);

      if (!googleAuth) {
        return reply
          .code(500)
          .send({ message: "Error authenticating with Google 0Auth client" });
      }

      const document = new GoogleSpreadsheet(
        applicationDoc?.documentId,
        googleAuth
      );
      await document.loadInfo();

      const sheet = document.sheetsByIndex[0];
      const sheetRows = await sheet.getRows();

      const allExtractedSheetData = [];

      if (sheetRows) {
        for (const item of sheetRows) {
          const companyName = item?.get("Company Name");
          const jobLink = item?.get("Job Link");
          const dateApplied = item?.get("Date Applied");
          const status = item?.get("Status");
          const description = item?.get("Description");

          allExtractedSheetData.push({
            companyName,
            jobLink,
            dateApplied,
            status,
            description,
          });
        }
      }

      return reply.send({
        data: allExtractedSheetData,
        tracking: sheet.headerValues,
      });
    } catch (error) {
      console.error("Error fetching document", error);

      return reply.code(500).send({
        message: `Error: ${error}`,
      });
    }
  });

  // create a document
  fastify.post("/v1/document", async function ({ body, headers }, reply) {
    try {
      const token = extractHeaderToken(headers?.authorization);
      const userAuthInfo = await fastify.firebase.auth().verifyIdToken(token);

      if (!userAuthInfo) {
        return reply.code(404).send({
          message: `User for ${token} not found.`,
        });
      }

      let user = null;
      const userSheetRef = fastify.firebase.firestore().collection("user");

      const userData = await userSheetRef
        .where("userId", "==", userAuthInfo?.user_id)
        .get();

      userData.forEach((doc) => (user = doc.data()));

      if (!userData || userData.empty) {
        return reply.code(404).send({
          message: `User not found.`,
        });
      }

      const auth = await authorizeWithToken(user?.integrations);

      if (!auth) {
        return reply
          .code(500)
          .send({ message: "Error authenticating with Google 0Auth client" });
      }

      if (body?.columns.length < 1) {
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

  fastify.post("/v1/document/sync", async function ({ headers, body }, reply) {
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

      let user = null;

      const userData = await userRef
        .where("userId", "==", userAuthInfo?.user_id)
        .get();

      if (!userData || userData.empty) {
        return reply.code(404).send({
          message: `User not found.`,
        });
      }
      
      userData.forEach((doc) => (user = doc.data()));
      const auth = await authorizeWithToken(user?.integrations);

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

            const classifyTextRequest = await makeRequest("/classifytext", {
              text: processedText,
            });

            if (classifyTextRequest.status !== 200) {
              console.log("\n CLASSIFY TEXT ERROR =>", classifyTextRequest);

              return reply
                .code(500)
                .send({ message: "Unable to process text from email" });
            }

            const classificationData = await classifyTextRequest.json();

            if (
              classificationData?.category === "Accepted" ||
              classificationData?.category === "Rejected"
            ) {
              const extractEntitiesRequest = await makeRequest(
                "/extracttextentities",
                { text: processedText }
              );

              if (extractEntitiesRequest?.status !== 200) {
                return reply
                  .code(500)
                  .send({ message: "Unable to extract entities from email" });
              }

              const entitiesData = await extractEntitiesRequest?.json();

              if (entitiesData?.length > 0) {
                const document = new GoogleSpreadsheet(body?.documentId, auth);
                await document.loadInfo();
                const defaultSheet = document.sheetsByIndex[0];

                const rowData = compileEntities(entitiesData);

                await defaultSheet.addRow({
                  Status: classificationData?.category,
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
}
