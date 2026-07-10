'use client';

// =============================================
// Global Error Page — ShopVerse
// =============================================

import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import Link from 'next/link';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Application error:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{ backgroundColor: 'var(--bg)' }}>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="text-center max-w-md"
      >
        {/* Icon */}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 200, delay: 0.2 }}
          className="mx-auto w-24 h-24 rounded-full flex items-center justify-center mb-8"
          style={{ backgroundColor: 'var(--error-light, #F8E8EB)' }}
        >
          <AlertTriangle
            size={48}
            style={{ color: 'var(--primary)' }}
          />
        </motion.div>

        {/* Title */}
        <h1
          className="text-3xl font-bold mb-4"
          style={{ fontFamily: "'Playfair Display', serif", color: 'var(--text-primary)' }}
        >
          Something went wrong
        </h1>

        {/* Description */}
        <p
          className="mb-8 text-lg leading-relaxed"
          style={{ color: 'var(--text-secondary)' }}
        >
          We apologize for the inconvenience. An unexpected error occurred while processing your request.
        </p>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-4 justify-center">
          <button
            onClick={reset}
            className="btn btn-primary"
          >
            <RefreshCw size={18} />
            Try Again
          </button>

          <Link href="/" className="btn btn-outline">
            <Home size={18} />
            Go Home
          </Link>
        </div>

        {/* Error digest for debugging */}
        {error.digest && (
          <p
            className="mt-8 text-sm font-mono"
            style={{ color: 'var(--text-muted)' }}
          >
            Error ID: {error.digest}
          </p>
        )}
      </motion.div>
    </div>
  );
}
