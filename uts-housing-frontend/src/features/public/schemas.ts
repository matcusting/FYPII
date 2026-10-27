import { z } from 'zod'

const email = z.string().trim().pipe(z.email('Enter a valid email address.')).transform(value => value.toLowerCase())

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
})

export const registerSchema = z.object({
  role: z.enum(['STUDENT', 'LANDLORD']),
  name: z.string().trim().min(2, 'Enter at least 2 characters for your name.').max(100, 'Name must be 100 characters or fewer.'),
  email,
  phone: z.string().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  confirmPassword: z.string().min(1, 'Confirm your password.'),
  acceptTerms: z.boolean().refine(value => value, 'Please read and accept the Terms of Use and Privacy Notice.'),
}).refine(value => value.role !== 'LANDLORD' || (/^\+?[0-9][0-9 ()-]*$/.test(value.phone) && value.phone.replace(/\D/g, '').length >= 7 && value.phone.replace(/\D/g, '').length <= 15), {
  path: ['phone'],
  message: 'Enter a valid phone number.',
}).refine(value => value.password === value.confirmPassword, {
  path: ['confirmPassword'],
  message: 'The passwords do not match.',
})

export type LoginValues = z.infer<typeof loginSchema>
export type RegisterValues = z.infer<typeof registerSchema>
