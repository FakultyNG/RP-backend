import { CategoryEnumModel } from '../models/categoryEnum.model'

export class CategoryEnumRepo {
  static create = (name: string) => CategoryEnumModel.create({ name })

  static getAllCategories = (filter: Record<string, unknown> = {}) =>
    CategoryEnumModel.find(filter).sort({ location: 1, position: 1, name: 1 })

  static deleteById = (id: string) => CategoryEnumModel.findByIdAndDelete(id)
}
