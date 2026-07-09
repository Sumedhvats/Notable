import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { MongoClient } from "mongodb";

let _auth: ReturnType<typeof betterAuth> | null = null;
let _client: MongoClient | null = null;

export function initAuth() {
  if (_auth) throw new Error("Auth already initialized");

  const mongoUrl = process.env.MONGODB_URL;
  if (!mongoUrl) throw new Error("MONGODB_URL not set");

  const adminEmails =
    process.env.ADMIN_EMAILS?.split(",").map((e) => e.trim().toLowerCase()) ||
    [];

  _client = new MongoClient(mongoUrl);
  const db = _client.db();

  _auth = betterAuth({
    database: mongodbAdapter(db, { client: _client }),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL || "http://localhost:5000",

    emailAndPassword: {
      enabled: true,
    },

    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
      github: {
        clientId: process.env.GITHUB_CLIENT_ID!,
        clientSecret: process.env.GITHUB_CLIENT_SECRET!,
      },
    },

    user: {
      additionalFields: {
        role: {
          type: "string",
          required: true,
          defaultValue: "paid",
          input: false,
        },
      },
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user: { email: string; [key: string]: unknown }) => {
            const isAdmin = adminEmails.includes(user.email.toLowerCase());
            return {
              data: {
                ...user,
                role: isAdmin ? "admin" : "paid",
              },
            };
          },
        },
      },
    },
  } as any);

  return _auth;
}

export function getAuth() {
  if (!_auth) throw new Error("Auth not initialized. Call initAuth() first.");
  return _auth;
}

export async function closeAuth() {
  if (_client) {
    await _client.close();
    _client = null;
    _auth = null;
  }
}
