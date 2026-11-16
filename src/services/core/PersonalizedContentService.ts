import { Types } from 'mongoose'
import { CategoryEnumModel } from '../../models/categoryEnum.model'
import { GenreEnumModel } from '../../models/genreEnum.model'
import { LikeModel } from '../../models/likes.model'
import { SettingsModel } from '../../models/userSettings.model'
import { VideoModel } from '../../models/videos.model'
import { ViewModel } from '../../models/view.model'
import { WatchedModel } from '../../models/watched.model'
import { VideoRepo, VodCardResponse } from '../../repositories/VideoRepo'
import { LoggedInUser } from '../../types'
import { isGuestUser } from '../../utils/guestAccess'

type PreferenceInput = {
  genreIds?: string[]
  categoryIds?: string[]
}

type ScoredCard = {
  card: VodCardResponse
  affinityScore: number
  totalScore: number
  discoveryScore: number
}

const validIds = (values: string[] = []) =>
  [...new Set(values.filter(value => Types.ObjectId.isValid(value)))].slice(0, 7)

const idsFromCard = (values: any[] | undefined) =>
  (values ?? []).map(value => String(value?._id ?? value))

const addAffinity = (map: Map<string, number>, ids: unknown[], weight: number) => {
  ids.forEach(id => {
    const key = String(id)
    map.set(key, (map.get(key) ?? 0) + weight)
  })
}

export class PersonalizedContentService {
  private static async legacyPreferenceIds(names: string[]) {
    if (names.length === 0) return { genreIds: [], categoryIds: [] }
    const normalized = new Set(names.map(name => name.trim().toLowerCase()))
    const [genres, categories] = await Promise.all([
      GenreEnumModel.find().select('name').lean(),
      CategoryEnumModel.find().select('name').lean(),
    ])
    return {
      genreIds: genres
        .filter(item => normalized.has(item.name.toLowerCase()))
        .map(item => item._id.toString()),
      categoryIds: categories
        .filter(item => normalized.has(item.name.toLowerCase()))
        .map(item => item._id.toString()),
    }
  }

  private static async buildAffinity(
    currentUser: LoggedInUser,
    supplied: PreferenceInput,
  ) {
    const genreAffinity = new Map<string, number>()
    const categoryAffinity = new Map<string, number>()
    let explicitGenreIds = validIds(supplied.genreIds)
    let explicitCategoryIds = validIds(supplied.categoryIds)

    if (isGuestUser(currentUser)) {
      explicitGenreIds.forEach(id => genreAffinity.set(id, 6))
      explicitCategoryIds.forEach(id => categoryAffinity.set(id, 6))
      return { genreAffinity, categoryAffinity, explicitGenreIds, explicitCategoryIds }
    }

    const settings = await SettingsModel.findOne({ user_id: currentUser._id }).lean()
    explicitGenreIds = validIds([
      ...explicitGenreIds,
      ...(settings?.interest_genres ?? []).map(id => id.toString()),
    ])
    explicitCategoryIds = validIds([
      ...explicitCategoryIds,
      ...(settings?.interest_categories ?? []).map(id => id.toString()),
    ])

    if (explicitGenreIds.length + explicitCategoryIds.length === 0 && settings?.interest?.length) {
      const legacy = await this.legacyPreferenceIds(settings.interest)
      explicitGenreIds = validIds(legacy.genreIds)
      explicitCategoryIds = validIds(legacy.categoryIds)
    }

    explicitGenreIds.forEach(id => genreAffinity.set(id, 6))
    explicitCategoryIds.forEach(id => categoryAffinity.set(id, 6))

    const [watched, likes, views] = await Promise.all([
      WatchedModel.find({ userId: currentUser._id, parentType: 'vod' })
        .sort({ updatedAt: -1 })
        .limit(30)
        .select('parentId duration totalDuration')
        .lean(),
      LikeModel.find({ user: currentUser._id, contentType: 'vod' })
        .sort({ updatedAt: -1 })
        .limit(30)
        .select('content')
        .lean(),
      ViewModel.find({ viewer: currentUser._id, contentType: 'vod' })
        .sort({ updatedAt: -1 })
        .limit(30)
        .select('content')
        .lean(),
    ])

    const contentWeights = new Map<string, number>()
    watched.forEach(item => {
      const ratio = item.totalDuration > 0 ? Math.min(item.duration / item.totalDuration, 1) : 0
      contentWeights.set(item.parentId.toString(), 0.75 + ratio * 2.25)
    })
    likes.forEach(item => {
      const id = item.content.toString()
      contentWeights.set(id, (contentWeights.get(id) ?? 0) + 2.5)
    })
    views.forEach(item => {
      const id = item.content.toString()
      contentWeights.set(id, (contentWeights.get(id) ?? 0) + 0.5)
    })
    ;(settings?.watchlist ?? []).forEach(id => {
      if (!Types.ObjectId.isValid(id)) return
      contentWeights.set(id, (contentWeights.get(id) ?? 0) + 1.5)
    })

    const sourceContent = await VideoModel.find({
      _id: { $in: [...contentWeights.keys()].map(id => new Types.ObjectId(id)) },
    })
      .select('genre category')
      .lean()

    sourceContent.forEach(content => {
      const weight = contentWeights.get(content._id.toString()) ?? 0
      addAffinity(genreAffinity, content.genre, weight)
      addAffinity(categoryAffinity, content.category, weight)
    })

    return { genreAffinity, categoryAffinity, explicitGenreIds, explicitCategoryIds }
  }

