import { motion } from 'framer-motion';
import { SearchX, Home, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

// =============================================
// 404 Not Found Page — ShopVerse
// =============================================

export default function NotFound() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <div className="text-center max-w-lg">
        {/* Large 404 */}
        <h1
          className="text-[8rem] sm:text-[10rem] font-black leading-none mb-2 select-none"
          style={{
            fontFamily: "'Playfair Display', serif",
            color: 'var(--primary)',
            textShadow: '4px 4px 0 var(--accent)',
          }}
        >
          404
        </h1>

        {/* Icon */}
        <div
          className="mx-auto w-16 h-16 rounded-full flex items-center justify-center mb-6"
          style={{ backgroundColor: 'var(--primary-light, #F8E8EB)' }}
        >
          <SearchX size={32} style={{ color: 'var(--primary)' }} />
        </div>

        {/* Message */}
        <h2
          className="text-2xl font-bold mb-4"
          style={{
            fontFamily: "'Playfair Display', serif",
            color: 'var(--text-primary)',
          }}
        >
          Page Not Found
        </h2>

        <p
          className="mb-8 text-lg leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
          Let&apos;s get you back on track.
        </p>

        {/* Decorative line */}
        <div className="decorative-line w-32 mx-auto mb-8" />

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <Link href="/" className="btn btn-primary">
            <Home size={18} />
            Back to Home
          </Link>

          <Link href="/products" className="btn btn-outline">
            <ArrowLeft size={18} />
            Browse Products
          </Link>
        </div>
      </div>
    </div>
  );
}
