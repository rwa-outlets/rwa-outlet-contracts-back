import Fastify from "fastify";
import { env } from "./env.js";
import { registerRoutes } from "./routes/index.js";

const app = Fastify({
  logger: {
    level: env.NODE_ENV === "production" ? "info" : "debug",
    transport:
      env.NODE_ENV === "production"
        ? undefined
        : { target: "pino-pretty", options: { colorize: true } },
  },
});

// DO App Platform health check depends on this staying at GET /health, 200.
app.get("/health", async () => ({ status: "ok" }));

await app.register(registerRoutes, { prefix: "/api" });

app
  .listen({ port: env.PORT, host: "0.0.0.0" })
  .then((address) => app.log.info(`back listening on ${address}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
