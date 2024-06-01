import path from "path";

const CREDENTIALS_PATH = path.join(process.cwd(), "credentials.json");

export const extractHeaderToken = (header) => {
  const token = header?.split("Bearer ")[1];

  return token;
};

export const authorizeWithToken = async (token) => {
  try {
    const client = await generateOAuthClient();

    client.setCredentials(token);

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

export const generateOAuthClient = async () => {
  const localAuthCredFile = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(localAuthCredFile);
  const keyData = keys.installed || keys.web;

  const client = new OAuth2Client({
    clientId: keyData.client_id,
    clientSecret: keyData.client_secret,
    redirectUri: keyData.redirect_uris[0],
  });

  return client;
};
