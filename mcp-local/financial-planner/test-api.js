import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "dummy",
});

async function main() {
  const response = await openai.chat.completions.create({
    model: "gpt-5.5",
    messages: [{ role: "user", content: "test" }]
  });
  console.log(JSON.stringify(response, null, 2));
}

main().catch(console.error);
