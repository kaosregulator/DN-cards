import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" });

let itemCount = null;
page.on("console", msg => console.log("PAGE LOG:", msg.text().slice(0, 200)));

await page.goto("https://mttvalues.com", { waitUntil: "networkidle", timeout: 30000 });

// wait for items array to populate
try {
  await page.waitForFunction(() => window.items && window.items.length > 0, { timeout: 15000 });
} catch (e) {
  console.log("waitForFunction failed:", e.message);
}

const items = await page.evaluate(() => {
  try {
    return typeof items !== "undefined" ? items.length : "items not in scope";
  } catch (e) {
    return "ERR: " + e.message;
  }
});
console.log("items result:", items);

await browser.close();
