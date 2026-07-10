// =============================================
// Login Page — Brutalist Edition
// =============================================

'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ShoppingBag, Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useState, useEffect } from 'react';
import { toast } from 'sonner';

const loginFormSchema = z.object({
  email: z
    .string()
    .min(1, 'Email is required')
    .email('Please enter a valid email address'),
  password: z
    .string()
    .min(1, 'Password is required')
    .min(8, 'Password must be at least 8 characters'),
});

type LoginFormValues = z.infer<typeof loginFormSchema>;

export default function LoginPage() {
  const { login, isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/');
    }
  }, [isAuthenticated, router]);

  const {
    register: formRegister,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (values: LoginFormValues) => {
    try {
      await login(values);
    } catch (error) {
      // Errors are handled and toasted inside useAuth hook
    }
  };

  return (
    <main className="min-h-screen w-full relative flex items-center justify-center py-20 px-4 select-none bg-[#F4EFE6]">
      {/* Brutalist Grid Background */}
      <div className="absolute inset-0 pattern-grid pointer-events-none opacity-10" />

      {/* Main card box */}
      <div className="relative w-full max-w-[480px] z-10">
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
              PORTAL ACCESS
            </h2>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {/* Email Field */}
            <div className="space-y-2">
              <label className="block text-xs font-black uppercase tracking-wider text-[#1E1613] flex items-center gap-1.5">
                <Mail size={14} />
                EMAIL ADDRESS
              </label>
              <div className="relative">
                <input
                  type="email"
                  disabled={isLoading}
                  placeholder="name@example.com"
                  className="w-full bg-[#FDFBF7] border-3 border-[#1E1613] p-3 text-sm font-extrabold text-[#1E1613] placeholder-[#8E786E] focus:outline-none focus:bg-[#FCEBEE] transition-all shadow-[3px_3px_0px_0px_#1E1613] focus:shadow-[1px_1px_0px_0px_#1E1613] disabled:opacity-50"
                  {...formRegister('email')}
                />
              </div>
              {errors.email && (
                <p className="text-xs font-bold uppercase tracking-wide text-[#C41E3A] mt-1">
                  {errors.email.message}
                </p>
              )}
            </div>

            {/* Password Field */}
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-xs font-black uppercase tracking-wider text-[#1E1613] flex items-center gap-1.5">
                  <Lock size={14} />
                  PASSWORD
                </label>
                <Link
                  href="/forgot-password"
                  className="text-[10px] font-bold uppercase tracking-wider text-[#C41E3A] hover:underline"
                >
                  Forgot?
                </Link>
              </div>
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

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full btn-brutal py-3.5 px-6 font-black uppercase tracking-wider text-sm shadow-[4px_4px_0px_0px_#1E1613] hover:shadow-[6px_6px_0px_0px_#1E1613] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0px_0px_#1E1613] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'ESTABLISHING CONNECTION...' : 'AUTHORIZE ACCESS'}
              {!isLoading && <ArrowRight size={18} className="ml-2 inline" />}
            </button>
          </form>

          {/* Form footer link */}
          <div className="mt-8 text-center pt-6 border-t-3 border-[#1E1613] border-dashed">
            <p className="text-xs font-bold text-[#5C4A42]">
              NEW VENDOR OR CUSTOMER?{' '}
              <Link
                href="/register"
                className="text-[#C41E3A] hover:underline font-black uppercase tracking-wider ml-1"
              >
                CREATE IDENTITY
              </Link>
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
