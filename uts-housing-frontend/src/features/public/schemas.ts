import { z } from 'zod'

const email = z.string().trim().pipe(z.email('Enter a valid email address.')).transform(value => value.toLowerCase())

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
})

export const registerSchema = z.object({
  role: z.enum(['STUDENT', 'LANDLORD']),
  name: z.string().trim().min(1, 'Enter your name.').max(100, 'Name must be 100 characters or fewer.'),
  email,
  password: z.string().min(8, 'Password must be at least 8 characters.'),
  confirmPassword: z.string().min(1, 'Confirm your password.'),
  acceptTerms: z.boolean().refine(value => value, 'Please read and accept the Terms of Use and Privacy Notice.'),
}).refine(value => value.password === value.confirmPassword, {
  path: ['confirmPassword'],
  message: 'The passwords do not match.',
})

export type LoginValues = z.infer<typeof loginSchema>
export type RegisterValues = z.infer<typeof registerSchema>