  static async getRecommendations(
    currentUser: LoggedInUser,
    supplied: PreferenceInput,
    page: number,
    limit: number,
  ) {
    const { genreAffinity, categoryAffinity } = await this.buildAffinity(currentUser, supplied)
    const candidates = await VideoRepo.fetchPersonalizedCandidates(100)
    const now = Date.now()

    const scored: ScoredCard[] = candidates.map(card => {
      const affinityScore =
        idsFromCard(card.genre).reduce((sum, id) => sum + (genreAffinity.get(id) ?? 0), 0) +
        idsFromCard(card.category).reduce(
          (sum, id) => sum + (categoryAffinity.get(id) ?? 0),
          0,
        )
      const raw = card as VodCardResponse & {
        engagements?: number
        likesCount?: number
        commentsCount?: number
      }
      const engagement = Math.max(raw.engagements ?? 0, 0)
      const views = Math.max(card.viewsCount ?? 0, 0)
      const rating = Math.max(card.averageRating ?? card.defaultRating ?? 0, 0)
      const ageDays = Math.max((now - new Date(card.createdAt).getTime()) / 86_400_000, 0)
      const freshness = Math.max(2 - ageDays / 90, 0)
      const discoveryScore =
        Math.log10(views + 1) * 0.8 + Math.log10(engagement + 1) + rating * 0.35 + freshness
      return {
        card,
        affinityScore,
        discoveryScore,
        totalScore: affinityScore * 2 + discoveryScore,
      }
    })

    const personalized = scored
      .filter(item => item.affinityScore > 0)
      .sort((a, b) => b.totalScore - a.totalScore)
    const discovery = scored
      .filter(item => item.affinityScore === 0)
      .sort((a, b) => b.discoveryScore - a.discoveryScore)

    const blended: ScoredCard[] = []
    while (personalized.length || discovery.length) {
      for (let i = 0; i < 3 && personalized.length; i += 1) {
        blended.push(personalized.shift()!)
      }
      if (discovery.length) blended.push(discovery.shift()!)
      if (!personalized.length && discovery.length) blended.push(...discovery.splice(0))
    }

    const start = (page - 1) * limit
    return blended.slice(start, start + limit).map(item => item.card)
  }
}
