import {imageComparison} from './image-comparison.js';
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== 'image-renderer' || sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('background.js')) return;
  imageComparison(message.result, new AbortController().signal).then(result => reply({ok: true, result}), () => reply({ok: false}));
  return true;
});
