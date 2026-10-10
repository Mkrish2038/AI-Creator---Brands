fetch('/api/me')
  .then((r) => (r.ok ? r.json() : Promise.reject()))
  .then((me) => { document.getElementById('email').textContent = me.email; })
  .catch(() => location.replace('/'));

document.getElementById('logout').addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.replace('/');
});
