import { Request } from 'express'
import { CategoryEnumRepo } from '../../repositories/CategoryEnumRepo'
import { OperationalError } from '../../utils/OperationalError'
import { QueryParamsFeatures } from '../../utils/QueryParamsFeatures'
import { CategoryEnumModel } from '../../models/categoryEnum.model'

export class CategoryEnumService {
  static readonly PREMIUM_ADS_CATEGORY = 'Premium Ads'
  static readonly PREMIUM_ADS_POSITION = 11

  static ensurePremiumAdsCategory = async () => {
    const existing = await CategoryEnumModel.findOne({
      name: { $regex: /^Premium Ads$/i },
    })

    if (existing?.position === this.PREMIUM_ADS_POSITION) {
      return existing
    }

    const occupant = await CategoryEnumModel.findOne({
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
    })
  }

  static addCategory = async (name: string, position: number) => {
    const category = await CategoryEnumModel.create({
      name,
      position,
    })

    return category
  }

  static updateCategory = async (catId: string, data: Record<string, any>) => {
    const updatedCategory = await CategoryEnumModel.findByIdAndUpdate(catId, data, { new: true })

    if (updatedCategory == null) {
      throw new OperationalError('category id is invalid', 404)
    }

    return updatedCategory
  }

  static getCategories = async (query: Request['query']) => {
    await this.ensurePremiumAdsCategory()
    const features = new QueryParamsFeatures(CategoryEnumRepo.getAllCategories(), {
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
