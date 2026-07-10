// =============================================
// Register Page — Brutalist Edition
// =============================================

'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Eye, EyeOff, Lock, Mail, User as UserIcon, Phone } from 'lucide-react';
import { useState, useEffect } from 'react';

const registerFormSchema = z
  .object({
    firstName: z
      .string()
      .min(2, 'First name must be at least 2 characters')
      .max(50, 'First name cannot exceed 50 characters')
      .trim(),
    lastName: z
      .string()
      .min(2, 'Last name must be at least 2 characters')
      .max(50, 'Last name cannot exceed 50 characters')
      .trim(),
    email: z
      .string()
      .min(1, 'Email is required')
      .email('Please enter a valid email address')
      .toLowerCase()
      .trim(),
    phone: z
      .string()
      .regex(/^[+]?[0-9]{10,15}$/, 'Invalid phone number format')
      .optional()
      .or(z.literal('')),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .max(128, 'Password cannot exceed 128 characters'),
    confirmPassword: z
      .string()
      .min(1, 'Please confirm your password'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

type RegisterFormValues = z.infer<typeof registerFormSchema>;

export default function RegisterPage() {
  const { register: registerAuth, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  const {
    register: formRegister,
    handleSubmit,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerFormSchema),
    defaultValues: {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      password: '',
      confirmPassword: '',
    },
  });

  const onSubmit = async (values: RegisterFormValues) => {
    try {
      await registerAuth(values);
    } catch (error) {
      // Errors are handled and toasted inside useAuth hook
    }
  };

  return (
    <main className="min-h-screen w-full relative flex items-center justify-center py-20 px-4 select-none bg-[#F4EFE6]">
      {/* Brutalist Grid Background */}
      <div className="absolute inset-0 pattern-grid pointer-events-none opacity-10" />

      {/* Main card box */}
      <div className="relative w-full max-w-[540px] z-10">
        {/* Red Offset shadow */}
        <div className="absolute inset-0 bg-[#C41E3A] border-4 border-[#1E1613] translate-x-3.5 translate-y-3.5 shadow-[4px_4px_0px_0px_#1E1613]" />

        {/* Content Box */}
        <div className="relative bg-[#FDFBF7] border-4 border-[#1E1613] p-8 sm:p-12 shadow-[4px_4px_0px_0px_#1E1613]">
          {/* Header/Logo section */}
          <div className="flex flex-col items-center mb-8 pb-6 border-b-4 border-[#1E1613]">
            <Link href="/" className="flex items-center gap-3 group mb-4">
              <div className="w-11 h-11 border-4 border-[#1E1613] flex items-center justify-center bg-[#C41E3A] shadow-[3px_3px_0px_0px_#1E1613] group-hover:translate-x-[1px] group-hover:translate-y-[1px] group-hover:shadow-[2px_2px_0px_0px_#1E1613] transition-all duration-200">
                <span className="text-white font-black text-xl font-serif">S</span>
              </div>
              <div>
                <span className="text-xl font-extrabold font-display uppercase tracking-tight block leading-none group-hover:text-[#C41E3A] transition-colors duration-200">
                  ShopVerse
                </span>
                <span className="text-[8px] font-bold tracking-wider uppercase text-[#C41E3A]">
                  Marketplace Engine
                </span>
              </div>
            </Link>
            <h2 className="text-2xl sm:text-3xl font-black font-display text-center uppercase tracking-tight text-[#1E1613]">
              CREATE IDENTITY
            </h2>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            {/* First & Last Name Fields (Side by Side) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-wider text-[#1E1613] flex items-center gap-1.5">
                  <UserIcon size={14} />
                  FIRST NAME
                </label>
                <input
                  type="text"
                  disabled={isLoading}
                  placeholder="John"
                  className="w-full bg-[#FDFBF7] border-3 border-[#1E1613] p-3 text-sm font-extrabold text-[#1E1613] placeholder-[#8E786E] focus:outline-none focus:bg-[#FCEBEE] transition-all shadow-[3px_3px_0px_0px_#1E1613] focus:shadow-[1px_1px_0px_0px_#1E1613] disabled:opacity-50"
                  {...formRegister('firstName')}
                />
                {errors.firstName && (
                  <p className="text-xs font-bold uppercase tracking-wide text-[#C41E3A] mt-1">
                    {errors.firstName.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-wider text-[#1E1613] flex items-center gap-1.5">
                  <UserIcon size={14} />
                  LAST NAME
                </label>
                <input
                  type="text"
                  disabled={isLoading}
                  placeholder="Doe"
                  className="w-full bg-[#FDFBF7] border-3 border-[#1E1613] p-3 text-sm font-extrabold text-[#1E1613] placeholder-[#8E786E] focus:outline-none focus:bg-[#FCEBEE] transition-all shadow-[3px_3px_0px_0px_#1E1613] focus:shadow-[1px_1px_0px_0px_#1E1613] disabled:opacity-50"
                  {...formRegister('lastName')}
                />
                {errors.lastName && (
                  <p className="text-xs font-bold uppercase tracking-wide text-[#C41E3A] mt-1">
                    {errors.lastName.message}
                  </p>
                )}
              </div>
            </div>

            {/* Email Field */}
            <div className="space-y-2">
              <label className="block text-xs font-black uppercase tracking-wider text-[#1E1613] flex items-center gap-1.5">
                <Mail size={14} />
                EMAIL ADDRESS
              </label>
              <input
                type="email"
                disabled={isLoading}
                placeholder="john.doe@example.com"
                className="w-full bg-[#FDFBF7] border-3 border-[#1E1613] p-3 text-sm font-extrabold text-[#1E1613] placeholder-[#8E786E] focus:outline-none focus:bg-[#FCEBEE] transition-all shadow-[3px_3px_0px_0px_#1E1613] focus:shadow-[1px_1px_0px_0px_#1E1613] disabled:opacity-50"
                {...formRegister('email')}
              />
              {errors.email && (
                <p className="text-xs font-bold uppercase tracking-wide text-[#C41E3A] mt-1">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Phone Field (Optional) */}
            <div className="space-y-2">
              <label className="block text-xs font-black uppercase tracking-wider text-[#1E1613] flex items-center gap-1.5">
                <Phone size={14} />
                PHONE NUMBER (OPTIONAL)
              </label>
              <input
                type="tel"
                disabled={isLoading}
                placeholder="+919876543210"
                className="w-full bg-[#FDFBF7] border-3 border-[#1E1613] p-3 text-sm font-extrabold text-[#1E1613] placeholder-[#8E786E] focus:outline-none focus:bg-[#FCEBEE] transition-all shadow-[3px_3px_0px_0px_#1E1613] focus:shadow-[1px_1px_0px_0px_#1E1613] disabled:opacity-50"
                {...formRegister('phone')}
              />
              {errors.phone && (
                <p className="text-xs font-bold uppercase tracking-wide text-[#C41E3A] mt-1">
                  {errors.phone.message}
                </p>
              )}
            </div>

            {/* Password & Confirm Password (Side by Side) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-wider text-[#1E1613] flex items-center gap-1.5">
                  <Lock size={14} />
                  PASSWORD
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    disabled={isLoading}
                    placeholder="••••••••"
                    className="w-full bg-[#FDFBF7] border-3 border-[#1E1613] p-3 pr-10 text-sm font-extrabold text-[#1E1613] placeholder-[#8E786E] focus:outline-none focus:bg-[#FCEBEE] transition-all shadow-[3px_3px_0px_0px_#1E1613] focus:shadow-[1px_1px_0px_0px_#1E1613] disabled:opacity-50"
                    {...formRegister('password')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5C4A42] hover:text-[#1E1613] transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs font-bold uppercase tracking-wide text-[#C41E3A] mt-1">
                    {errors.password.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-black uppercase tracking-wider text-[#1E1613] flex items-center gap-1.5">
                  <Lock size={14} />
                  CONFIRM PASSWORD
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    disabled={isLoading}
                    placeholder="••••••••"
                    className="w-full bg-[#FDFBF7] border-3 border-[#1E1613] p-3 pr-10 text-sm font-extrabold text-[#1E1613] placeholder-[#8E786E] focus:outline-none focus:bg-[#FCEBEE] transition-all shadow-[3px_3px_0px_0px_#1E1613] focus:shadow-[1px_1px_0px_0px_#1E1613] disabled:opacity-50"
                    {...formRegister('confirmPassword')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#5C4A42] hover:text-[#1E1613] transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.confirmPassword && (
                  <p className="text-xs font-bold uppercase tracking-wide text-[#C41E3A] mt-1">
                    {errors.confirmPassword.message}
                  </p>
                )}
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn-brutal py-3.5 px-6 font-black uppercase tracking-wider text-sm shadow-[4px_4px_0px_0px_#1E1613] hover:shadow-[6px_6px_0px_0px_#1E1613] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0px_0px_#1E1613] transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {isLoading ? 'CREATING PROFILE...' : 'INITIALIZE INITIAL IDENTITY'}
              {!isLoading && <ArrowRight size={18} className="ml-2 inline" />}
            </button>
          </form>

          {/* Form footer link */}
          <div className="mt-8 text-center pt-6 border-t-3 border-[#1E1613] border-dashed">
            <p className="text-xs font-bold text-[#5C4A42]">
              ALREADY REGISTERED?{' '}
              <Link
                href="/login"
                className="text-[#C41E3A] hover:underline font-black uppercase tracking-wider ml-1"
              >
                AUTHORIZE LOGIN
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
