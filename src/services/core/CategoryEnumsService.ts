import { Request } from 'express'
import { CategoryEnumRepo } from '../../repositories/CategoryEnumRepo'
import { OperationalError } from '../../utils/OperationalError'
import { QueryParamsFeatures } from '../../utils/QueryParamsFeatures'
import { CategoryEnumModel, CategoryEnumSchema } from '../../models/categoryEnum.model'

export class CategoryEnumService {
  static readonly PREMIUM_ADS_CATEGORY = 'Premium Ads'
  static readonly CATEGORY_LOCATIONS: CategoryEnumSchema['location'][] = [
    'Homepage',
    'Live/Channels',
    'Live/Events',
    'Live/Tv Shows',
    'Live/Sports',
    'Live/Podcast',
  ]

  private static isCategoryLocation = (
    value: unknown,
  ): value is CategoryEnumSchema['location'] =>
    typeof value === 'string' &&
    this.CATEGORY_LOCATIONS.includes(value as CategoryEnumSchema['location'])
  static readonly PREMIUM_ADS_POSITION = 11
  static readonly PERSONALIZED_CATEGORY = 'Because of your interests'
  static readonly PERSONALIZED_DEFAULT_POSITION = 3

  static ensurePersonalizedCategory = async () => {
    const existing = await CategoryEnumModel.findOne({ feedType: 'personalized' })
    if (existing) return existing

    const legacy = await CategoryEnumModel.findOne({
      name: { $regex: /^Because of your interests?$/i },
    })
    if (legacy) {
      legacy.feedType = 'personalized'
      return await legacy.save()
    }

    const topTen = await CategoryEnumModel.findOne({ name: { $regex: /^Top 10/i } })
    const position = topTen
      ? topTen.position + 1
      : this.PERSONALIZED_DEFAULT_POSITION
    const categoriesToShift = await CategoryEnumModel.find({
      location: 'Homepage',
      position: { $gte: position },
    })
      .sort({ position: -1 })
    for (const category of categoriesToShift) {
      category.position += 1
      await category.save()
    }

    return await CategoryEnumModel.create({
      name: this.PERSONALIZED_CATEGORY,
      position,
      location: 'Homepage',
      feedType: 'personalized',
    })
  }

  static ensurePremiumAdsCategory = async () => {
    const existing = await CategoryEnumModel.findOne({
      name: { $regex: /^Premium Ads$/i },
    })

    if (existing?.position === this.PREMIUM_ADS_POSITION) {
      return existing
    }

    const occupant = await CategoryEnumModel.findOne({
      location: 'Homepage',
      position: this.PREMIUM_ADS_POSITION,
      ...(existing ? { _id: { $ne: existing._id } } : {}),
    })

    if (existing) {
      const oldPosition = existing.position
      await CategoryEnumModel.updateOne(
        { _id: existing._id },
        { $set: { position: -1000000 } },
      )
      if (occupant) {
        await CategoryEnumModel.updateOne(
          { _id: occupant._id },
          { $set: { position: oldPosition } },
        )
      }
      existing.position = this.PREMIUM_ADS_POSITION
      return await existing.save()
    }

    if (occupant) {
      const categories = await CategoryEnumModel.find({
        location: 'Homepage',
        position: { $gte: this.PREMIUM_ADS_POSITION },
      }).sort({ position: -1 })
      for (const category of categories) {
        category.position += 1
        await category.save()
      }
    }

    return await CategoryEnumModel.create({
      name: this.PREMIUM_ADS_CATEGORY,
      position: this.PREMIUM_ADS_POSITION,
      location: 'Homepage',
    })
  }

  static addCategory = async (
    name: string,
    position: number,
    location: CategoryEnumSchema['location'] = 'Homepage',
  ) => {
    if (!this.isCategoryLocation(location)) {
      throw new OperationalError('category location is invalid', 400)
    }

    const positionTaken = await CategoryEnumModel.exists({ location, position })
    if (positionTaken) {
      throw new OperationalError(`position ${position} is already used in ${location}`, 409)
    }

    const category = await CategoryEnumModel.create({
      name,
      position,
      location,
    })

    return category
  }

  static updateCategory = async (catId: string, data: Record<string, any>) => {
    const category = await CategoryEnumModel.findById(catId)
    if (category == null) {
      throw new OperationalError('category id is invalid', 404)
    }

    const targetLocation = this.isCategoryLocation(data.location)
      ? data.location
      : category.location
    const locationChanged = targetLocation !== category.location

    if (
      (typeof data.position === 'number' && data.position !== category.position) ||
      locationChanged
    ) {
      const targetPosition = typeof data.position === 'number' ? data.position : category.position
      const occupant = await CategoryEnumModel.findOne({
        location: targetLocation,
        position: targetPosition,
        _id: { $ne: category._id },
      })

      if (occupant && locationChanged) {
        throw new OperationalError(
          `position ${targetPosition} is already used in ${targetLocation}`,
          409,
        )
      }

      const oldPosition = category.position
      category.position = -Math.abs(Date.now())
      await category.save()
      if (occupant) {
        occupant.position = oldPosition
        await occupant.save()
      }
      category.position = targetPosition
    }
    if (typeof data.name === 'string') category.name = data.name
    if (this.isCategoryLocation(data.location) && category.feedType !== 'personalized') {
      category.location = data.location
    }
    if (typeof data.active === 'boolean' && category.feedType !== 'personalized') {
      category.active = data.active
    }
    await category.save()

    return category
  }

  static getCategories = async (query: Request['query']) => {
    await this.ensurePersonalizedCategory()
    await this.ensurePremiumAdsCategory()
    const filter: Record<string, unknown> = {}
    if (typeof query.location === 'string' && this.isCategoryLocation(query.location)) {
      filter.location = query.location
    } else if (query.scope === 'live') {
      filter.location = { $regex: '^Live/' }
    }
    if (query.active === 'true') filter.active = { $ne: false }

    const features = new QueryParamsFeatures(CategoryEnumRepo.getAllCategories(filter), {
      defaultLimit: 300,
      defaultPage: 1,
      queryParams: query,
    })

    return await features.paginate().query
  }

  static deleteCategoryById = async (categoryId: string) => {
    const deletedCategory = await CategoryEnumRepo.deleteById(categoryId)

    if (deletedCategory == null) {
      throw new OperationalError('invalid categoryId', 404)
    }
  }
}
