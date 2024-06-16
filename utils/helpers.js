import dotenv from "dotenv";
import { OAuth2Client } from "google-auth-library";
import { SPREADSHEET_SCOPES } from "../constants/index.js";

dotenv.config();

export const generateOAuthClient = async () => {
  const client = new OAuth2Client({
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  });

  return client;
};

export const extractHeaderToken = (header) => {
  const token = header?.split("Bearer ")[1];

  return token;
};

export const retrieveHighestScore = (scores) => {
  if (!scores) return null;

  return scores.reduce((acc, cur) => (cur.Score > acc.Score ? cur : acc), {
    Score: 0,
  });
};

export const compileEntities = (entities) => {
  if (!entities) return null;

  for (const item of entities) {
    if (Object.hasOwn(item, "Company_Name")) {
      return {
        "Company Name": item["Company_Name"],
      };
    }

    if (Object.hasOwn(item, "Status")) {
      return {
        Status: item["Status"],
      };
    }

    if (Object.hasOwn(item, "Job_Role")) {
      return {
        "Job Role": item["Job_Role"],
      };
    }
  }
};

export const authorize = async (userId) => {
  const client = await generateOAuthClient();

  const authorizeUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SPREADSHEET_SCOPES,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    state: JSON.stringify({
      userId,
    }),
  });

  return authorizeUrl;
};

export const authorizeWithToken = async (integrations) => {
  try {
    const googleIntegration = integrations.find((item) => item.provider === "google")
    const client = await generateOAuthClient();

    client.setCredentials(googleIntegration?.tokens);

    return client;
  } catch (error) {
    console.log("ERROR AUTHORIZING WITH TOKEN =>", error);
  }
};

export const cleanUpInputText = (text) => {
  const withoutURLs = text.replace(/(?:https?|ftp):\/\/[\n\S]+/g, "");
  const withoutSpecialChars = withoutURLs.replace(/[^\w\s]/gi, "");
  const withoutSpaces = withoutSpecialChars.replace(/\s+/g, " ").trim();
  const withoutNumbers = withoutSpaces.replace(/[0-9]/g, "");

  return withoutNumbers;
};

export const truncateText = (text, length = 200) => {
  if (!text) return null;

  const arr = text.split(" ").slice(0, length);

  return arr.join(" ");
};
