export const isYouTubeUrl = (value: string | undefined | null) =>
  typeof value === 'string' &&
  /^(?:https?:\/\/)?(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(value.trim())
