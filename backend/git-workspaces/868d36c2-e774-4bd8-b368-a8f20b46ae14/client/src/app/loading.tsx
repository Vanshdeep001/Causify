// =============================================
// Global Loading Page — ShopVerse
// =============================================

export default function Loading() {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-6"
      style={{ backgroundColor: 'var(--bg)' }}
    >
      {/* Logo pulse */}
      <div className="relative">
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{
            backgroundColor: 'var(--primary)',
            animation: 'sv-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
          }}
        >
          <span
            className="text-2xl font-black text-white"
            style={{ fontFamily: "'Playfair Display', serif" }}
          >
            S
          </span>
        </div>

        {/* Glow ring */}
        <div
          className="absolute inset-0 rounded-2xl"
          style={{
            border: '2px solid var(--primary)',
            opacity: 0.3,
            animation: 'sv-ping 1.5s cubic-bezier(0, 0, 0.2, 1) infinite',
          }}
        />
      </div>

      {/* Loading text */}
      <div className="flex items-center gap-1">
        <span
          className="text-sm font-medium tracking-wider uppercase"
          style={{
            fontFamily: "'Outfit', system-ui, sans-serif",
            color: 'var(--text-secondary)',
          }}
        >
          Loading
        </span>
        <span className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: 'var(--primary)',
                animation: `sv-bounce 1.4s ease-in-out ${i * 0.16}s infinite both`,
              }}
            />
          ))}
        </span>
      </div>
    </div>
  );
}
