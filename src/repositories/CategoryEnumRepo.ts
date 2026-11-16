import { CategoryEnumModel } from '../models/categoryEnum.model'

export class CategoryEnumRepo {
  static create = (name: string) => CategoryEnumModel.create({ name })

  static getAllCategories = () => CategoryEnumModel.find({}).sort({ position: 1, name: 1 })

  static deleteById = (id: string) => CategoryEnumModel.findByIdAndDelete(id)
}
