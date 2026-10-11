// Gmail displays app passwords in groups. Normalize that presentation only;
// never alter company passwords or record credential values.
export function mailPassword(serverProfile,password){
  if(typeof password!=='string')throw Error('mail_input_invalid');
  if(serverProfile!=='gmail_test')return password;
  const value=password.replace(/\s/gu,'');
  if(!/^[\x21-\x7e]{16}$/.test(value))throw Error('mail_gmail_app_password_format');
  return value;
}
