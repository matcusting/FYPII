import { z } from 'zod'

const email = z.string().trim().pipe(z.email('请输入有效的邮箱地址。')).transform(value => value.toLowerCase())

export const loginSchema = z.object({
  email,
  password: z.string().min(1, '请输入密码。'),
})

export const registerSchema = z.object({
  role: z.enum(['STUDENT', 'LANDLORD']),
  name: z.string().trim().min(1, '请输入姓名。').max(100, '姓名不能超过 100 个字符。'),
  email,
  password: z.string().min(8, '密码至少需要 8 个字符。'),
  confirmPassword: z.string().min(1, '请再次输入密码。'),
  acceptTerms: z.boolean().refine(value => value, '请先阅读并同意使用条款与隐私说明。'),
}).refine(value => value.password === value.confirmPassword, {
  path: ['confirmPassword'],
  message: '两次输入的密码不一致。',
})

export type LoginValues = z.infer<typeof loginSchema>
export type RegisterValues = z.infer<typeof registerSchema>
