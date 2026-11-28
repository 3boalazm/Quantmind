// Prints a fresh VAPID key pair for phone notifications. Run once: `npm run vapid`.
// Put the three values in the hosting environment (Vercel → Settings → Environment Variables); never in the code.
import { generateVAPIDKeys } from "web-push";

const { publicKey, privateKey } = generateVAPIDKeys();
console.log("VAPID_PUBLIC_KEY=" + publicKey);
console.log("VAPID_PRIVATE_KEY=" + privateKey);
console.log("VAPID_SUBJECT=mailto:YOUR_EMAIL_HERE");
console.log("\nKeep the private key secret. Changing the pair later switches every phone off until it turns notifications on again.");
