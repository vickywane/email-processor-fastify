"use strict";
import dotenv from "dotenv";
import AutoLoad from "@fastify/autoload";
import admin from "firebase-admin";
import cors from "@fastify/cors";
import bearerAuthPlugin from "@fastify/bearer-auth";
import fastifyView from "@fastify/view";
import qs from "qs";
import path from "path";
import { fileURLToPath } from "url";
import Ejs from "ejs";
import Formbody from "@fastify/formbody";
import Firebase from "@now-ims/fastify-firebase";

dotenv.config();

// Pass --options via CLI arguments in command to enable these options.
const options = {};

// import serviceAccount from "./firebase-credential.json";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const keys = new Set(["Authorization"]);

export default async function (fastify, opts) {
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, "plugins"),
    options: Object.assign({}, opts),
  });

  fastify.register(Formbody, {
    parser: (str) => qs.parse(str),
  });

  fastify.register(fastifyView, {
    engine: {
      ejs: Ejs,
      root: "templates",
    },
  });
  fastify.register(Firebase, {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
    measurementId: process.env.FIREBASE_MEASUREMENT_ID,
    cert: {
      type: "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY,
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
      auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
      client_x509_cert_url: process.env.FIREBASE_CLIENT_CERT_URL,
      universe_domain: "googleapis.com",
    },
  });

  fastify.register(cors, {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  });

  // renable after splitting the routes into sensitive & non-sensitive
  // https://github.com/fastify/fastify-bearer-auth/issues/27
  // fastify.register(bearerAuthPlugin, {
  //   keys,
  //   errorResponse: (err) => {},
  //   bearerType: "Bearer",
  //   auth: () => true,
  // });

  // API routes... always load last
  fastify.register(AutoLoad, {
    dir: path.join(__dirname, "routes"),
    options: Object.assign({}, opts),
  });
}

// module.exports.options = options;
