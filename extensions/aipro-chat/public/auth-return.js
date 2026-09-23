// Clear the transient code before messaging or rendering. Never write it to storage or logs.
const nonce = new URL(location.href).searchParams.get('attempt');
const query = location.hash.slice(1);
history.replaceState(null, '', location.pathname);
chrome.runtime.sendMessage({type: 'LOGIN_CALLBACK', nonce, query}).then(result => {
  if (!result?.ok) document.querySelector('[role="status"]').textContent = '누비에서 로그인을 다시 시작해 주세요';
}).catch(() => {
  document.querySelector('[role="status"]').textContent = '누비에서 로그인을 다시 시작해 주세요';
});
