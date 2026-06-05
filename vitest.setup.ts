import { config } from "dotenv";

// Load .env.local so DB-integration tests see DATABASE_URL. Pure tests ignore it.
config({ path: ".env.local" });
