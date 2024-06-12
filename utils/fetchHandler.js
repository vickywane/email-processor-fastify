const BASE = process.env.BASE_FUNCTIONS_ENDPOINT;

export const makeRequest = async (endpoint, data) => {
  const request = await fetch(`${BASE}/${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  return request;
};
