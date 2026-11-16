const { fetchUpcomingSchema } = require('../build/src/validations/customers')

describe('upcoming listing contract', () => {
  test('allows the app to request up to 100 upcoming items', () => {
    const result = fetchUpcomingSchema.query.validate({page: 1, limit: 100})
    expect(result.error).toBeUndefined()
  })

  test('rejects limits above 100', () => {
    const result = fetchUpcomingSchema.query.validate({page: 1, limit: 101})
    expect(result.error).toBeDefined()
  })
})
