import { Episode, Season } from '../types/movie'
import { VidUploadUtils, VideoQuality } from './VideoUploadUtils'
import { VodCardResponse } from '../repositories/VideoRepo'

export class MovieMediaSourcesUtils {
  protected static _getMovieVideoSource = (
    vid: VodCardResponse | Episode,
    routine: 'vid' | 'trailer',
    quality: VideoQuality,
  ) => {
    if (routine === 'vid') {
      return (vid.videoUpload
        ? VidUploadUtils.getResSourceUrl(vid.videoUpload, quality)
        : undefined) ?? vid.videoLink
    }

    if (routine === 'trailer') {
      return (vid.trailerUpload
        ? VidUploadUtils.getResSourceUrl(vid.trailerUpload, quality)
        : undefined) ?? vid.trailerLink
    }
  }

  public static resolveSeasonsMediaSources = (seasons: Season[], quality: VideoQuality) => {
    const seasonsWithSources = seasons.map(season => {
      season.episodes = this.resolveEpisodesMediaSources(season.episodes, quality)
      return season
    })

    return seasonsWithSources as Season[]
  }

  public static resolveEpisodesMediaSources = (episodes: Episode[], quality: VideoQuality) => {
    const episodesWithSources = episodes.map(episode => {
      Object.assign(episode, {
        video: this._getMovieVideoSource(episode, 'vid', quality),
        trailer: this._getMovieVideoSource(episode, 'trailer', quality),
        videoUploadId: episode.videoUpload?._id,
        trailerUploadId: episode.trailerUpload?._id,
        videoStatus: episode.videoUpload?.hlsStatus,
        videoError: episode.videoUpload?.hlsError,
        trailerStatus: episode.trailerUpload?.hlsStatus,
        trailerError: episode.trailerUpload?.hlsError,
        trailerUpload: undefined,
        videoUpload: undefined,
        trailerLink: undefined,
        videoLink: undefined,
      })

      return episode
    })

    return episodesWithSources
  }

  static resolveMediaSources = (videoDocuments: VodCardResponse[], quality: VideoQuality) =>
    videoDocuments.map(videoDocument =>
      Object.assign(videoDocument, {
        // Paid media is resolved only through the authenticated video-source endpoint.
        video: videoDocument.vidClass === 'free'
          ? this._getMovieVideoSource(videoDocument, 'vid', quality)
          : undefined,
        trailer: this._getMovieVideoSource(videoDocument, 'trailer', quality),
        videoUploadId: videoDocument.videoUpload?._id,
        trailerUploadId: videoDocument.trailerUpload?._id,
        videoStatus: videoDocument.videoUpload?.hlsStatus,
        videoError: videoDocument.videoUpload?.hlsError,
        trailerStatus: videoDocument.trailerUpload?.hlsStatus,
        trailerError: videoDocument.trailerUpload?.hlsError,

        //
        trailerUpload: undefined,
        videoUpload: undefined,
        trailerLink: undefined,
        videoLink: undefined,
      }),
    )
}
