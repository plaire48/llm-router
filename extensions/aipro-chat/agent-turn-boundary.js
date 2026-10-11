// Pi 0.87 calls finishTurn before turn_end, including errors/aborts. Older
// shared hosts still use 0.86's normal-response-only shouldStopAfterTurn.
// Keep both contracts while browser and other hosts upgrade independently.
export function userWaitHooks(stopForUser) {
  return {
    finishTurn: turn => {
      if (['error', 'aborted'].includes(turn.message.stopReason)) return;
      if (stopForUser()) return {action: 'end'};
    },
    shouldStopAfterTurn: () => stopForUser(),
  };
}
