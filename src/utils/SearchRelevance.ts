import { PipelineStage } from 'mongoose'

export const escapeSearchText = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export const buildTitleRelevanceStage = (textReg: RegExp): PipelineStage => {
  const options = textReg.ignoreCase ? 'i' : ''
  const source = textReg.source
  const title = { $ifNull: ['$title', ''] }

  return {
    $set: {
      searchRelevance: {
        $switch: {
          branches: [
            {
              case: { $regexMatch: { input: title, regex: `^${source}$`, options } },
              then: 0,
            },
            {
              case: { $regexMatch: { input: title, regex: `^${source}`, options } },
              then: 1,
            },
            {
              case: {
                $regexMatch: { input: title, regex: `(^|\\s)${source}`, options },
              },
              then: 2,
            },
            {
              case: { $regexMatch: { input: title, regex: source, options } },
              then: 3,
            },
          ],
          default: 4,
        },
      },
    },
  }
}
