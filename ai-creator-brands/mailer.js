// Sends the OTP email through Brevo's HTTP API (free: about 300 emails/day).
// If BREVO_API_KEY is empty, the OTP is printed in the terminal instead (testing mode).
async function sendOtpEmail(to, code, roleLabel) {
  const key = process.env.BREVO_API_KEY;

  if (!key) {
    console.log('\n================ TEST MODE: email not sent ================');
    console.log(` OTP for ${to} (${roleLabel}):  ${code}`);
    console.log('============================================================\n');
    return;
  }

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': key, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: {
        name: process.env.MAIL_FROM_NAME || 'AI Creator - Brands',
        email: process.env.MAIL_FROM,
      },
      to: [{ email: to }],
      subject: `${code} is your login code`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px">
          <h2 style="margin:0 0 8px">Your login code</h2>
          <p style="color:#444">Use this code to sign in as <b>${roleLabel}</b>. It expires in 5 minutes.</p>
          <p style="font-size:34px;letter-spacing:8px;font-weight:bold;margin:20px 0">${code}</p>
          <p style="color:#888;font-size:13px">If you did not ask for this code, you can ignore this email.</p>
        </div>`,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brevo error ${res.status}: ${text}`);
  }
}

module.exports = { sendOtpEmail };
