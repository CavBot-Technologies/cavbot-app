import fs from "fs";
import pg from "pg";
import dotenv from "dotenv";

const env = dotenv.parse(fs.readFileSync("/Users/cmarvinpl/Documents/GitHub/cavbot-app/.env.local"));
const founderEmail = String(env.CAVBOT_FOUNDER_EMAIL || "").trim().toLowerCase();
const founderTitle = String(env.CAVBOT_FOUNDER_POSITION_TITLE || "Founder & CEO").trim();
const founderCode = String(env.CAVBOT_FOUNDER_STAFF_CODE || "").trim();

if (!founderEmail) {
  throw new Error("CAVBOT_FOUNDER_EMAIL is missing");
}

const url = new URL(env.DATABASE_URL);
url.searchParams.delete("pool");

const client = new pg.Client({ connectionString: url.toString() });
await client.connect();

try {
  const sql = `
    update "StaffProfile" sp
       set "positionTitle" = $1,
           "systemRole" = 'OWNER',
           "status" = 'ACTIVE',
           "onboardingStatus" = 'COMPLETED',
           "staffCode" = coalesce(nullif($2, ''), sp."staffCode")
      from "User" u
     where sp."userId" = u.id
       and lower(u.email) = $3
    returning sp.id, sp."staffCode", sp."positionTitle"
  `;

  const result = await client.query(sql, [founderTitle, founderCode, founderEmail]);
  console.log(JSON.stringify(result.rows[0] || null));
} finally {
  await client.end();
}
