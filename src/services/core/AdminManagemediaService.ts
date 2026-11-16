import { Request } from 'express'

import { LiveSchema } from '../../models/lives.model'
import { SubtitleModel } from '../../models/subtitle.model'
import { OperationalError } from '../../utils/OperationalError'
import { guranteeNumericResult, QueryParamsFeatures } from '../../utils/QueryParamsFeatures'
import { VideoModel } from '../../models/videos.model'
import { UserRepo } from '../../repositories/UserRepo'
import { LiveRepo } from '../../repositories/LiveRepo'
import { LiveMediaSourcesUtils } from '../../utils/LiveMediaSourcesUtils'
import { EpisodeModel } from '../../models/episodes.model'
import { MediaManagement } from '../media-management'
import { normalizeSubtitleToWebVtt } from '../../utils/subtitle'

export type AddSubtitleData = {
  parentId: string
  parentType: 'vod' | 'episode'
  language: string
  subtitle: Express.Multer.File
}

export class AdminManageMediaService {
  static searchClient = async (searchText: string, query: Request['query']) => {
    const { page, limit } = QueryParamsFeatures.paginagteParams(query)
    const regex = new RegExp(searchText, 'i')
    const clients = await UserRepo.adminFetchClientsBySearchAggr(regex, page, limit)
    return clients
  }

  static getLivesByType = async (type: string, query: Request['query']) => {
    const types: LiveSchema['type'][] = ['channel', 'event', 'podcast', 'sport', 'tvshow']

    if (!types.includes(type as any)) {
      throw new OperationalError('invalid live type', 400)
    }

    const lives = await LiveRepo.fetchLivesByType(
      type as LiveSchema['type'],
      guranteeNumericResult(query.page, 1),
      guranteeNumericResult(query.limit, 10),
    )

    return await LiveMediaSourcesUtils.resolveSources(lives, '720p')
  }

  private static _findSubtitlesParent = async (data: AddSubtitleData) => {
    switch (data.parentType) {
      case 'episode':
        return await EpisodeModel.findById(data.parentId)

      case 'vod':
        return await VideoModel.findById(data.parentId)

      default:
        throw new OperationalError(`${data.parentType} is not a valid subtitle parent type`, 400)
    }
  }

  static addSubtitle = async (data: AddSubtitleData) => {
    if ((await this._findSubtitlesParent(data)) == null) {
      throw new OperationalError('parent does not exist', 404)
    }

    const duplicate = await SubtitleModel.exists({
      video_id: data.parentId,
      parentType: data.parentType,
      language: data.language.trim().toLowerCase(),
    })
    if (duplicate) {
      throw new OperationalError(
        `A ${data.language} subtitle already exists for this content. Remove it before uploading a replacement.`,
        409,
      )
    }

    const webVtt = normalizeSubtitleToWebVtt(data.subtitle.buffer)
    const { Bucket, Key } = await MediaManagement.storeSubtitle(data.subtitle, webVtt)

    try {
      return await SubtitleModel.create({
        video_id: data.parentId,
        parentType: data.parentType,
        bucket: Bucket,
        key: Key,
        language: data.language,
      })
    } catch (error) {
      await MediaManagement.deleteObject(Key, Bucket)
      throw error
    }
  }
}
