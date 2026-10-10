const params = new URLSearchParams(location.search);
const role = params.get('role');
if (role !== 'creator' && role !== 'brand') location.replace('/');

document.body.dataset.role = role;
document.getElementById('roleTag').textContent = role === 'creator' ? 'AI Creator' : 'Brand';

const $ = (id) => document.getElementById(id);
const stepEmail = $('stepEmail'), stepOtp = $('stepOtp'), errorBox = $('error');
const emailInput = $('email'), otpInput = $('otp');
const sendBtn = $('sendBtn'), verifyBtn = $('verifyBtn'), resendBtn = $('resendBtn');
let timer = null;

const showError = (msg) => (errorBox.textContent = msg || '');

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong.'), { data });
  return data;
}

function startCountdown(seconds) {
  clearInterval(timer);
  let left = seconds;
  const tick = () => {
    resendBtn.disabled = left > 0;
    resendBtn.textContent = left > 0 ? `Resend code in ${left}s` : 'Resend code';
    if (left-- <= 0) clearInterval(timer);
  };
  tick();
  timer = setInterval(tick, 1000);
}

async function requestCode(isResend) {
  showError('');
  const email = emailInput.value.trim();
  const btn = isResend ? resendBtn : sendBtn;
  btn.disabled = true;
  try {
    const data = await post('/api/auth/request-otp', { email, role });
    stepEmail.classList.add('hidden');
    stepOtp.classList.remove('hidden');
    $('otpSub').textContent = `We sent a code to ${email}. It expires in 5 minutes.`;
    otpInput.value = '';
    otpInput.focus();
    startCountdown(data.resendIn || 60);
  } catch (err) {
    showError(err.message);
    if (err.data && err.data.wait && isResend) startCountdown(err.data.wait);
  } finally {
    if (!isResend) btn.disabled = false;
  }
}

sendBtn.addEventListener('click', () => requestCode(false));
emailInput.addEventListener('keydown', (e) => e.key === 'Enter' && requestCode(false));
resendBtn.addEventListener('click', () => requestCode(true));

$('changeEmail').addEventListener('click', () => {
  clearInterval(timer);
  showError('');
  stepOtp.classList.add('hidden');
  stepEmail.classList.remove('hidden');
  emailInput.focus();
});

otpInput.addEventListener('input', () => {
  otpInput.value = otpInput.value.replace(/\D/g, '').slice(0, 6);
  if (otpInput.value.length === 6) verify();
});
verifyBtn.addEventListener('click', verify);
otpInput.addEventListener('keydown', (e) => e.key === 'Enter' && verify());

async function verify() {
  if (verifyBtn.disabled) return;
  showError('');
  const otp = otpInput.value.trim();
  if (otp.length !== 6) return showError('Enter the 6-digit code.');
  verifyBtn.disabled = true;
  try {
    const data = await post('/api/auth/verify-otp', { email: emailInput.value.trim(), otp, role });
    location.href = data.redirect;
  } catch (err) {
    showError(err.message);
    otpInput.select();
    verifyBtn.disabled = false;
  }
}

emailInput.focus();
