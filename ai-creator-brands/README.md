# AI Creator - Brands

Gateway page -> email OTP login (no password) -> AI Creator Dashboard / Brand Dashboard.

## Run on your computer
1. Install Node.js LTS from https://nodejs.org
2. Open a terminal in this folder and run:  npm install
3. Run:  npm start
4. Open http://localhost:3000
   In test mode the OTP is printed in the terminal (no email setup needed).

## Put it online (free)
See the steps in the chat: GitHub + Neon (database) + Brevo (email) + Render (hosting).
Set these environment variables on Render:
  NODE_ENV=production
  JWT_SECRET=<long random text>
  DATABASE_URL=<Neon connection string>
  BREVO_API_KEY=<Brevo API key>
  MAIL_FROM=<sender email verified in Brevo>
  MAIL_FROM_NAME=AI Creator - Brands
Build command: npm install      Start command: npm start
