export const SUPPORT_LANGUAGES = ["en", "zh-CN", "zh-TW", "fr", "de", "es", "ja"] as const;
export const SUPPORT_STATUSES = ["open", "pending", "resolved"] as const;

export function cleanSupportText(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

export function supportLanguage(value: unknown) {
  const language = cleanSupportText(value, 12);
  return (SUPPORT_LANGUAGES as readonly string[]).includes(language) ? language : "en";
}

export function supportStatus(value: unknown) {
  const status = cleanSupportText(value, 16);
  return (SUPPORT_STATUSES as readonly string[]).includes(status) ? status : null;
}

export function validSupportImage(value: unknown) {
  if (value == null || value === "") return null;
  const image = String(value);
  if (image.length > 1_500_000) return null;
  return /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i.test(image) ? image : null;
}
