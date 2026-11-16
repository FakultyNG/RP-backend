import { ClientSession, Types } from 'mongoose'
import { EpisodeModel } from '../../models/episodes.model'
import { LiveModel } from '../../models/lives.model'
import { SeasonModel } from '../../models/seasons.model'
import { VideoModel } from '../../models/videos.model'
import { ViewModel } from '../../models/view.model'
import { OperationalError } from '../../utils/OperationalError'

export type CountedContentType = 'vod' | 'episode' | 'live'

type RegisterUniqueViewInput = {
  viewer: Types.ObjectId | string
  content: Types.ObjectId | string
  contentType: CountedContentType
  session?: ClientSession
}

export class ViewService {
  private static async insertUniqueView({
    viewer,
    content,
    contentType,
    session,
  }: RegisterUniqueViewInput) {
    try {
      const result = await ViewModel.updateOne(
        { viewer, content, contentType },
        { $setOnInsert: { viewer, content, contentType } },
        { upsert: true, session },
      )
      return result.upsertedCount === 1
    } catch (error: any) {
      // Concurrent upserts can race, but the unique index makes the loser a
      // duplicate rather than a second view.
      if (error?.code === 11000) return false
      throw error
    }
  }

  private static async incrementParent(
    content: Types.ObjectId | string,
    contentType: CountedContentType,
    session?: ClientSession,
  ) {
    const options = { session }
    if (contentType === 'vod') {
      return VideoModel.findByIdAndUpdate(content, { $inc: { viewsCount: 1 } }, options)
    }
    if (contentType === 'episode') {
      return EpisodeModel.findByIdAndUpdate(content, { $inc: { viewsCount: 1 } }, options)
    }
    return LiveModel.findByIdAndUpdate(content, { $inc: { viewsCount: 1 } }, options)
  }

  private static async ensureSeriesParentView({
    viewer,
    content,
    session,
  }: Omit<RegisterUniqueViewInput, 'contentType'>) {
    const episode = await EpisodeModel.findById(content).select('season').session(session ?? null)
    if (!episode) return
    const season = await SeasonModel.findById(episode.season).select('video').session(session ?? null)
    if (!season) return
    await this.registerUniqueView({ viewer, content: season.video, contentType: 'vod', session })
  }

  static async registerUniqueView(input: RegisterUniqueViewInput) {
    const inserted = await this.insertUniqueView(input)

    if (inserted) {
      const parent = await this.incrementParent(input.content, input.contentType, input.session)
      if (!parent) {
        await ViewModel.deleteOne({
          viewer: input.viewer,
          content: input.content,
          contentType: input.contentType,
        }).session(input.session ?? null)
        throw new OperationalError('Content not found', 404)
      }
    }

    // An episode contributes one lifetime unique view to its parent series,
    // regardless of how many episodes that account watches.
    if (input.contentType === 'episode') {
      await this.ensureSeriesParentView(input)
    }

    return { counted: inserted }
  }
}
