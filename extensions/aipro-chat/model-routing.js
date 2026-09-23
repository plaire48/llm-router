import {attachmentVision} from './attachments.js';

const preferred = 'QWEN3.8-27B-FP8-256K';

// Only use models from the current provider's authenticated catalog. A model
// name from another account or a remembered example is not an available route.
export function visionModelFor(provider, selected, models = []) {
  if (attachmentVision(provider, selected?.name, selected)) return selected;
  const available = (Array.isArray(models) ? models : []).filter(model => attachmentVision(provider, model.name, model));
  return available.find(model => model.name.toUpperCase() === preferred) || available[0] || null;
}

export const hasImageInput = messages => messages.some(message => Array.isArray(message.content) && message.content.some(part => part.type === 'image_url'));

export function routeImageRequest(provider, selected, visionModel, messages) {
  if (!hasImageInput(messages) || attachmentVision(provider, selected.name, selected)) return selected;
  if (!visionModel || !attachmentVision(provider, visionModel.name, visionModel)) throw new Error('attachment_vision');
  return visionModel;
}
