// Read the extension host's clock, never a page-controlled timestamp. Do not
// cache the zone: the user can change PC settings while a task is running.
export function computerTime(now = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  const offset = -now.getTimezoneOffset();
  const utcOffset = `${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
  let timeZone;
  try {timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;} catch { /* Local components and offset remain usable. */ }
  return {
    source: 'user_computer_clock',
    local: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${utcOffset}`,
    weekday: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][now.getDay()],
    timeZone: timeZone || 'unavailable; use local UTC offset',
    utc: now.toISOString(),
  };
}

// A clock that changes on every request makes the first message of every
// request different, so a provider can reuse none of the prompt it has already
// processed. One sample serves a run for up to ten minutes. It is renewed at
// once when the local date or the UTC offset changes, or the clock moves back.
export const RUN_CLOCK_MAX_AGE_MS = 10 * 60 * 1000;
export function createRunClock({maxAgeMs = RUN_CLOCK_MAX_AGE_MS} = {}) {
  let sample;
  const day = date => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}/${date.getTimezoneOffset()}`;
  return (now = new Date()) => {
    if (!sample || now - sample > maxAgeMs || now < sample || day(now) !== day(sample)) sample = new Date(now.getTime());
    return sample;
  };
}

export function withComputerTime(messages, now = new Date(), {heldForMinutes = 0} = {}) {
  const block = `<nubi_computer_time>\n${JSON.stringify(computerTime(now))}\n${heldForMinutes > 0 ? `Sampled during this work, from the user's PC settings (not a verified server clock). The actual time can be up to ${heldForMinutes} minutes later; the sample is renewed when the local date changes.` : `Current as of this model request, from the user's PC settings (not a verified server clock).`} Use local date/time for current today, tomorrow and now unless the user specifies another zone. Preserve explicit or already resolved task dates across midnight and resumption; ask if an older relative date is ambiguous. Site timestamps may use another zone. Do not treat elapsed time as approval or scheduling capability.\n</nubi_computer_time>`;
  const index = messages.findIndex(message => message.role === 'system');
  if (index < 0) return [{role: 'system', content: block}, ...messages];
  return messages.map((message, i) => i === index ? {...message,
    content: `${message.content.replace(/\n*<nubi_computer_time>[\s\S]*?<\/nubi_computer_time>/g, '')}\n\n${block}`,
  } : message);
}
