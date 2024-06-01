const {
  ComprehendClient,
  ListDatasetsCommand,
} = require("@aws-sdk/client-comprehend")

const TEMP_ENDPOINT_ARN =
  "arn:aws:comprehend:us-east-1:807958623971:document-classifier-endpoint/victory-classifier-model-2-endpoint";

export const handler = async (event) => {
  const requestData = event.body;

  if (requestData?.text) {
    return {
      statusCode: 400,
      body: JSON.stringify("Email text is missing from request body!"),
    };
  }

  try {
    const comprehendClient = new ComprehendClient();
    const classifyTextCommand = new ListDatasetsCommand({
      Text: requestData?.text,
      EndpointArn: TEMP_ENDPOINT_ARN,
    });

    const result = await comprehendClient.send(classifyTextCommand);

    console.log("CLASSIFY RESULT =>", result);

    // TODO implement
    const response = {
      statusCode: 200,
      body: JSON.stringify(""),
    };

    return response;
  } catch (error) {
    console.log(error);

    return {
      statusCode: 501,
      body: error,
    };
  }
};
