const { createCustomerSchema } = require('../build/src/validations/customers')

describe('customer registration contract', () => {
  test('accepts preferred name, email, and password only', () => {
    const result = createCustomerSchema.body.validate({
      name: 'Ree',
      email: 'ree@example.com',
      password: 'StrongPass1',
    })

    expect(result.error).toBeUndefined()
  })

  test('rejects the legacy phone-based signup payload', () => {
    const result = createCustomerSchema.body.validate({
      first_name: 'Ree',
      last_name: 'Play',
      email: 'ree@example.com',
      password: 'StrongPass1',
      cpassword: 'StrongPass1',
      country_code: '+234',
      mobile: '8000000000',
    })

    expect(result.error).toBeDefined()
  })
})
